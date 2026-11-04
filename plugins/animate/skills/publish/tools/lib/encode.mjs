// Light copies for platforms that choke on the master. renders/final.mp4 is ~30 Mbps full-range (yuvj420p): fine for YouTube,
// but the TikTok phone app stalls on it. renders/tiktok.mp4 is the same picture at ~15 Mbps, TV range, a keyframe every 2 s and
// faststart (SSIM ~0.98 against the master on EP01: no visible difference). Made once, next to final.mp4, and remade when
// final.mp4 is newer. store.videoFile() picks renders/<platform>.mp4 when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { probe } from './store.mjs';

const RECIPES = {
  tiktok: [
    '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level', '4.1',
    '-b:v', '15M', '-maxrate', '20M', '-bufsize', '30M', '-g', '48', '-keyint_min', '24', '-sc_threshold', '0',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart',
  ],
};

export const hasRecipe = (platform) => Boolean(RECIPES[platform]);

// → the light file's path, or null when this platform has no recipe or the piece has no master yet
export async function ensureLight(p, platform, { signal, log = () => {}, onProgress = () => {} } = {}) {
  const args = RECIPES[platform];
  if (!args) return null;
  const master = path.join(p.dir, 'renders', 'final.mp4');
  const out = path.join(p.dir, 'renders', `${platform}.mp4`);
  if (!fs.existsSync(master)) return null;
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(master).mtimeMs) return out;

  const tmp = out.replace(/\.mp4$/, '.part.mp4');
  log(`making the light ${platform} copy (about 2 minutes, once per episode)`);
  let duration = 0;
  try { duration = Number(probe(master)?.duration) || 0; } catch {}
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-y', '-i', master, ...args, '-progress', 'pipe:1', '-nostats', tmp],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (d) => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m && duration) onProgress({ done: Math.min(1, Number(m[1]) / 1e6 / duration) });
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
  return out;
}

