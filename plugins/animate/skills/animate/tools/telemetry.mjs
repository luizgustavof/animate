#!/usr/bin/env node
// Telemetry: what is on screen, frame by frame, as numbers, so a piece can be checked without looking at pictures.
//   usage: node tools/telemetry.mjs <piece dir | index.html> [--from 0] [--to end] [--step 2]
//                                   [--ascii 3.5,12] [--cols 48] [--out file.json] [--quiet]
// Each sampled frame records (kit/core.js probes, in frame pixels):
//   sprites  every SPRITE_CACHE canvas blitted onto the frame (sets, props, cached characters), by id
//   probes   points and boxes the piece marks itself: probe('marcella.hand.r', x, y), probeBox(id, points)
//   text     every string drawn, with its box
//   luma     mean brightness 0..255, and motion = mean change from the previous sample (a 64-cell-wide grey grid)
// Default step = the motion step (2 frames, or 1 when STYLE.ones), so each sample is a new drawing.
// Writes <piece>/review/telemetry.json (read by tools/animlint.mjs) and prints a short summary:
// the tracks found and a motion strip (one character per second, ▁ still .. █ busy).
// --ascii t1,t2  prints those frames as text (a brightness ramp, --cols wide) with each track's spot lettered on it:
// a composition check in ~1k tokens instead of an image.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GPU_ARGS, gpuReport } from './gpu.mjs';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? (args.splice(i, 1), true) : false; };
const from = Number(opt('--from', 0)), toArg = opt('--to', null), stepArg = opt('--step', null);
const asciiAt = opt('--ascii', null), cols = Number(opt('--cols', 48)), outArg = opt('--out', null), quiet = flag('--quiet');
const src = args[0];
if (!src) { console.error('usage: node tools/telemetry.mjs <piece dir | index.html> [--from s] [--to s] [--step n] [--ascii t1,t2] [--cols 48] [--out f.json] [--quiet]'); process.exit(2); }
const file = src.endsWith('.html') ? src : path.join(src, 'index.html');
const pieceDir = path.dirname(path.resolve(file));
const URL_ = pathToFileURL(path.resolve(file)).href + '?export=1';

async function open(a) {
  const b = await chromium.launch({ args: a }), p = await b.newPage();
  p.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  await p.goto(URL_);
  await p.waitForFunction(() => window.TIMELINE && window.renderFrame);
  return [b, p];
}
let [browser, page] = await open([]);
if (await page.evaluate(() => !!window.TIMELINE.gpu)) { await browser.close(); [browser, page] = await open(GPU_ARGS); if (!quiet) await gpuReport(page); }
await page.evaluate(() => document.fonts.ready);
const hasProbes = await page.evaluate(() => typeof window.probeStart === 'function');
if (!hasProbes) { console.error('this piece was built with an older kit/core.js (no probeStart): rebuild it with tools/build.mjs'); process.exit(1); }

const info = await page.evaluate(() => {
  const T = window.TIMELINE;
  const ones = typeof STYLE === 'object' && !!STYLE.ones;
  const bridges = typeof BRIDGES !== 'undefined' ? BRIDGES.map((r) => ({ tc: r.tc, d: r.d ?? 0.6 })) : [];
  return { width: T.width, height: T.height, fps: T.fps, frames: T.frames || Math.round(T.duration * T.fps), duration: T.duration, ones, bridges,
    cuts: T.cuts || [], shots: (T.shots || []).map((s) => ({ id: s.id, t0: s.t0, t1: s.t1, title: s.title })), safe: T.safe || null };
});
const step = Number(stepArg || (info.ones ? 1 : 2));
const f0 = Math.max(0, Math.round(from * info.fps)), f1 = Math.min(info.frames, toArg != null ? Math.round(Number(toArg) * info.fps) : info.frames);
// motion steps start on even frames (B = floor(F/2)): sample the first frame of each drawing
const list = []; for (let f = f0 - (f0 % step); f < f1; f += step) if (f >= f0) list.push(f);

// one sample: probes, mean luma, and a small grey grid for the motion measure (kept in the page between calls)
const CHUNK = 24, frames = [];
const t0 = Date.now();
for (let i = 0; i < list.length; i += CHUNK) {
  const part = await page.evaluate((fs_) => {
    const T = window.TIMELINE;
    const c = window.__telC || (window.__telC = Object.assign(document.createElement('canvas'), { width: T.width, height: T.height }));
    const gw = 64, gh = Math.max(1, Math.round(64 * T.height / T.width));
    const g = window.__telG || (window.__telG = Object.assign(document.createElement('canvas'), { width: gw, height: gh }));
    const gx = g.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (const f of fs_) {
      window.probeStart();
      const shot = window.renderFrame(f / T.fps, c);
      const items = window.probeTake();
      gx.drawImage(c, 0, 0, gw, gh);
      const d = gx.getImageData(0, 0, gw, gh).data, n = gw * gh, Y = new Float32Array(n);
      let sum = 0;
      for (let k = 0; k < n; k++) { Y[k] = 0.2126 * d[k * 4] + 0.7152 * d[k * 4 + 1] + 0.0722 * d[k * 4 + 2]; sum += Y[k]; }
      let mot = null;
      if (window.__telPrev) { let m = 0; for (let k = 0; k < n; k++) m += Math.abs(Y[k] - window.__telPrev[k]); mot = +(m / n).toFixed(2); }
      window.__telPrev = Y;
      out.push({ f, shot, luma: +(sum / n).toFixed(1), motion: mot, items });
    }
    return out;
  }, list.slice(i, i + CHUNK));
  frames.push(...part);
  if (!quiet && list.length > CHUNK * 4 && (i / CHUNK) % 10 === 0) process.stdout.write(`\r${Math.min(i + CHUNK, list.length)}/${list.length} frames`);
}
if (!quiet && list.length > CHUNK * 4) process.stdout.write('\r');

const out = outArg ? path.resolve(outArg) : path.join(pieceDir, 'review', 'telemetry.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
const data = { piece: path.basename(pieceDir), built: fs.statSync(file).mtimeMs, ...info, step, from: f0 / info.fps, to: f1 / info.fps, frames };
fs.writeFileSync(out, JSON.stringify(data));

if (!quiet) {
  // ---- summary: tracks, motion strip
  const norm = (id) => String(id).replace(/[|:][\d.]+/g, '');
  const tracks = new Map();
  for (const fr of frames) for (const it of fr.items) {
    if (it.k === 'text') continue;
    const key = it.k + ':' + norm(it.id); const t = tracks.get(key) || { k: it.k, id: norm(it.id), n: 0, first: fr.f, last: fr.f };
    t.n++; t.last = fr.f; tracks.set(key, t);
  }
  const texts = new Set(); for (const fr of frames) for (const it of fr.items) if (it.k === 'text') texts.add(it.id);
  console.log(`telemetry ${data.piece}: ${frames.length} frames (${data.from.toFixed(2)}–${data.to.toFixed(2)}s, every ${step}) in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${path.relative(process.cwd(), out)}`);
  const T = [...tracks.values()].sort((a, b) => (a.k === b.k ? b.n - a.n : a.k === 'probe' ? -1 : 1));
  console.log(`tracks: ${T.filter((t) => t.k === 'probe').length} probe, ${T.filter((t) => t.k === 'sprite').length} sprite; ${texts.size} distinct strings`);
  for (const t of T.slice(0, 14)) console.log(`  ${t.k.padEnd(6)} ${t.id.slice(0, 40).padEnd(40)} ${String(t.n).padStart(5)} frames  ${(t.first / info.fps).toFixed(1)}–${(t.last / info.fps).toFixed(1)}s`);
  if (T.length > 14) console.log(`  … ${T.length - 14} more`);
  if (!T.some((t) => t.k === 'probe')) console.log('  (no probes: mark characters with probe(\'who.part\', x, y) to get motion tracks for animlint)');
  // one character per second: the busiest moment in it
  const bars = '▁▂▃▄▅▆▇█', perSec = [];
  for (const fr of frames) { const s = Math.floor(fr.f / info.fps); perSec[s] = Math.max(perSec[s] ?? 0, fr.motion ?? 0); }
  const top = Math.max(1, ...perSec.filter((v) => v != null));
  const strip = perSec.slice(Math.floor(data.from)).map((v) => (v == null ? ' ' : bars[Math.min(7, Math.floor(Math.sqrt(v / top) * 7.99))])).join('');
  console.log(`motion/s from ${Math.floor(data.from)}s (peak ${top.toFixed(1)}):`);
  for (let i = 0; i < strip.length; i += 60) console.log(`  ${String(Math.floor(data.from) + i).padStart(4)}s ${strip.slice(i, i + 60)}`);
}

// ---- ascii frames
if (asciiAt) {
  const rows = Math.max(8, Math.round(cols * info.height / info.width * 0.5));
  for (const t of asciiAt.split(',').map(Number)) {
    const r = await page.evaluate(([t, cols, rows]) => {
      const T = window.TIMELINE, c = document.createElement('canvas'); c.width = T.width; c.height = T.height;
      window.probeStart(); window.renderFrame(Math.round(t * T.fps) / T.fps, c); const items = window.probeTake();
      const g = document.createElement('canvas'); g.width = cols; g.height = rows;
      const x = g.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, cols, rows);
      const d = x.getImageData(0, 0, cols, rows).data, Y = [];
      for (let k = 0; k < cols * rows; k++) Y.push(0.2126 * d[k * 4] + 0.7152 * d[k * 4 + 1] + 0.0722 * d[k * 4 + 2]);
      return { Y, items };
    }, [t, cols, rows]);
    const ramp = ' .:-=+*#%@';   // dark ink on light paper reads as dense characters
    const lo = Math.min(...r.Y), hi = Math.max(...r.Y), grid = [];
    for (let y = 0; y < rows; y++) { const row = []; for (let x = 0; x < cols; x++) { const v = (r.Y[y * cols + x] - lo) / (hi - lo || 1); row.push(ramp[Math.min(9, Math.floor((1 - v) * 9.99))]); } grid.push(row); }
    const sx = cols / info.width, sy = rows / info.height, legend = [];
    const norm = (id) => String(id).replace(/[|:][\d.]+/g, '');
    const seen = new Map();
    for (const it of r.items) {
      if (it.k === 'text') continue;
      const id = norm(it.id); if (seen.has(id)) continue;
      const cx = it.box ? (it.box[0] + it.box[2]) / 2 : it.x, cy = it.box ? (it.box[1] + it.box[3]) / 2 : it.y;
      const L = String.fromCharCode(65 + seen.size); if (seen.size >= 26) break; seen.set(id, L);
      const gx = Math.round(cx * sx), gy = Math.round(cy * sy);
      if (gx >= 0 && gx < cols && gy >= 0 && gy < rows) grid[gy][gx] = L;
      legend.push(`${L} ${it.k} ${id} @${Math.round(cx)},${Math.round(cy)}${it.box ? ` box ${it.box.join(',')}` : ''}${gx < 0 || gx >= cols || gy < 0 || gy >= rows ? ' (off frame)' : ''}`);
    }
    const strs = [...new Set(r.items.filter((i) => i.k === 'text').map((i) => i.id))];
    console.log(`\nframe t=${t}s (${cols}x${rows}, each cell ${Math.round(info.width / cols)}x${Math.round(info.height / rows)} px)`);
    console.log('+' + '-'.repeat(cols) + '+'); for (const row of grid) console.log('|' + row.join('') + '|'); console.log('+' + '-'.repeat(cols) + '+');
    for (const l of legend) console.log('  ' + l);
    if (strs.length) console.log(`  text: ${strs.slice(0, 12).map((s) => JSON.stringify(s.slice(0, 40))).join(' ')}${strs.length > 12 ? ' …' : ''}`);
  }
}
await browser.close();
