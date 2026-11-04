// Paths, the channel config and each piece's publish state, for tools/publish.mjs.
//   <project>/publish/channels.json     the channels (yours, local: /publish/ is in .gitignore)
//   <piece>/publish/meta.json           title, description, captions, hashtags per platform (written by the agent)
//   <piece>/publish/state.json          what was sent where: ids, links, schedule, stats (written by the tool)
//   ~/.animate/                         secrets, outside the project (and outside OneDrive / Dropbox sync folders):
//     google-oauth-client.json          the OAuth client downloaded from Google Cloud Console
//     tokens/<account>.<platform>.json  one sign-in per account and platform
// ANIMATE_SECRETS overrides ~/.animate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const SECRETS = process.env.ANIMATE_SECRETS || path.join(os.homedir(), '.animate');
export const tokenFile = (account, platform) => path.join(SECRETS, 'tokens', `${account}.${platform}.json`);

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${file}`);
  }
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { throw new Error(`${file}: ${e.message}`); }
}

// written to a temp file and renamed, so a crash mid-write never leaves half a state file
export function writeJson(file, data, { secret = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: secret ? 0o600 : 0o644 });
  fs.renameSync(tmp, file);
}

// "pieces/ep03-modulo", "ep03-modulo" or an absolute path
export function resolvePiece(arg, cwd = process.cwd()) {
  const tries = [path.resolve(cwd, arg), path.resolve(cwd, 'pieces', arg)];
  const dir = tries.find(d => fs.existsSync(path.join(d, 'piece.json')));
  if (!dir) throw new Error(`no piece.json in ${tries.join(' or ')}`);
  const parent = path.dirname(dir);
  const root = path.basename(parent) === 'pieces' ? path.dirname(parent) : cwd;
  return { dir, root, slug: path.basename(dir), piece: readJson(path.join(dir, 'piece.json')) };
}

export function listPieces(root) {
  const dir = path.join(root, 'pieces');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'piece.json'))).sort()
    .map(n => resolvePiece(path.join(dir, n), root));
}

export function loadChannels(root) {
  const file = path.join(root, 'publish', 'channels.json');
  const cfg = readJson(file, null);
  if (!cfg) throw new Error(`no channel config: create ${file} (start from channels.example.json in the publish skill)`);
  return cfg.channels || {};
}

// the channel a piece goes to: --channel, else piece.json "channel", else the one whose "series" is the piece's series, else the
// only channel (unless strict: "what's next" never guesses, so a test piece outside any series is never offered)
export function channelFor(p, channels, name = p.piece.channel, { strict = false } = {}) {
  if (name) {
    if (!channels[name]) throw new Error(`no channel "${name}" in publish/channels.json (have: ${Object.keys(channels).join(', ')})`);
    return [name, channels[name]];
  }
  const series = p.piece.series && path.resolve(p.root, p.piece.series).toLowerCase();
  const hits = Object.entries(channels).filter(([, c]) => c.series && series && path.resolve(p.root, c.series).toLowerCase() === series);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`several channels use ${p.piece.series}: pass --channel (${hits.map(h => h[0]).join(', ')})`);
  const all = Object.keys(channels);
  if (strict) return null;
  if (all.length === 1) return [all[0], channels[all[0]]];
  throw new Error(`which channel? pass --channel (one of ${all.join(', ')}) or set "series" on a channel`);
}

export const metaFile = p => path.join(p.dir, 'publish', 'meta.json');
export const stateFile = p => path.join(p.dir, 'publish', 'state.json');
export const loadState = p => readJson(stateFile(p), { posts: {} });
export const saveState = (p, s) => writeJson(stateFile(p), s);

// which render goes up: "final" is the master (best source: every platform re-encodes), "share" the light copy
export function videoFile(p, choice = 'final') {
  const order = choice === 'share' ? ['share.mp4', 'final.mp4'] : ['final.mp4', 'share.mp4'];
  for (const n of order) {
    const f = path.join(p.dir, 'renders', n);
    if (fs.existsSync(f)) return f;
  }
  throw new Error(`no render in ${path.join(p.dir, 'renders')}: export the piece first (tools/export.mjs)`);
}

// remembered per file + size + mtime: the studio lists every piece often, and ffprobe costs ~100 ms each
const probed = new Map();
export function probe(file) {
  const st = fs.statSync(file);
  const k = `${file}|${st.size}|${st.mtimeMs}`;
  if (!probed.has(k)) probed.set(k, probeNow(file));
  return probed.get(k);
}

function probeNow(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr || r.error?.message}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find(s => s.codec_type === 'video') || {};
  return {
    width: v.width, height: v.height,
    duration: Number(j.format.duration),
    audio: j.streams.some(s => s.codec_type === 'audio'),
    bytes: fs.statSync(file).size,
  };
}

// one post at a time per piece: a second run (or a scheduled task overlapping a manual one) waits its turn
export function lock(p) {
  const file = path.join(p.dir, 'publish', '.lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs > 6 * 3600e3) fs.rmSync(file);   // stale: a run that died
  } catch {}
  try { fs.writeFileSync(file, String(process.pid), { flag: 'wx' }); }
  catch { throw new Error(`${p.slug} is being published by another run (remove ${file} if that run is gone)`); }
  const release = () => { try { fs.rmSync(file); } catch {} };
  process.once('exit', release);
  return release;
}
