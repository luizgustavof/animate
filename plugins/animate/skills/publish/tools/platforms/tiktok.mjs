// TikTok: Login Kit (desktop, PKCE) + Content Posting API in draft mode. The video lands in the creator's TikTok inbox and
// they press Post in the app (where the caption, sound and cover are set). Direct posting needs TikTok's audit; until then an
// unaudited app can only post private (SELF_ONLY), so drafts are the useful mode. See docs/connect-tiktok.md.
//   token file: ~/.animate/tokens/<account>.tiktok.json  { refresh_token, refresh_expires_at, open_id, display_name, scope }
//   app file:   ~/.animate/tiktok-app.json               { client_key, client_secret }  (the user's own developer app)
import fs from 'node:fs';
import path from 'node:path';
import { SECRETS, tokenFile, readJson, writeJson } from '../lib/store.mjs';
import { authorizeLoopback } from '../lib/oauth.mjs';

const AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
// TikTok wants an https redirect: this static page on the fork's GitHub Pages forwards the code to the local sign-in server
// (docs/legal-page.md). Another fork sets "redirect" in ~/.animate/tiktok-app.json to its own copy.
export const RELAY = 'https://luizgustavof.github.io/animate/tiktok/callback/';
const API = 'https://open.tiktokapis.com/v2';
// video.publish is for direct posting (needs "Direct Post" on in the developer app, and TikTok's audit before posts can be
// public); drafts only need video.upload
const SCOPES = ['user.info.basic', 'video.upload', 'video.publish'];
export const PRIVACY = { PUBLIC_TO_EVERYONE: 'public', MUTUAL_FOLLOW_FRIENDS: 'friends', FOLLOWER_OF_CREATOR: 'followers', SELF_ONLY: 'private' };
// TikTok's chunk rules: 5–64 MB each, the last may run to 128 MB, at most 1000, in order. 50,000,000 bytes is inside the
// range whether "MB" means 10^6 or 2^20, and the merged last chunk stays under 100 MB.
const CHUNK = 50_000_000;
export const APP = path.join(SECRETS, 'tiktok-app.json');
export const CAPTION_MAX = 2200;

export const hasApp = () => { const a = readJson(APP, null); return !!(a?.client_key && a?.client_secret); };

// the user pastes their developer app's Client key and Client secret (the studio form or `publish.mjs tiktok-app`);
// they're kept with the other secrets and never sent back to the browser
export function saveApp({ clientKey, clientSecret }) {
  const key = String(clientKey || '').trim(), secret = String(clientSecret || '').trim();
  if (!/^[A-Za-z0-9]{8,64}$/.test(key)) throw new Error('TIKTOK_APP: that does not look like a TikTok Client key (letters and numbers, from the app page)');
  if (!/^[A-Za-z0-9_\-]{16,128}$/.test(secret)) throw new Error('TIKTOK_APP: that does not look like a TikTok Client secret');
  writeJson(APP, { client_key: key, client_secret: secret, savedAt: new Date().toISOString() }, { secret: true });
}

function app() {
  const a = readJson(APP, null);
  if (!a?.client_key) throw new Error('NEEDS_TIKTOK_APP: the TikTok developer app is not set up yet (docs/connect-tiktok.md)');
  return a;
}

async function tokenRequest(form) {
  const r = await fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' }, body: new URLSearchParams(form) });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.access_token) return j;
  const what = j.error || j.data?.error_code || r.status;
  const err = new Error(`TikTok token ${what}: ${j.error_description || j.message || 'no detail'}`);
  if (what === 'invalid_grant') err.code = 'invalid_grant';
  throw err;
}

function apiError(status, j) {
  const code = j?.error?.code || '';
  const hint = {
    access_token_invalid: 'the TikTok sign-in is no longer valid: connect again',
    scope_not_authorized: 'the sign-in did not grant video.upload: connect again and allow every permission',
    rate_limit_exceeded: 'TikTok asks to slow down (6 uploads a minute per account): try again in a minute',
    spam_risk_too_many_posts: 'this account posted too many times through the API in 24 hours',
    spam_risk_user_banned_from_posting: 'TikTok is not letting this account post right now',
    unaudited_client_can_only_post_to_private_accounts: 'the app is not audited yet: until TikTok approves it, direct posts only work while the TikTok account is set to private',
    privacy_level_option_mismatch: 'that privacy is not offered for this account right now: pick another',
    reached_active_user_cap: 'the app reached its daily limit of posting users: try tomorrow',
    url_ownership_unverified: 'TikTok wants the domain verified (only for pulling from a URL)',
  }[code];
  const err = new Error(`TikTok ${status}${code ? ` ${code}` : ''}: ${hint || j?.error?.message || 'no detail'}`);
  err.status = status;
  return err;
}

async function api(token, method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json; charset=UTF-8' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.error?.code && j.error.code !== 'ok')) throw apiError(r.status, j);
  return j.data ?? {};
}

const who = async (token) => {
  const d = await api(token, 'GET', `${API}/user/info/?fields=open_id,display_name,avatar_url`);
  return { id: d.user?.open_id, title: d.user?.display_name || 'TikTok', avatar: d.user?.avatar_url || null };
};

function saveToken(account, tok, user) {
  writeJson(tokenFile(account, 'tiktok'), {
    refresh_token: tok.refresh_token,
    refresh_expires_at: new Date(Date.now() + (tok.refresh_expires_in || 0) * 1000).toISOString(),
    open_id: tok.open_id || user?.id, display_name: user?.title, avatar: user?.avatar || null, scope: tok.scope, savedAt: new Date().toISOString(),
  }, { secret: true });
}

export async function auth(account, { signal, onUrl } = {}) {
  const a = app();
  const { code, redirectUri, verifier } = await authorizeLoopback({
    authEndpoint: AUTH, clientId: a.client_key, scopes: SCOPES,
    clientParam: 'client_key', scopeSep: ',', challengeEncoding: 'hex', callbackPath: '/callback/', extra: { disable_auto_auth: '1' }, relay: a.redirect || RELAY, signal, onUrl,
  });
  const tok = await tokenRequest({ client_key: a.client_key, client_secret: a.client_secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: verifier });
  const granted = String(tok.scope || '').split(',').map(x => x.trim());
  if (!granted.includes('video.upload')) throw new Error('TikTok 401 scope_not_authorized: the sign-in did not grant video.upload: connect again and allow every permission');
  const user = await who(tok.access_token);
  saveToken(account, tok, user);
  return user;
}

export function connected(account) {
  const t = readJson(tokenFile(account, 'tiktok'), null);
  if (!t?.refresh_token) return null;
  if (t.refresh_expires_at && Date.parse(t.refresh_expires_at) < Date.now()) return null;   // 180 days: sign in again
  return { id: t.open_id, title: t.display_name || 'TikTok', avatar: t.avatar || null };
}

// a fresh access token (they last 2 h). Refresh tokens rotate: the new one replaces the old at once, or the next refresh fails.
function session(account, { reauth = true } = {}) {
  let saved = readJson(tokenFile(account, 'tiktok'), null);
  if (!saved?.refresh_token) throw new Error(`"${account}" is not connected to TikTok: connect it in the studio (Canais) or run  node tools/publish.mjs auth ${account} tiktok`);
  let token = null;
  return {
    async token(again = false) {
      if (token && !again) return token;
      const a = app();
      try {
        const j = await tokenRequest({ client_key: a.client_key, client_secret: a.client_secret, grant_type: 'refresh_token', refresh_token: saved.refresh_token });
        saved = { ...saved, refresh_token: j.refresh_token || saved.refresh_token, refresh_expires_at: new Date(Date.now() + (j.refresh_expires_in || 0) * 1000).toISOString() };
        writeJson(tokenFile(account, 'tiktok'), saved, { secret: true });
        token = j.access_token;
      } catch (e) {
        if (e.code !== 'invalid_grant' || process.env.PUBLISH_NO_REAUTH || !reauth) throw e;
        console.log(`\nThe TikTok sign-in for "${account}" expired. Opening it again: pick the same account, then Authorize.`);
        await auth(account);
        saved = readJson(tokenFile(account, 'tiktok'));
        return this.token(true);
      }
      return token;
    },
  };
}

// the account's current name and picture; never opens a sign-in (null on any failure, saved values stay)
export async function profile(account) {
  const saved = readJson(tokenFile(account, 'tiktok'), null);
  if (!saved?.refresh_token || !hasApp()) return null;
  try {
    const me = await who(await session(account, { reauth: false }).token());
    const now = readJson(tokenFile(account, 'tiktok'), saved);   // the refresh just rotated the token: keep the new one
    if (me.id !== now.open_id) return null;
    if (me.title !== now.display_name || me.avatar !== now.avatar) writeJson(tokenFile(account, 'tiktok'), { ...now, display_name: me.title, avatar: me.avatar }, { secret: true });
    return me;
  } catch { return null; }
}

// what TikTok lets this account do right now (Direct Post UX rules: shown before posting, fetched fresh each time)
export async function creatorInfo(account) {
  const saved = readJson(tokenFile(account, 'tiktok'), null);
  if (saved?.scope && !String(saved.scope).split(',').map(x => x.trim()).includes('video.publish')) {
    throw new Error('NEEDS_TIKTOK_PUBLISH: this TikTok sign-in has no video.publish permission: turn on Direct Post in the developer app, then Reconectar');
  }
  const token = await session(account, { reauth: false }).token();
  let d;
  try { d = await api(token, 'POST', `${API}/post/publish/creator_info/query/`, {}); }
  catch (e) { if (/scope_not_authorized/.test(e.message)) throw new Error(`NEEDS_TIKTOK_PUBLISH: ${e.message}`); throw e; }
  return {
    nickname: d.creator_nickname || null, username: d.creator_username || null, avatar: d.creator_avatar_url || null,
    privacy: d.privacy_level_options || [], commentOff: !!d.comment_disabled, duetOff: !!d.duet_disabled, stitchOff: !!d.stitch_disabled,
    maxSeconds: d.max_video_post_duration_sec || null,
  };
}

// meta.tiktok: { caption }. A draft carries no caption through the API: the studio shows it with a Copy button, and the
// creator pastes it when they press Post in the app.
// choices (direct posts, picked by the user on each post, never defaulted): { mode, privacy, allowComment, allowDuet,
// allowStitch, disclose, yourBrand, brandedContent, aigc }
export function validate({ meta, cfg = {}, video, publishAt, tiktok: choices = {} }) {
  const mode = choices.mode || cfg.mode || 'draft';
  const issues = [];
  const add = (level, code, text, extra = {}) => issues.push({ level, code, text, ...extra });
  const caption = meta?.tiktok?.caption ?? '';
  if (!caption.trim()) add('warning', 'caption-empty', mode === 'direct' ? 'no TikTok caption in meta.json: the post goes without one' : 'no TikTok caption in meta.json (you paste it in the app when posting the draft)', { field: 'tiktok.caption' });
  if ([...caption].length > CAPTION_MAX) add('error', 'caption-long', `the caption is ${[...caption].length} characters; TikTok allows ${CAPTION_MAX}`, { field: 'tiktok.caption', value: [...caption].length, limit: CAPTION_MAX });
  if (video) {
    if (video.duration && video.duration > 600) add('error', 'too-long', `the video is ${Math.round(video.duration)} s; uploads through the API stop at 10 minutes`);
    if (video.duration && video.duration < 3) add('error', 'too-short', 'TikTok wants at least 3 seconds');
    if (video.width && video.height && video.width > video.height) add('warning', 'not-vertical', 'the video is horizontal: TikTok shows 9:16 best');
    if (video.bytes && video.bytes > 4 * 2 ** 30) add('error', 'file-huge', 'TikTok takes at most 4 GB');
    if (!video.audio) add('warning', 'no-audio', 'no audio track: TikTok drafts usually get a sound in the app');
  }
  if (publishAt) add('warning', 'no-schedule', mode === 'direct' ? 'TikTok has no scheduling through the API: the post goes out now' : 'TikTok drafts go now; post (or schedule) it in the app when you want it out', { value: publishAt });
  let post = null;
  if (mode === 'direct') {
    if (!PRIVACY[choices.privacy]) add('error', 'privacy-unset', 'choose who can see the TikTok post', { field: 'tiktok.privacy' });
    if (choices.disclose && !choices.yourBrand && !choices.brandedContent) add('error', 'disclosure-unset', 'say whether the post promotes yourself, a third party, or both');
    if (choices.disclose && choices.brandedContent && choices.privacy === 'SELF_ONLY') add('error', 'branded-private', 'branded content cannot be private');
    post = {
      privacy_level: choices.privacy || null, title: caption,
      disable_comment: !choices.allowComment, disable_duet: !choices.allowDuet, disable_stitch: !choices.allowStitch,
      brand_organic_toggle: !!(choices.disclose && choices.yourBrand), brand_content_toggle: !!(choices.disclose && choices.brandedContent),
      is_aigc: !!choices.aigc,
    };
  }
  const errors = issues.filter(i => i.level === 'error').map(i => i.text);
  const warnings = issues.filter(i => i.level === 'warning').map(i => i.text);
  return { errors, warnings, issues, request: { caption, mode, post }, limits: { caption: CAPTION_MAX } };
}

const printProgress = ({ sent, total, mbps }) =>
  process.stdout.write(`\r  uploading ${(100 * sent / total).toFixed(0)}%  ${(sent / 2 ** 20).toFixed(0)}/${(total / 2 ** 20).toFixed(0)} MB  ${mbps.toFixed(1)} MB/s   `);

// the chunk plan TikTok accepts for a file of `size` bytes
export function chunkPlan(size, chunk = CHUNK) {
  if (size < 5_000_000) return { chunkSize: size, count: 1 };
  if (size <= 64_000_000) return { chunkSize: size, count: 1 };
  const count = Math.floor(size / chunk);
  return { chunkSize: chunk, count };
}

// upload as a draft: init → PUT chunks in order → poll status until it reaches the inbox. Retries a chunk on 5xx / a dropped
// connection; the upload link lasts an hour, so an interrupted run starts a fresh draft next time (no half drafts appear).
export async function post({ account, cfg = {}, request, file, log = console.log, onProgress = printProgress, signal }) {
  const direct = request?.mode === 'direct';
  if (direct && !PRIVACY[request.post?.privacy_level]) throw new Error('choose who can see the TikTok post first');
  const s = session(account);
  let token = await s.token();
  const me = await who(token);
  if (cfg.openId && cfg.openId !== me.id) throw new Error(`the "${account}" TikTok sign-in is "${me.title}", but channels.json pins another account: refusing to upload to the wrong account`);
  log(`  account: ${me.title}${direct ? ' (direct post)' : ''}`);

  const size = fs.statSync(file).size;
  const { chunkSize, count } = chunkPlan(size);
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count };
  let creator = null;
  if (direct) {
    // fresh rules for this account, checked again right before sending (the user saw them on the post screen)
    creator = await creatorInfo(account);
    if (!creator.privacy.includes(request.post.privacy_level)) throw new Error('TikTok 403 privacy_level_option_mismatch: that privacy is not offered for this account right now: pick another');
    const secs = request.duration;
    if (creator.maxSeconds && secs && secs > creator.maxSeconds) throw new Error(`TIKTOK_TOO_LONG: the video is ${Math.round(secs)} s; this TikTok account can post up to ${creator.maxSeconds} s`);
  }
  const init = direct
    ? await api(token, 'POST', `${API}/post/publish/video/init/`, { post_info: request.post, source_info })
    : await api(token, 'POST', `${API}/post/publish/inbox/video/init/`, { source_info });
  if (!init.upload_url || !init.publish_id) throw new Error('TikTok gave no upload link');

  const fd = fs.openSync(file, 'r');
  const t0 = Date.now();
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
      const buf = Buffer.allocUnsafe(end - start + 1);
      fs.readSync(fd, buf, 0, buf.length, start);
      for (let attempt = 1; ; attempt++) {
        if (signal?.aborted) throw new Error('upload cancelled; posting again starts a fresh TikTok draft');
        let r;
        try {
          r = await fetch(init.upload_url, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(buf.length), 'content-range': `bytes ${start}-${end}/${size}` }, body: buf, signal });
        } catch (e) { if (signal?.aborted) throw new Error('upload cancelled; posting again starts a fresh TikTok draft'); r = { status: 0, error: e }; }
        if (r.status === 201 || r.status === 206 || r.status === 200) break;
        if (r.status === 403) throw new Error('TikTok 403: the upload link expired (it lasts an hour); post again');
        if (r.status && r.status < 500) throw new Error(`TikTok upload ${r.status}: the chunk was refused`);
        if (attempt > 6) throw new Error(`upload kept failing (${r.error?.message || r.status}); post again`);
        const wait = Math.min(60, 2 ** attempt) * 1000;
        log(`  connection trouble (${r.error?.message || r.status}), retrying in ${wait / 1000}s`);
        await new Promise(res => setTimeout(res, wait));
      }
      const sent = end + 1;
      onProgress({ sent, total: size, mbps: (sent / 2 ** 20) / Math.max(1, (Date.now() - t0) / 1000) });
    }
  } finally {
    fs.closeSync(fd);
  }

  // TikTok processes the file, then drops it in the inbox or publishes it (usually seconds; give it a few minutes)
  let status = 'PROCESSING_UPLOAD', fail = null, postIds = [];
  for (let i = 0; i < (direct ? 75 : 40) && (status === 'PROCESSING_UPLOAD' || status === 'PROCESSING_DOWNLOAD'); i++) {
    await new Promise(res => setTimeout(res, i < 5 ? 2000 : 4000));
    try {
      const d = await api(token, 'POST', `${API}/post/publish/status/fetch/`, { publish_id: init.publish_id });
      status = d.status || status; fail = d.fail_reason || null; postIds = d.publicaly_available_post_id || postIds;
    } catch (e) {
      if (e.status === 401) token = await s.token(true); else if (e.status !== 429) throw e;
    }
  }
  if (status === 'FAILED') throw new Error(`TikTok refused the video: ${fail || 'no reason given'}`);
  if (direct) {
    const user = creator?.username;
    return {
      id: init.publish_id, url: postIds[0] && user ? `https://www.tiktok.com/@${user}/video/${postIds[0]}` : (user ? `https://www.tiktok.com/@${user}` : null),
      privacy: PRIVACY[request.post.privacy_level], publishAt: null, channelTitle: creator?.nickname || me.title,
      warning: status === 'PUBLISH_COMPLETE' ? null : 'TikTok is still processing the post: it can take a few minutes to show on the profile.',
    };
  }
  const inbox = status === 'SEND_TO_USER_INBOX' || status === 'PUBLISH_COMPLETE';
  return {
    id: init.publish_id, url: null, privacy: 'draft', publishAt: null, channelTitle: me.title,
    warning: inbox ? null : 'TikTok is still processing the draft: it shows up in the app inbox in a few minutes.',
  };
}

// where each upload stands now. A draft becomes PUBLISH_COMPLETE once the creator posts it in the app; a public post then
// carries its id, so the studio can link to it. ids: publish_ids. One sign-in refresh for the whole batch; never opens a
// sign-in. → { [id]: { status, url, failReason } }
export async function drafts(account, ids) {
  const out = {};
  if (!ids.length) return out;
  const token = await session(account, { reauth: false }).token();
  let username = null;
  try { username = (await creatorInfo(account)).username; } catch { /* no video.publish: no link, the status still counts */ }
  for (const id of ids.slice(0, 25)) {   // status/fetch allows 30 a minute
    try {
      const d = await api(token, 'POST', `${API}/post/publish/status/fetch/`, { publish_id: id });
      const postId = (d.publicaly_available_post_id || [])[0] || null;
      out[id] = {
        status: d.status || null, failReason: d.fail_reason || null,
        url: postId && username ? `https://www.tiktok.com/@${username}/video/${postId}` : null,
      };
    } catch (e) { out[id] = { status: null, error: e.message }; }
  }
  return out;
}

// TikTok has no API to delete a draft or a post made from one: forget it here, and say where to delete it
export async function remove(account, id, { log = console.log } = {}) {
  log('TikTok drafts can only be deleted in the app: open the TikTok inbox (or your profile) and delete it there.');
  return { gone: false, already: false, local: true };
}
