#!/usr/bin/env node
// Where the score's render time goes: renders the score (one OfflineAudioContext, the mix) as built, then once without
// each helper named, and prints seconds and nodes for each — measure before making a sound faster.
//   usage: node tools/scoreprof.mjs pieces/<name> [--without uke,glug,meow] [--part mix|music|sfx]
//   --without: the calls to these helpers are skipped (in the score body and the series' sounds; their definitions stay)
// Build the piece first (tools/build.mjs). RF01, 04/11/2026: 128 s as built -> 8.5 s once short notes were built just in
// time (kit/score-head.js lazy); without the uke the score took 8.5 s of the 128.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2), piece = argv[0];
if (!piece || piece.startsWith('--')) { console.error('usage: node tools/scoreprof.mjs pieces/<name> [--without uke,glug] [--part mix|music|sfx]'); process.exit(2); }
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const variants = [['as built', null], ...(opt('without', '') ? opt('without').split(',').map((n) => [`without ${n}`, n]) : [])];
const browser = await chromium.launch(), page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
await page.goto(pathToFileURL(path.resolve(piece, 'index.html')).href + '?export=1');
await page.waitForFunction(() => typeof buildScore === 'function');
for (const [label, without] of variants) {
  const r = await page.evaluate(async ([without, part]) => {
    let src = buildScore.toString();
    // skip the calls, not the definition: "name(" not preceded by "function " or a word character
    if (without) src = src.replace(new RegExp(`(?<!function\\s)(?<![\\w.$])${without}\\(`, 'g'), '(() => 0)(');
    const fn = (0, eval)('(' + src + ')');
    const P = BaseAudioContext.prototype, keep = {}; let nodes = 0;
    for (const k of Object.getOwnPropertyNames(P)) if (k.startsWith('create') && typeof P[k] === 'function') { keep[k] = P[k]; P[k] = function (...a) { nodes++; return keep[k].apply(this, a); }; }
    try { const t0 = performance.now(); await fn(48000, part, 'raw'); return { s: (performance.now() - t0) / 1000, nodes }; } finally { Object.assign(P, keep); }
  }, [without, opt('part', 'mix')]);
  console.log(`${label.padEnd(24)} ${r.s.toFixed(1).padStart(6)} s  ${String(r.nodes).padStart(7)} nodes`);
}
await browser.close();
