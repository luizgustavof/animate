// Light copies for platforms that choke on the master. renders/final.mp4 is ~30 Mbps full-range (yuvj420p): fine for YouTube,
// but the TikTok phone app stalls on it. renders/tiktok.mp4 is the same picture at ~15 Mbps, TV range, a keyframe every 2 s and
// faststart (SSIM ~0.98 against the master on EP01: no visible difference). Made once, next to final.mp4, and remade when
// final.mp4 (or the cover) is newer. store.videoFile() picks renders/<platform>.mp4 when it exists.
//
// The cover: TikTok takes no cover image through the API, only a frame of the video. So when <piece>/publish/thumb.png exists
// (tools/thumb.mjs), the TikTok copy ends on it for COVER_FRAMES frames (~0.17 s at 24 fps: a flash on the loop, easy to pick
// as the cover by dragging the app's cover slider to the end) with silence under them. renders/tiktok.cover.json records where
// it sits; coverAt() gives the time for a direct post's video_cover_timestamp_ms. The master and the review never see it.
// piece.json "thumb": { "cover": false } turns it off for one piece.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { probe } from './store.mjs';

export const COVER_FRAMES = 4;

const RECIPES = {
  tiktok: {
    range: 'scale=in_range=full:out_range=tv,format=yuv420p',
    cover: true,
    args: [
      '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level', '4.1',
      '-b:v', '15M', '-maxrate', '20M', '-bufsize', '30M', '-g', '48', '-keyint_min', '24', '-sc_threshold', '0',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart',
    ],
  },
};

export const hasRecipe = (platform) => Boolean(RECIPES[platform]);
const thumbFile = (p) => path.join(p.dir, 'publish', 'thumb.png');
const coverFile = (out) => out.replace(/\.mp4$/, '.cover.json');

function fpsOf(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [a, b = 1] = String(r.stdout).trim().split('/').map(Number);
  return a && b ? a / b : 24;
}

// the cover's time in the light copy (seconds, the middle of the tail), or null when it has none
export function coverAt(file) {
  try { return JSON.parse(fs.readFileSync(coverFile(file), 'utf8')).at; } catch { return null; }
}

// → the light file's path, or null when this platform has no recipe or the piece has no master yet
export async function ensureLight(p, platform, { signal, log = () => {}, onProgress = () => {} } = {}) {
  const R = RECIPES[platform];
  if (!R) return null;
  const master = path.join(p.dir, 'renders', 'final.mp4');
  const out = path.join(p.dir, 'renders', `${platform}.mp4`);
  if (!fs.existsSync(master)) return null;
  // piece.json "thumb": { "cover": false } keeps a piece's cover out of its TikTok copy (a piece posted before covers existed)
  let coverOff = false;
  try { coverOff = JSON.parse(fs.readFileSync(path.join(p.dir, 'piece.json'), 'utf8')).thumb?.cover === false; } catch {}
  const thumb = R.cover && !coverOff && fs.existsSync(thumbFile(p)) ? thumbFile(p) : null;
  const mtime = (f) => fs.statSync(f).mtimeMs;
  const fresh = fs.existsSync(out) && mtime(out) >= mtime(master)
    && (thumb ? fs.existsSync(coverFile(out)) && mtime(out) >= mtime(thumb) : !fs.existsSync(coverFile(out)));
  if (fresh) return out;

  const tmp = out.replace(/\.mp4$/, '.part.mp4');
  log(`making the light ${platform} copy${thumb ? ', ending on the cover' : ''} (about 2 minutes, once per episode)`);
  let duration = 0, info = {};
  try { info = probe(master) || {}; duration = Number(info.duration) || 0; } catch {}
  const fps = fpsOf(master), tail = COVER_FRAMES / fps;
  const input = thumb
    ? ['-i', master, '-loop', '1', '-framerate', String(fps), '-t', tail.toFixed(4), '-i', thumb,
      '-filter_complex',
      `[0:v]${R.range},setsar=1[v0];` +
      `[1:v]scale=${info.width || 1080}:${info.height || 1920}:flags=lanczos:out_range=tv,format=yuv420p,setsar=1,fps=${fps}[v1];` +
      `[v0][v1]concat=n=2:v=1:a=0[v];[0:a]apad=pad_dur=${tail.toFixed(4)}[a]`,
      '-map', '[v]', '-map', '[a]']
    : ['-i', master, '-vf', R.range];
  const total = duration + (thumb ? tail : 0);
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-y', ...input, ...R.args, '-progress', 'pipe:1', '-nostats', tmp],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (d) => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m && total) onProgress({ done: Math.min(1, Number(m[1]) / 1e6 / total) });
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('cancelled'));
      code === 0 ? resolve() : reject(new Error(`ffmpeg (${platform} copy) failed: ${err.trim().split('\n').pop() || code}`));
    });
  }).catch((e) => { fs.rmSync(tmp, { force: true }); throw e; });
  fs.renameSync(tmp, out);
  if (thumb) fs.writeFileSync(coverFile(out), JSON.stringify({ thumb: path.relative(p.dir, thumb), frames: COVER_FRAMES, fps, from: +duration.toFixed(4), at: +(duration + tail / 2).toFixed(4) }, null, 2));
  else fs.rmSync(coverFile(out), { force: true });
  return out;
}
