#!/usr/bin/env node
// Preflight: the checks that used to wait for a full export, run straight on the built page in well under a minute, so a
// piece is exported once it is right instead of being fixed after the review.
//   usage: node tools/preflight.mjs pieces/<name> [--every 6] [--no-sound] [--no-board]
//   1. storyboard (TIMELINE.board) -> review/board.png: look at it before anything else
//   2. text: every string drawn, cut off / overlapping / under the phone UI (tools/textcheck.mjs), every 6th frame
//   3. heroes: what the piece marks with hero(name, box) (faces, the dish) more than 40% under something that covers the
//      picture: what it marks with band(name, box) (the subtitle strip) or the phone UI (TIMELINE.safe)
//   4. sound: renders the score only (export.mjs --only-audio: ~15 s, and nothing when it has not changed), then the
//      payoff rules (the loudest 100 ms falls in the payoff act, >= 0.4 s of silence before it) and tools/soundcheck.mjs
//   5. page errors and console errors (a cut off the beat grid is one)
// Exit 1 when any of them fails; tools/make.mjs runs it before the export and stops there (--force exports anyway).
// Allowed moments: piece.json "review": { "textIgnore" | "heroIgnore" | "soundIgnore": [[t0, t1, "why"]] }.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textCheckPages, printTextCheck } from './textcheck.mjs';
import { soundCheck, printSoundCheck, soundSvg } from './soundcheck.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), piece = argv[0];
if (!piece || piece.startsWith('--')) { console.error('usage: node tools/preflight.mjs pieces/<name> [--every 6] [--no-sound] [--no-board]'); process.exit(2); }
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; }, flag = (k) => argv.includes('--' + k);
const ROOT = path.resolve(piece), REVIEW = path.join(ROOT, 'review'), EVERY = Number(opt('every', 6));
const PIECE = fs.existsSync(path.join(ROOT, 'piece.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'piece.json'), 'utf8')) : {};
fs.mkdirSync(REVIEW, { recursive: true });
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }
const t00 = Date.now(), lap = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;
const results = [];

// ---- the sound renders in its own process while the pages check the picture
const sound = flag('no-sound') || !PIECE.build ? null : new Promise((res) => {
  const t0 = Date.now(), p = spawn(process.execPath, [path.join(TOOLS, 'export.mjs'), piece, '--only-audio']); let out = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => res({ ok: code === 0, out, sec: lap(t0) }));
});

const browser = await chromium.launch();
const url = pathToFileURL(path.join(ROOT, 'index.html')).href + '?export=1';
const errors = [];
const N = Math.max(1, Math.min(6, Math.floor((os.availableParallelism?.() ?? os.cpus().length) / 2)));
const pages = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  p.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  if (i === 0) p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => window.TIMELINE && typeof window.renderFrame === 'function');
  return p;
}));
const T = await pages[0].evaluate(() => ({ safe: TIMELINE.height > TIMELINE.width ? TIMELINE.safe || { top: 240, bottom: 420, right: 140 } : null, acts: TIMELINE.acts || [], board: !!TIMELINE.board, w: TIMELINE.width, h: TIMELINE.height }));

// 1. storyboard
if (T.board && !flag('no-board')) {
  const t0 = Date.now(), r = spawnSync(process.execPath, [path.join(TOOLS, 'storyboard.mjs'), ROOT, path.join(REVIEW, 'board.png')], { encoding: 'utf8' });
  console.log(`BOARD: review/board.png (${lap(t0)})${r.status ? ' FAILED ' + r.stderr : ''}`);
}

// 2. text
{
  const t0 = Date.now();
  const ok = printTextCheck(await textCheckPages(pages, { every: EVERY, safe: T.safe }), PIECE.review?.textIgnore || []);
  console.log(`(text: ${lap(t0)})`); results.push(['text', ok]);
}

// 3. heroes under the subtitle or the phone UI
{
  const t0 = Date.now();
  const parts = await Promise.all(pages.map((p, part) => p.evaluate(async ({ every, safe, part, of, W, H }) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const T = window.TIMELINE, out = [], marked = { heroes: 0 };
    const ui = safe ? [{ name: 'the phone UI (bottom)', x0: 0, y0: H - safe.bottom, x1: W, y1: H }, { name: 'the phone UI (right)', x0: W - safe.right, y0: safe.top, x1: W, y1: H - safe.bottom }] : [];
    const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const bridges = typeof BRIDGES !== 'undefined' ? BRIDGES : [];
    let k = 0;
    for (let f = 0; f < T.frames; f += every) {
      if (k++ % of !== part) continue;
      const t = f / T.fps; if (bridges.some((r) => Math.abs(t - r.tc) < (r.d ?? 0.6))) continue;
      window.HEROES = []; window.BANDS = []; window.renderFrame(t, cv);
      const covers = [...window.BANDS, ...ui]; marked.heroes += window.HEROES.length;
      for (const h of window.HEROES) {
        // only the part of the hero inside the frame counts
        const v = { x0: Math.max(0, h.x0), y0: Math.max(0, h.y0), x1: Math.min(W, h.x1), y1: Math.min(H, h.y1) }, area = inter(v, v);
        if (area < 1) continue;
        for (const c of covers) { const sh = inter(v, c) / area; if (sh > 0.4) out.push({ name: h.name, by: c.name, t, sh }); }
      }
    }
    window.HEROES = window.BANDS = undefined;
    return { out, marked: marked.heroes };
  }, { every: EVERY, safe: T.safe, part, of: pages.length, W: T.w, H: T.h })));
  const hits = parts.flatMap((r) => r.out).sort((a, b) => a.t - b.t), marked = parts.reduce((n, r) => n + r.marked, 0);
  const ignore = PIECE.review?.heroIgnore || [], step = EVERY / 24 + 0.01, runs = [];
  for (const h of hits) { const r = runs.find((q) => q.name === h.name && q.by === h.by && h.t - q.t1 <= step); if (r) { r.t1 = h.t; r.n++; r.sh = Math.max(r.sh, h.sh); } else runs.push({ ...h, t0: h.t, t1: h.t, n: 1 }); }
  console.log(`\nHEROES (faces and props marked with hero(), ${marked} sightings): under the subtitle strip or the phone UI`);
  let bad = 0;
  for (const r of runs) {
    const ok = ignore.find(([a, b]) => r.t0 >= a - 1e-6 && r.t1 <= b + 1e-6);
    if (!ok) bad++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${r.name} ${Math.round(r.sh * 100)}% under ${r.by} at ${r.t0.toFixed(2)}${r.t1 > r.t0 ? '–' + r.t1.toFixed(2) : ''}s${ok ? `  (allowed: ${ok[2] || ''})` : `  -> move ${r.name} or ${r.by}`}`);
  }
  if (!marked) console.log('  (nothing marked: call hero(name, x0, y0, x1, y1) where a face or the dish is drawn)');
  console.log(`heroes: ${bad ? 'FAIL' : 'PASS'} (${bad} covered) (${lap(t0)})`); results.push(['heroes', !bad]);
}
await browser.close();

// 4. sound
if (sound) {
  const s = await sound;
  console.log(`\nSOUND (score rendered by export.mjs --only-audio in ${s.sec}${/keeping renders\/audio.wav/.test(s.out) ? ', unchanged' : ''})`);
  if (!s.ok) { console.log(s.out.split('\n').slice(-8).join('\n')); results.push(['sound', false]); }
  else {
    const SCORE = path.join(ROOT, 'renders', fs.existsSync(path.join(ROOT, 'renders', 'audio-score.wav')) ? 'audio-score.wav' : 'audio.wav');
    const SR = 8000, WIN = SR / 10, pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', SCORE, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { maxBuffer: 1 << 28 }).stdout;
    const db = []; for (let o = 0; o + WIN * 2 <= pcm.length; o += WIN * 2) { let q = 0; for (let i = 0; i < WIN; i++) { const v = pcm.readInt16LE(o + i * 2) / 32768; q += v * v; } db.push(10 * Math.log10(q / WIN + 1e-12)); }
    const L = db.indexOf(Math.max(...db)), pay = T.acts.find((a) => a.role === 'payoff' || a.role === 'gift');
    let run = 0, best = 0; for (let w = Math.max(0, L - 20); w < L; w++) { run = db[w] <= -40 ? run + 1 : 0; best = Math.max(best, run); }
    const inPay = !pay || (L / 10 >= pay.t0 - 0.05 && L / 10 < pay.t1);
    // the loudest window outside the payoff, so the fix says what to pull down
    let other = -1; if (pay) for (let w = 0; w < db.length; w++) if ((w / 10 < pay.t0 - 0.05 || w / 10 >= pay.t1) && (other < 0 || db[w] > db[other])) other = w;
    console.log(`  ${inPay ? 'PASS' : 'FAIL'}  loudest 100 ms of the score at ${(L / 10).toFixed(1)}s (${db[L].toFixed(1)} dBFS)${pay ? ` ${inPay ? 'in' : 'NOT in'} the payoff act ${pay.t0.toFixed(2)}-${pay.t1.toFixed(2)}s` : ''}`);
    if (pay && other >= 0) console.log(`        loudest outside it: ${(other / 10).toFixed(1)}s (${db[other].toFixed(1)} dBFS), ${(db[L] - db[other]).toFixed(1)} dB under the top`);
    const silOk = !pay || best >= 4;
    console.log(`  ${silOk ? 'PASS' : 'FAIL'}  silence before it: ${(best / 10).toFixed(1)}s at <= -40 dBFS in the 2 s before (needs >= 0.4 s)`);
    const sc = soundCheck(ROOT, { acts: T.acts }), scOk = printSoundCheck(sc);
    if (sc) soundSvg(sc, path.join(REVIEW, 'sound.svg'));
    results.push(['sound', inPay && silOk && scOk]);
  }
}

// 5. page errors
console.log(`\nPAGE: ${errors.length ? 'FAIL' : 'PASS'} (${errors.length} error(s))`);
for (const e of [...new Set(errors)].slice(0, 12)) console.log('  ' + e);
results.push(['page', !errors.length]);

const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`\npreflight: ${failed.length ? 'FAIL (' + failed.join(', ') + ')' : 'PASS'} in ${lap(t00)}`);
process.exit(failed.length ? 1 : 0);
