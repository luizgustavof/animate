// YouTube (Shorts and regular videos) through the YouTube Data API v3: OAuth sign-in per channel, a resumable chunked upload
// that survives a dropped connection (and a killed run: the session link is kept in state.json for a week), scheduling with
// publishAt (YouTube publishes it at that time; this computer can be off), and view / like / comment counts for the feedback loop.
// Quota: 10,000 units a day per Google Cloud project; an upload costs 1,600 (so ~6 a day), a stats read 1.
// A project that YouTube has not audited gets every API upload locked private; see SKILL.md → "Connect YouTube".
import fs from 'node:fs';
import path from 'node:path';
import { SECRETS, tokenFile, readJson, writeJson } from '../lib/store.mjs';
import { authorizeLoopback } from '../lib/oauth.mjs';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
// upload + read, and the full "youtube" scope for managing what was posted (delete a scheduled video; later channel branding).
// Sign-ins saved before the manage scope existed lack it: remove() asks for a new sign-in once.
const MANAGE = 'https://www.googleapis.com/auth/youtube';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', MANAGE];
const CHUNK = 64 * 256 * 1024;   // 16 MiB; YouTube wants multiples of 256 KiB
export const CLIENT = path.join(SECRETS, 'google-oauth-client.json');
const CLIENT_FILE = CLIENT;

function client() {
  const j = readJson(CLIENT_FILE, null);
  if (!j) throw new Error(`missing ${CLIENT_FILE}: create an OAuth client of type "Desktop app" in Google Cloud Console and save its JSON there (SKILL.md → "Connect YouTube")`);
  const c = j.installed || j.web || j;
  if (!c.client_id || !c.client_secret) throw new Error(`${CLIENT_FILE} has no client_id / client_secret`);
  return c;
}

async function tokenRequest(form) {
  const r = await fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return j;
  if (j.error === 'invalid_grant') {
    const err = new Error('the YouTube sign-in expired or was revoked: run auth again. (An OAuth app in "Testing" drops sign-ins after 7 days.)');
    err.code = 'invalid_grant';
    throw err;
  }
  throw new Error(`Google token ${r.status}: ${j.error_description || j.error || 'no detail'}`);
}

function apiError(status, j) {
  const reason = j.error?.errors?.[0]?.reason || j.error?.status || '';
  const hint = {
    quotaExceeded: 'the project used up its daily API quota (an upload costs 1,600 of 10,000 units); it resets at midnight Pacific time',
    uploadLimitExceeded: "this channel reached YouTube's upload limit for today",
    youtubeSignupRequired: 'this Google account has no YouTube channel yet',
    forbidden: 'this sign-in may not upload to that channel',
    invalidTitle: 'YouTube rejected the title',
    invalidDescription: 'YouTube rejected the description',
    invalidTags: 'YouTube rejected the tags',
    invalidPublishAt: 'publishAt must be in the future (and the video private until then)',
  }[reason];
  const err = new Error(`YouTube ${status}${reason ? ` ${reason}` : ''}: ${hint || j.error?.message || 'no detail'}`);
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
  if (!r.ok) throw apiError(r.status, j);
  return j;
}

async function channelOf(token) {
  const j = await api(token, 'GET', `${API}/channels?part=snippet&mine=true`);
  const c = j.items?.[0];
  if (!c) throw new Error('this Google account has no YouTube channel');
  return { id: c.id, title: c.snippet.title };
}

// a fresh access token from the saved refresh token (they last an hour; a long upload asks again). When the sign-in has
// expired (every 7 days while the OAuth app is in "Testing") the sign-in page opens again by itself and the run carries on
// once the user clicks Allow; PUBLISH_NO_REAUTH=1 makes it fail instead (unattended runs).
function session(account) {
  let saved = readJson(tokenFile(account, 'youtube'), null);
  if (!saved) throw new Error(`"${account}" is not connected to YouTube: run  node tools/publish.mjs setup`);
  let token = null;
  const refresh = async () => {
    const c = client();
    const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh_token, client_id: c.client_id, client_secret: c.client_secret });
    return j.access_token;
  };
  return {
    saved,
    async token(again = false) {
      if (token && !again) return token;
      try { token = await refresh(); }
      catch (e) {
        if (e.code !== 'invalid_grant' || process.env.PUBLISH_NO_REAUTH) throw e;
        console.log(`\nThe YouTube sign-in for "${account}" expired (weekly while the app is in Testing). Opening it again: pick the same account and channel, then Allow.`);
        await auth(account);
        saved = readJson(tokenFile(account, 'youtube'));
        token = await refresh();
      }
      return token;
    },
  };
}

export const hasClient = () => fs.existsSync(CLIENT_FILE);

// take the client JSON the user downloaded from Google Cloud Console and keep it with the secrets (and out of Downloads)
export function importClient(src) {
  const j = readJson(src);
  if (j.web) throw new Error(`${path.basename(src)} is a "Web application" client: create one of type "Desktop app" instead`);
  if (!j.installed?.client_id || !j.installed?.client_secret) throw new Error(`${path.basename(src)} is not a Google OAuth client file`);
  writeJson(CLIENT_FILE, j, { secret: true });
  fs.rmSync(src);
}

export async function auth(account) {
  const c = client();
  const { code, redirectUri, verifier } = await authorizeLoopback({
    authEndpoint: AUTH, clientId: c.client_id, scopes: SCOPES,
    extra: { access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true' },
  });
  const tok = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: c.client_id, client_secret: c.client_secret });
  if (!tok.refresh_token) throw new Error('Google sent no refresh token: remove the app at https://myaccount.google.com/permissions and run auth again');
  const ch = await channelOf(tok.access_token);
  writeJson(tokenFile(account, 'youtube'), { refresh_token: tok.refresh_token, scope: tok.scope, channelId: ch.id, channelTitle: ch.title, savedAt: new Date().toISOString() }, { secret: true });
  return ch;
}

export function connected(account) {
  const t = readJson(tokenFile(account, 'youtube'), null);
  return t && { id: t.channelId, title: t.channelTitle };
}

const bytes = s => Buffer.byteLength(s, 'utf8');
// YouTube counts a tag with a space as if it were quoted, and the commas between tags
const tagsLength = tags => tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0), 0) + Math.max(0, tags.length - 1);

// meta.youtube: { title, description, tags }; cfg: the channel's platforms.youtube block
export function validate({ meta, cfg, channel, video, publishAt, privacy }) {
  const errors = [], warnings = [];
  // every finding carries a code + numbers (the studio words it in the user's language) and an English line (the CLI prints it)
  const issues = [];
  const add = (level, code, text, extra = {}) => { issues.push({ level, code, text, ...extra }); (level === 'error' ? errors : warnings).push(text); };
  const m = meta.youtube;
  if (!m) { add('error', 'no-block', 'meta.json has no "youtube" block'); return { errors, warnings, issues, request: null }; }
  const title = String(m.title || '').trim();
  const description = String(m.description || '').trim();
  const tags = [...new Set([...(cfg.tags || []), ...(m.tags || [])].map(t => String(t).replace(/^#/, '').trim()).filter(Boolean))];

  if (!title) add('error', 'title-empty', 'youtube.title is empty', { field: 'title' });
  if (title.length > 100) add('error', 'title-long', `youtube.title is ${title.length} characters (max 100)`, { field: 'title', value: title.length, limit: 100 });
  else if (title.length > 70) add('warning', 'title-feed', `youtube.title is ${title.length} characters: the Shorts feed shows about 40-70`, { field: 'title', value: title.length, limit: 70 });
  if (/[<>]/.test(title + description)) add('error', 'angle-brackets', 'YouTube refuses < and > in the title and description', { field: /[<>]/.test(title) ? 'title' : 'description' });
  if (bytes(description) > 5000) add('error', 'description-long', `youtube.description is ${bytes(description)} bytes (max 5000)`, { field: 'description', value: bytes(description), limit: 5000 });
  const hashtags = description.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (hashtags.length > 60) add('error', 'hashtags-ignored', `${hashtags.length} hashtags in the description: past 60 YouTube ignores them all`, { field: 'description', value: hashtags.length, limit: 60 });
  else if (hashtags.length > 8) add('warning', 'hashtags-many', `${hashtags.length} hashtags: 3-5 relevant ones work better; only the first 3 show above the title`, { field: 'description', value: hashtags.length, limit: 8 });
  if (tagsLength(tags) > 500) add('error', 'tags-long', `tags add up to ${tagsLength(tags)} characters (max 500)`, { field: 'tags', value: tagsLength(tags), limit: 500 });
  if (typeof cfg.madeForKids !== 'boolean') add('error', 'made-for-kids', 'set "madeForKids": true or false on the channel\'s youtube block (a legal declaration, COPPA; never guessed)', { field: 'channel' });

  const short = video.height >= video.width && video.duration <= 180;
  if (!short) add('warning', 'not-short', `${video.width}x${video.height}, ${video.duration.toFixed(0)}s: not a Short (needs vertical or square, at most 3 minutes); it goes up as a regular video`, { field: 'video' });
  if (!video.audio) add('warning', 'no-audio', 'the video has no audio track', { field: 'video' });
  if (video.bytes > 256 * 2 ** 30) add('error', 'file-huge', 'the file is over 256 GB', { field: 'video' });

  const finalPrivacy = privacy || cfg.privacy || 'public';
  if (!['public', 'unlisted', 'private'].includes(finalPrivacy)) add('error', 'privacy', `privacy "${finalPrivacy}": use public, unlisted or private`, { field: 'privacy' });
  if (publishAt && publishAt.getTime() < Date.now() + 15 * 60e3) add('error', 'too-soon', `publishAt ${publishAt.toISOString()} is less than 15 minutes away`, { field: 'time' });

  const lang = cfg.language || channel.language;
  const request = {
    snippet: {
      title, description, tags,
      categoryId: String(cfg.categoryId || '1'),   // 1 = Film & Animation
      ...(lang ? { defaultLanguage: lang, defaultAudioLanguage: lang } : {}),
    },
    status: {
      // a scheduled video stays private until publishAt, then YouTube makes it public
      privacyStatus: publishAt ? 'private' : finalPrivacy,
      ...(publishAt ? { publishAt: publishAt.toISOString() } : {}),
      selfDeclaredMadeForKids: cfg.madeForKids,
      containsSyntheticMedia: Boolean(cfg.syntheticMedia),
      embeddable: true,
      license: 'youtube',
    },
  };
  return { errors, warnings, issues, request, notify: cfg.notifySubscribers !== false, short, limits: { title: 100, titleFeed: 70, description: 5000, tags: 500 } };
}

const printProgress = ({ sent, total, mbps }) =>
  process.stdout.write(`\r  uploading ${(100 * sent / total).toFixed(0)}%  ${(sent / 2 ** 20).toFixed(0)}/${(total / 2 ** 20).toFixed(0)} MB  ${mbps.toFixed(1)} MB/s   ${sent === total ? '\n' : ''}`);

// upload: { account, cfg, request, notify, file, resume: { uploadUrl, size } | null, onSession({ uploadUrl, size }), log, onProgress,
// signal } — an aborted signal stops between chunks; the session kept in state.json lets the next run resume
export async function post({ account, cfg, request, notify, file, resume, onSession, log = console.log, onProgress = printProgress, signal }) {
  const s = session(account);
  let token = await s.token();
  const ch = await channelOf(token);
  if (cfg.channelId && cfg.channelId !== ch.id) throw new Error(`the "${account}" sign-in is channel "${ch.title}" (${ch.id}), but channels.json pins ${cfg.channelId}: refusing to upload to the wrong channel`);
  log(`  channel: ${ch.title} (${ch.id})`);

  const size = fs.statSync(file).size;
  const withAuth = async (fn) => {
    let r = await fn(token);
    if (r.status === 401) { token = await s.token(true); r = await fn(token); }
    return r;
  };

  // where the server is in the upload (or null when the session is gone)
  const offsetOf = async (url) => {
    const r = await withAuth(t => fetch(url, { method: 'PUT', headers: { authorization: `Bearer ${t}`, 'content-range': `bytes */${size}` } }));
    if (r.status === 200 || r.status === 201) return { done: await r.json() };
    if (r.status === 308) { const range = r.headers.get('range'); return { offset: range ? Number(range.split('-')[1]) + 1 : 0 }; }
    return null;
  };

  let url = resume?.uploadUrl && resume.size === size ? resume.uploadUrl : null;
  let at = 0, done = null;
  if (url) {
    const o = await offsetOf(url).catch(() => null);
    if (!o) url = null;
    else if (o.done) done = o.done;
    else { at = o.offset; log(`  resuming at ${(at / 2 ** 20).toFixed(0)} MB`); }
  }
  if (!url && !done) {
    const q = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status', notifySubscribers: String(notify) });
    const r = await withAuth(t => fetch(`${UPLOAD}?${q}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${t}`, 'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4',
      },
      body: JSON.stringify(request),
    }));
    if (!r.ok) throw apiError(r.status, await r.json().catch(() => ({})));
    url = r.headers.get('location');
    if (!url) throw new Error('YouTube gave no upload session link');
    onSession?.({ uploadUrl: url, size });
  }

  const fd = fs.openSync(file, 'r');
  try {
    let failures = 0;
    const t0 = Date.now();
    while (!done) {
      if (signal?.aborted) throw new Error('upload cancelled; posting again resumes where it stopped');
      const n = Math.min(CHUNK, size - at);
      const buf = Buffer.allocUnsafe(n);
      fs.readSync(fd, buf, 0, n, at);
      let r;
      try {
        r = await withAuth(t => fetch(url, { method: 'PUT', headers: { authorization: `Bearer ${t}`, 'content-type': 'video/mp4', 'content-range': `bytes ${at}-${at + n - 1}/${size}` }, body: buf }));
      } catch (e) { r = { status: 0, error: e }; }
      if (r.status === 200 || r.status === 201) { done = await r.json(); break; }
      if (r.status === 308) {
        const range = r.headers.get('range');
        at = range ? Number(range.split('-')[1]) + 1 : 0;
        failures = 0;
        const mbps = (at / 2 ** 20) / Math.max(1, (Date.now() - t0) / 1000);
        if (at < size) onProgress({ sent: at, total: size, mbps });
        continue;
      }
      if (r.status && r.status < 500 && r.status !== 429) throw apiError(r.status, await r.json().catch(() => ({})));
      if (++failures > 6) throw new Error(`upload kept failing (${r.error?.message || r.status}); run post again to resume where it stopped`);
      const wait = Math.min(60, 2 ** failures) * 1000;
      log(`  connection trouble (${r.error?.message || r.status}), retrying in ${wait / 1000}s`);
      await new Promise(res => setTimeout(res, wait));
      const o = await offsetOf(url).catch(() => null);
      if (o?.done) done = o.done; else if (o) at = o.offset;
    }
    onProgress({ sent: size, total: size, mbps: (size / 2 ** 20) / Math.max(1, (Date.now() - t0) / 1000) });
  } finally {
    fs.closeSync(fd);
  }

  const st = done.status || {};
  const wanted = request.status.privacyStatus;
  const locked = wanted !== 'private' && st.privacyStatus === 'private';
  return {
    id: done.id,
    url: `https://www.youtube.com/shorts/${done.id}`,
    channelId: ch.id, channelTitle: ch.title,
    privacy: st.privacyStatus, publishAt: st.publishAt || null,
    warning: locked ? 'YouTube locked this upload private: the Google Cloud project has not passed the YouTube API audit yet (SKILL.md → "Connect YouTube"). Make it public in YouTube Studio meanwhile.' : null,
  };
}

// views / likes / comments for the videos this account posted (1 quota unit per 50 videos)
export async function stats(account, ids) {
  const s = session(account);
  const token = await s.token();
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await api(token, 'GET', `${API}/videos?part=statistics,status&id=${ids.slice(i, i + 50).join(',')}`);
    for (const v of j.items || []) {
      out[v.id] = {
        views: Number(v.statistics.viewCount || 0), likes: Number(v.statistics.likeCount || 0),
        comments: Number(v.statistics.commentCount || 0), privacy: v.status.privacyStatus,
      };
    }
  }
  return out;
}

// delete a posted video (scheduled, private or public). 50 quota units. A video already gone (deleted in YouTube Studio)
// counts as removed. Returns { gone: true, already: boolean }.
export async function remove(account, id, { log = console.log } = {}) {
  let s = session(account);
  const scopes = String(s.saved.scope || '').split(/\s+/);
  if (!scopes.includes(MANAGE)) {
    if (process.env.PUBLISH_NO_REAUTH) throw new Error('NEEDS_RECONNECT: deleting needs one new YouTube sign-in with permission to manage videos');
    log('Deleting needs one new YouTube sign-in with permission to manage videos. Opening it: pick the same account and channel, then Allow.');
    await auth(account);
    s = session(account);
  }
  const pinned = s.saved.channelId;
  const token = await s.token();
  const r = await fetch(`${API}/videos?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  if (r.status === 204 || r.ok) return { gone: true, already: false };
  const j = await r.json().catch(() => ({}));
  const reason = j.error?.errors?.[0]?.reason || '';
  if (r.status === 404 || reason === 'videoNotFound') return { gone: true, already: true };
  if (r.status === 403 && (reason === 'forbidden' || reason === 'insufficientPermissions')) {
    throw new Error(`YouTube 403 ${reason}: this sign-in can't delete that video (is it on ${pinned ? `channel ${pinned}` : 'this channel'}?)`);
  }
  throw apiError(r.status, j);
}
