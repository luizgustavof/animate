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
const API = 'https://open.tiktokapis.com/v2';
const SCOPES = ['user.info.basic', 'video.upload'];
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
    unaudited_client_can_only_post_to_private_accounts: 'the app is not audited yet: in sandbox only the target users can receive drafts',
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
  const d = await api(token, 'GET', `${API}/user/info/?fields=open_id,display_name`);
  return { id: d.user?.open_id, title: d.user?.display_name || 'TikTok' };
};

function saveToken(account, tok, user) {
  writeJson(tokenFile(account, 'tiktok'), {
    refresh_token: tok.refresh_token,
    refresh_expires_at: new Date(Date.now() + (tok.refresh_expires_in || 0) * 1000).toISOString(),
    open_id: tok.open_id || user?.id, display_name: user?.title, scope: tok.scope, savedAt: new Date().toISOString(),
  }, { secret: true });
}

export async function auth(account) {
  const a = app();
  const { code, redirectUri, verifier } = await authorizeLoopback({
    authEndpoint: AUTH, clientId: a.client_key, scopes: SCOPES,
    clientParam: 'client_key', scopeSep: ',', challengeEncoding: 'hex', callbackPath: '/callback/',
  });
  const tok = await tokenRequest({ client_key: a.client_key, client_secret: a.client_secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: verifier });
  const granted = String(tok.scope || '').split(',');
  if (!granted.includes('video.upload')) throw new Error('TikTok 401 scope_not_authorized: the sign-in did not grant video.upload: connect again and allow every permission');
  const user = await who(tok.access_token);
  saveToken(account, tok, user);
  return user;
}

export function connected(account) {
  const t = readJson(tokenFile(account, 'tiktok'), null);
  if (!t?.refresh_token) return null;
  if (t.refresh_expires_at && Date.parse(t.refresh_expires_at) < Date.now()) return null;   // 180 days: sign in again
  return { id: t.open_id, title: t.display_name || 'TikTok' };
}

// a fresh access token (they last 2 h). Refresh tokens rotate: the new one replaces the old at once, or the next refresh fails.
function session(account) {
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
        if (e.code !== 'invalid_grant' || process.env.PUBLISH_NO_REAUTH) throw e;
        console.log(`\nThe TikTok sign-in for "${account}" expired. Opening it again: pick the same account, then Authorize.`);
        await auth(account);
        saved = readJson(tokenFile(account, 'tiktok'));
        return this.token(true);
      }
      return token;
    },
  };
}

// meta.tiktok: { caption }. A draft carries no caption through the API: the studio shows it with a Copy button, and the
// creator pastes it when they press Post in the app.
export function validate({ meta, cfg = {}, video, publishAt }) {
  const issues = [];
  const add = (level, code, text, extra = {}) => issues.push({ level, code, text, ...extra });
  const caption = meta?.tiktok?.caption ?? '';
  if (!caption.trim()) add('warning', 'caption-empty', 'no TikTok caption in meta.json (you paste it in the app when posting the draft)', { field: 'tiktok.caption' });
  if ([...caption].length > CAPTION_MAX) add('error', 'caption-long', `the caption is ${[...caption].length} characters; TikTok allows ${CAPTION_MAX}`, { field: 'tiktok.caption', value: [...caption].length, limit: CAPTION_MAX });
  if (video) {
    if (video.duration && video.duration > 600) add('error', 'too-long', `the video is ${Math.round(video.duration)} s; uploads through the API stop at 10 minutes`);
    if (video.duration && video.duration < 3) add('error', 'too-short', 'TikTok wants at least 3 seconds');
    if (video.width && video.height && video.width > video.height) add('warning', 'not-vertical', 'the video is horizontal: TikTok shows 9:16 best');
    if (video.bytes && video.bytes > 4 * 2 ** 30) add('error', 'file-huge', 'TikTok takes at most 4 GB');
    if (!video.audio) add('warning', 'no-audio', 'no audio track: TikTok drafts usually get a sound in the app');
  }
  if (publishAt) add('warning', 'no-schedule', 'TikTok drafts go now; post (or schedule) it in the app when you want it out', { value: publishAt });
  const errors = issues.filter(i => i.level === 'error').map(i => i.text);
  const warnings = issues.filter(i => i.level === 'warning').map(i => i.text);
  return { errors, warnings, issues, request: { caption, mode: cfg.mode || 'draft' }, limits: { caption: CAPTION_MAX } };
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
  if ((cfg.mode || 'draft') !== 'draft') throw new Error('TikTok direct posting needs the app audit first; keep "mode": "draft" (docs/connect-tiktok.md)');
  const s = session(account);
  let token = await s.token();
  const me = await who(token);
  if (cfg.openId && cfg.openId !== me.id) throw new Error(`the "${account}" TikTok sign-in is "${me.title}", but channels.json pins another account: refusing to upload to the wrong account`);
  log(`  account: ${me.title}`);

  const size = fs.statSync(file).size;
  const { chunkSize, count } = chunkPlan(size);
  const init = await api(token, 'POST', `${API}/post/publish/inbox/video/init/`, {
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count },
  });
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

  // TikTok processes the file, then drops it in the inbox (usually seconds; give it two minutes)
  let status = 'PROCESSING_UPLOAD', fail = null;
  for (let i = 0; i < 40 && status === 'PROCESSING_UPLOAD'; i++) {
    await new Promise(res => setTimeout(res, i < 5 ? 2000 : 4000));
    try {
      const d = await api(token, 'POST', `${API}/post/publish/status/fetch/`, { publish_id: init.publish_id });
      status = d.status || status; fail = d.fail_reason || null;
    } catch (e) {
      if (e.status === 401) token = await s.token(true); else if (e.status !== 429) throw e;
    }
  }
  if (status === 'FAILED') throw new Error(`TikTok refused the video: ${fail || 'no reason given'}`);
  const inbox = status === 'SEND_TO_USER_INBOX' || status === 'PUBLISH_COMPLETE';
  return {
    id: init.publish_id, url: null, privacy: 'draft', publishAt: null, channelTitle: me.title,
    warning: inbox ? null : 'TikTok is still processing the draft: it shows up in the app inbox in a few minutes.',
  };
}

// TikTok has no API to delete a draft or a post made from one: forget it here, and say where to delete it
export async function remove(account, id, { log = console.log } = {}) {
  log('TikTok drafts can only be deleted in the app: open the TikTok inbox (or your profile) and delete it there.');
  return { gone: false, already: false, local: true };
}
