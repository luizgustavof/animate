#!/usr/bin/env node
// The Estúdio: a local panel for the channels, served on 127.0.0.1 and opened in the browser.
//   node tools/studio.mjs [--port 4747] [--no-open] [--dev]     (run from the project folder: the one with pieces/ and publish/)
// Serves the built UI (studio/dist; built once with npm when missing) and a JSON API. Every /api and /media request must carry
// the token printed in the opening URL (header x-studio-token, or ?t= for media), so no web page can drive this server.
// The flow lives in lib/ (publisher, writer, setup, jobs); this file only routes. See docs/architecture.md.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SECRETS, resolvePiece, listPieces, loadChannels, channelFor, readJson, writeJson, metaFile, loadState, videoFile, probe, repin } from './lib/store.mjs';
import { PLATFORMS, LABELS, platformState } from './lib/platforms.mjs';
import { overview, publish, unpublish, nextSlot, refreshStats, refreshDrafts } from './lib/publisher.mjs';
import { connections, ensureGoogleKey } from './lib/setup.mjs';
import * as jobs from './lib/jobs.mjs';
import { write as writeWords } from './lib/writer.mjs';
import { openBrowser } from './lib/oauth.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(HERE, '..', 'studio');
const DIST = path.join(UI, 'dist');
const ROOT = process.cwd();
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const PORT = Number(opt('port') || process.env.STUDIO_PORT || 4747);
// one token per computer, kept with the secrets: bookmarks and the desktop shortcut keep working across restarts
const TOKEN = process.env.STUDIO_TOKEN || (() => {
  const f = path.join(SECRETS, 'studio-token');
  try { const t = fs.readFileSync(f, 'utf8').trim(); if (t.length >= 20) return t; } catch {}
  const t = crypto.randomBytes(18).toString('base64url');
  fs.mkdirSync(SECRETS, { recursive: true });
  fs.writeFileSync(f, t, { mode: 0o600 });
  return t;
})();
const DEV = argv.includes('--dev');

// ---------- helpers ----------
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};
const fail = (res, code, message, extra = {}) => json(res, code, { error: message, ...extra });
async function body(req, limit = 1 << 20) {
  let n = 0; const chunks = [];
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('request too large'), { status: 413 }); chunks.push(c); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

// the channel as the browser may see it: profile and settings, never tokens
function publicChannel(name, c, conn) {
  return {
    id: name, name: c.name || name, series: c.series || null, language: c.language || null,
    audience: c.audience || '', voice: c.voice || '', hashtags: c.hashtags || { always: [], pool: [] },
    schedule: c.schedule || [], approval: c.approval || 'ask', color: c.color || null, openedAt: c.openedAt || null,
    platforms: Object.fromEntries(Object.entries(c.platforms || {}).map(([p, cfg]) => [p, {
      label: LABELS[p] || p, state: platformState(p), connected: conn?.[p]?.connected || null, needs: conn?.[p]?.needs || [],
      privacy: cfg.privacy || null, madeForKids: cfg.madeForKids ?? null, syntheticMedia: cfg.syntheticMedia ?? null,
    }])),
  };
}

const rowOut = (r) => ({
  slug: r.slug, title: r.title, series: r.series, channel: r.channel, meta: r.meta, todo: r.todo,
  render: r.render && { file: r.render.file, duration: r.render.duration, width: r.render.width, height: r.render.height, bytes: r.render.bytes },
  posts: Object.fromEntries(Object.entries(r.posts).map(([k, e]) => [k, postOut(e)])),
});
const postOut = (e) => ({
  platform: e.platform, channel: e.channel, status: e.status, id: e.id || null, url: e.url || null, title: e.title || null,
  publishAt: e.publishAt || null, postedAt: e.postedAt || null, warning: e.warning || null, stats: e.stats || null,
  progress: e.status === 'uploading' ? { size: e.size || null } : null,
});

function pieceBySlug(slug) {
  if (!/^[\w.-]+$/.test(slug)) throw Object.assign(new Error('bad piece name'), { status: 400 });
  return resolvePiece(path.join(ROOT, 'pieces', slug), ROOT);
}

// the live check of a draft: errors and warnings per platform, from each platform's own validate()
function checks(p, meta, { at, privacy } = {}) {
  const channels = loadChannels(ROOT);
  const [channelName, channel] = channelFor(p, channels);
  const out = {};
  let video = null;
  try { video = probe(videoFile(p)); } catch {}
  for (const [platform, cfg] of Object.entries(channel.platforms || {})) {
    if (platformState(platform) !== 'ready') { out[platform] = { state: platformState(platform) }; continue; }
    if (!video) { out[platform] = { state: 'ready', errors: ['the episode has no render yet'], warnings: [] }; continue; }
    let publishAt = null;
    try { publishAt = at === 'next' ? nextSlot(ROOT, channelName, channel, platform) : at ? new Date(at) : null; } catch {}
    const v = PLATFORMS[platform].validate({ meta, cfg, channel, video, publishAt, privacy });
    out[platform] = { state: 'ready', errors: v.errors, warnings: v.warnings, issues: v.issues || [], limits: v.limits || null, short: v.short ?? null, publishAt: publishAt?.toISOString() || null };
  }
  return { channel: channelName, platforms: out };
}

// small poster frame for lists (never the 1080x1920 master in a list)
function poster(p, width) {
  const dir = path.join(p.dir, 'publish', 'cache');
  const out = path.join(dir, `poster-${width}.jpg`);
  const src = videoFile(p);
  const st = fs.statSync(src);
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > st.mtimeMs) return out;
  fs.mkdirSync(dir, { recursive: true });
  const dur = probe(src).duration || 10;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.min(dur * 0.32, dur - 0.5)), '-i', src, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out]);
  if (r.status !== 0) throw new Error('could not make a poster frame');
  return out;
}

// a read stream piped to the response that can't take the server down: a file removed mid-request (a rebuild emptying dist/,
// a render being replaced) ends that one response instead of throwing an unhandled 'error'
function pipeFile(file, res, opts) {
  const rs = fs.createReadStream(file, opts);
  rs.on('error', () => { if (!res.headersSent) res.writeHead(503, { 'retry-after': '1' }); res.end(); });
  res.on('close', () => rs.destroy());
  rs.pipe(res);
}

function sendFile(req, res, file, type) {
  const st = fs.statSync(file);
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=60' };
  if (range) {
    const start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start < 0) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    return pipeFile(file, res, { start, end });
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  pipeFile(file, res);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let file = path.join(DIST, decodeURIComponent(pathname));
  if (!file.startsWith(DIST)) return fail(res, 400, 'bad path');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');   // SPA routes
  if (!fs.existsSync(file)) { res.writeHead(503, { 'retry-after': '1', 'content-type': 'text/plain; charset=utf-8' }); return res.end('O Estúdio está sendo atualizado. Recarregue em um instante.'); }
  const ext = path.extname(file);
  const immutable = pathname.startsWith('/assets/');
  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  pipeFile(file, res);
}

// ---------- SSE: one stream per tab ----------
const streams = new Set();
jobs.subscribe((ev) => {
  const line = `event: job\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of streams) res.write(line);
});
setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 25e3).unref();

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

route('GET', '/api/state', (req, res) => {
  const conn = connections(ROOT);
  const channels = loadChannels(ROOT);
  json(res, 200, {
    googleKey: conn.googleKey,
    tiktokApp: conn.tiktokApp,
    channels: Object.entries(channels).map(([n, c]) => publicChannel(n, c, conn.channels[n])),
    pieces: overview(ROOT, { strict: true }).map(rowOut),
    jobs: jobs.list(),
  });
});

route('GET', '/api/pieces/:slug', (req, res, { slug }) => {
  const p = pieceBySlug(slug);
  const meta = readJson(metaFile(p), null);
  const script = readJson(path.join(p.dir, 'voice', 'script.json'), null);
  const row = overview(ROOT, { strict: true }).find(r => r.slug === slug);
  json(res, 200, {
    ...rowOut(row),
    meta,
    lines: script?.lines?.map(l => ({ id: l.id, text: l.text })) || [],
    checks: meta ? checks(p, meta) : null,
    jobs: jobs.list().filter(j => j.target === slug),
  });
});

route('POST', '/api/pieces/:slug/check', async (req, res, { slug }) => {
  const p = pieceBySlug(slug);
  const b = await body(req);
  json(res, 200, checks(p, b.meta || {}, { at: b.at, privacy: b.privacy }));
});

route('PUT', '/api/pieces/:slug/meta', async (req, res, { slug }) => {
  const p = pieceBySlug(slug);
  const b = await body(req);
  if (!b.meta || typeof b.meta !== 'object') return fail(res, 400, 'meta missing');
  const prev = readJson(metaFile(p), {});
  const meta = { ...prev, ...b.meta, editedAt: new Date().toISOString() };
  writeJson(metaFile(p), meta);
  json(res, 200, { meta, checks: checks(p, meta) });
});

route('POST', '/api/pieces/:slug/words', (req, res, { slug }) => {
  const p = pieceBySlug(slug);
  const [channelName, channel] = channelFor(p, loadChannels(ROOT));
  const job = jobs.start('words', slug, async ({ signal, emit }) => {
    const meta = await writeWords(p, channelName, channel, {
      signal, emit,
      validate: (m) => Object.values(checks(p, m).platforms).flatMap(x => x.errors || []),
    });
    const prev = readJson(metaFile(p), {});
    const merged = { ...prev, ...meta };
    writeJson(metaFile(p), merged);
    return { meta: merged };
  });
  json(res, 202, job);
});

route('POST', '/api/pieces/:slug/publish', async (req, res, { slug }) => {
  const p = pieceBySlug(slug);
  const b = await body(req);
  const job = jobs.start('publish', slug, async ({ signal, emit }) => {
    const r = await publish(p, { platform: b.platforms, at: b.at || null, privacy: b.privacy || undefined, tiktok: b.tiktok || undefined, signal }, (e) => emit({ ...e, type: `publish:${e.type}` }));
    return r;
  });
  json(res, 202, job);
});

// take a post back (delete it on the platform). The body must name the post and repeat the episode's slug, so a stray
// request can't delete anything: { key: "festa/youtube", confirm: "<slug>" }.
route('POST', '/api/pieces/:slug/unpublish', async (req, res, { slug }) => {
  const p = pieceBySlug(slug);
  const b = await body(req);
  if (b.confirm !== slug || typeof b.key !== 'string') return fail(res, 400, 'confirm with the episode slug and the post key');
  if (!loadState(p).posts[b.key]) return fail(res, 404, `nothing posted as ${b.key}`);
  const job = jobs.start('unpublish', `${slug}:${b.key}`, async ({ emit }) => unpublish(p, { key: b.key }, (e) => emit({ ...e, type: `unpublish:${e.type}` })));
  json(res, 202, job);
});

// "Agendar prontos": every rendered episode with words and nothing posted yet, each into its channel's next free slot,
// one after the other (so each takes a different slot). The preview shows exactly what will go where, before anything moves.
function batchPlan(slugs) {
  const channels = loadChannels(ROOT);
  const taken = {};   // channel/platform → [ms]
  const plan = [];
  for (const r of overview(ROOT, { strict: true })) {
    if (slugs && !slugs.includes(r.slug)) continue;
    if (!r.channel || !r.render || !r.meta || !r.todo.length) continue;
    const c = channels[r.channel];
    const at = {};
    for (const platform of r.todo) {
      const key = `${r.channel}/${platform}`;
      try {
        const d = nextSlot(ROOT, r.channel, c, platform, { extraTaken: taken[key] || [] });
        (taken[key] ||= []).push(d.getTime());
        at[platform] = d.toISOString();
      } catch { at[platform] = null; }
    }
    plan.push({ slug: r.slug, title: r.title, channel: r.channel, platforms: r.todo, at });
  }
  return plan;
}
route('GET', '/api/batch', (req, res) => json(res, 200, batchPlan(null)));
route('POST', '/api/batch', async (req, res) => {
  const b = await body(req);
  const plan = batchPlan(Array.isArray(b.slugs) ? b.slugs : null);
  if (!plan.length) return fail(res, 400, 'nothing ready to schedule');
  const job = jobs.start('batch', 'all', async ({ signal, emit }) => {
    const done = [];
    for (const item of plan) {
      if (signal.aborted) throw new Error('cancelled');
      emit({ type: 'log', message: `${item.title}` , slug: item.slug });
      const p = pieceBySlug(item.slug);
      const r = await publish(p, { platform: item.platforms, at: 'next', signal }, (e) => emit({ ...e, type: `publish:${e.type}`, slug: item.slug }));
      done.push({ slug: item.slug, ok: r.ok, results: r.results.map(x => ({ platform: x.platform, status: x.status, error: x.error || null })) });
    }
    return { done };
  });
  json(res, 202, job);
});

route('POST', '/api/jobs/:id/cancel', (req, res, { id }) => json(res, 200, { cancelled: jobs.cancel(id) }));
route('GET', '/api/jobs', (req, res) => json(res, 200, jobs.list()));

route('GET', '/api/channels/:name/next-slot', (req, res, { name }) => {
  const channels = loadChannels(ROOT);
  const c = channels[name];
  if (!c) return fail(res, 404, 'no such channel');
  const out = {};
  for (const platform of Object.keys(c.platforms || {})) {
    if (platformState(platform) !== 'ready') continue;
    try { out[platform] = nextSlot(ROOT, name, c, platform).toISOString(); } catch (e) { out[platform] = null; }
  }
  json(res, 200, out);
});

route('POST', '/api/channels/:name/connect/:platform', (req, res, { name, platform }) => {
  const channels = loadChannels(ROOT);
  const c = channels[name];
  if (!c?.platforms?.[platform]) return fail(res, 404, 'no such channel or platform');
  if (platformState(platform) !== 'ready') return fail(res, 400, `${LABELS[platform] || platform} is not built yet`);
  const account = c.platforms[platform].account || name;
  const job = jobs.start('connect', `${name}/${platform}`, async ({ signal, emit }) => {
    if (platform === 'youtube' && !ensureGoogleKey()) throw new Error('NEEDS_GOOGLE_KEY');
    if (platform === 'tiktok' && !PLATFORMS.tiktok.hasApp()) throw new Error('NEEDS_TIKTOK_APP');
    emit({ type: 'log', message: platform === 'tiktok'
      ? 'Abrimos o login do TikTok no seu navegador. Entre na conta do canal e clique em Autorizar.'
      : 'Abrimos o login no seu navegador. Escolha a conta e o canal e clique em Permitir.' });
    const who = await PLATFORMS[platform].auth(account, { signal, onUrl: (url) => emit({ type: 'signin-url', url }) });
    const pinned = c.platforms[platform].channelId || c.platforms[platform].openId;
    if (pinned && who?.id && pinned !== who.id && repin(ROOT, name, platform, who.id)) {
      emit({ type: 'log', message: `Canal trocado: agora ${c.name || name} envia para ${who.title}.` });
    }
    return who;
  }, { replace: true });   // a new click always starts a fresh sign-in
  json(res, 202, job);
});

// TikTok's rules for this account right now (who can see, interactions, max length): the post screen shows them fresh
route('GET', '/api/channels/:name/tiktok/creator', async (req, res, { name }) => {
  const c = loadChannels(ROOT)[name];
  if (!c?.platforms?.tiktok) return fail(res, 404, 'no TikTok on this channel');
  try { json(res, 200, await PLATFORMS.tiktok.creatorInfo(c.platforms.tiktok.account || name)); }
  catch (e) { fail(res, 400, e.message); }
});

// the user's own TikTok developer app: they paste Client key + Client secret once. Write-only: nothing about it is ever
// returned except "set up or not" in /api/state.
route('PUT', '/api/platforms/tiktok/app', async (req, res) => {
  const b = await body(req);
  try { PLATFORMS.tiktok.saveApp({ clientKey: b.clientKey, clientSecret: b.clientSecret }); }
  catch (e) { return fail(res, 400, e.message); }
  json(res, 200, { ok: true });
});

route('GET', '/api/stats', (req, res) => {
  const rows = [];
  for (const p of listPieces(ROOT)) for (const [key, e] of Object.entries(loadState(p).posts)) {
    if (e.id) rows.push({ slug: p.slug, title: e.title, key, platform: e.platform, channel: e.channel, url: e.url, postedAt: e.postedAt, stats: e.stats || null });
  }
  json(res, 200, rows);
});
// TikTok drafts posted in the app since the last look (at most once a minute; the board and the episode ask on open)
let draftsAt = 0, draftsRun = null;
route('POST', '/api/tiktok/drafts/refresh', async (req, res) => {
  if (!draftsRun && Date.now() - draftsAt > 60e3) {
    draftsAt = Date.now();
    draftsRun = refreshDrafts(listPieces(ROOT)).catch(() => 0).finally(() => { draftsRun = null; });
    return json(res, 200, { changed: await draftsRun });
  }
  json(res, 200, { changed: 0, skipped: true });
});

// names and pictures change on the platforms (a renamed channel): the Canais screen asks for a refresh when it opens.
// At most once every 5 minutes; never opens a sign-in; a failure keeps the saved values.
let profilesAt = 0, profilesRun = null;
route('POST', '/api/profiles/refresh', async (req, res) => {
  if (!profilesRun && Date.now() - profilesAt > 5 * 60e3) {
    profilesAt = Date.now();
    profilesRun = (async () => {
      let changed = 0;
      for (const [name, c] of Object.entries(loadChannels(ROOT))) for (const [platform, cfg] of Object.entries(c.platforms || {})) {
        const mod = PLATFORMS[platform];
        if (!mod?.profile || platformState(platform) !== 'ready') continue;
        const account = cfg.account || name;
        const before = mod.connected(account);
        if (!before) continue;
        const now = await mod.profile(account);
        if (now && (now.title !== before.title || now.avatar !== before.avatar)) changed++;
      }
      return changed;
    })().finally(() => { profilesRun = null; });
    try { return json(res, 200, { changed: await profilesRun }); } catch { return json(res, 200, { changed: 0 }); }
  }
  json(res, 200, { changed: 0, skipped: true });
});

route('POST', '/api/stats/refresh', (req, res) => {
  const job = jobs.start('stats', 'all', async ({ emit }) => refreshStats(listPieces(ROOT), (e) => emit({ type: 'log', message: e.error })));
  json(res, 202, job);
});

route('GET', '/api/events', (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ jobs: jobs.list() })}\n\n`);
  streams.add(res);
  req.on('close', () => streams.delete(res));
});

route('GET', '/media/:slug/video', (req, res, { slug }) => sendFile(req, res, videoFile(pieceBySlug(slug)), 'video/mp4'));
route('GET', '/media/:slug/poster', (req, res, { slug }) => {
  const w = Math.min(1080, Math.max(120, Number(new URL(req.url, 'http://x').searchParams.get('w')) || 360));
  sendFile(req, res, poster(pieceBySlug(slug), Math.round(w / 2) * 2), 'image/jpeg');
});

// ---------- server ----------
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  // DNS-rebinding guard: only our own host names
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return fail(res, 403, 'wrong host');
  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/');
  if (isApi) {
    const t = req.headers['x-studio-token'] || url.searchParams.get('t');
    const a = Buffer.from(String(t || '')), b = Buffer.from(TOKEN);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(res, 403, 'missing or wrong studio token');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      try { return await r.fn(req, res, m.groups || {}); }
      catch (e) { return fail(res, e.status || 500, e.message); }
    }
    return fail(res, 404, 'no such route');
  }
  if (req.method !== 'GET') return fail(res, 405, 'method not allowed');
  if (DEV) return fail(res, 404, 'dev mode: the UI is served by Vite');
  serveStatic(req, res, url.pathname);
});

function ensureBuilt() {
  if (DEV || fs.existsSync(path.join(DIST, 'index.html'))) return;
  console.log('Preparando o Estúdio pela primeira vez (npm install + build, ~1 min)…');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const args of [[fs.existsSync(path.join(UI, 'package-lock.json')) ? 'ci' : 'install'], ['run', 'build']]) {
    const r = spawnSync(npm, args, { cwd: UI, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) { console.error(`npm ${args.join(' ')} failed`); process.exit(1); }
  }
}

if (!fs.existsSync(path.join(ROOT, 'pieces'))) { console.error(`Run the studio from the project folder (the one with pieces/): ${ROOT}`); process.exit(1); }
ensureBuilt();
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
  console.log(`Estúdio aberto: ${url}`);
  if (!argv.includes('--no-open')) openBrowser(url);
});
server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') { console.error(e.message); process.exit(1); }
  // already open (the shortcut clicked twice): just bring it up in the browser
  const url = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/jobs`, { headers: { 'x-studio-token': TOKEN } });
    if (r.ok) { console.log(`O Estúdio já está aberto: ${url}`); if (!argv.includes('--no-open')) openBrowser(url); process.exit(0); }
  } catch {}
  console.error(`Port ${PORT} is taken by another program. Use --port.`);
  process.exit(1);
});
