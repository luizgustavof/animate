#!/usr/bin/env node
// One command for an episode: voices -> word times -> build -> export -> review, each step timed, skipping what hasn't changed.
//   usage: node tools/make.mjs pieces/<episode> [--series series/<name>] [--shots 3,7] [--workers N]
//                              [--from voice|build|preflight|export|review] [--no-preflight] [--force] [--no-review] [--final]
//   --final: the delivery version, with the share copy encoded by libx264 (slower, better); leave it off while iterating
//   --series: where timings.log goes (default: piece.json "series", else the piece's own folder)
// tts.py skips unchanged takes, voice.mjs hears only new takes, export.mjs keeps audio.wav while the score is unchanged, so a
// second run costs only what changed. Timings go to <series>/timings.log: compare episodes with them.
// The preflight (tools/preflight.mjs: storyboard, text, heroes under the subtitle, the score's sound, page errors; ~20 s)
// runs between build and export and stops the run when it fails: --force exports anyway, --no-preflight skips it.
// Free memory is checked before every step: under 6 GB it warns (the export then runs fewer workers on its own).
// The frames stay out of OneDrive (ANIMATE_FRAMES, ~/.cache/animate-frames); the voices run in ~/.cache/animate-tts-venv when it exists.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url)), PROJECT = path.resolve(TOOLS, '..', '..', '..', '..', '..');
const USAGE = 'usage: node tools/make.mjs pieces/<episode> [--series series/<name>] [--shots 3,7] [--workers N] [--from voice|build|preflight|export|review] [--no-preflight] [--force] [--no-review] [--final]';
const argv = process.argv.slice(2), piece = argv[0];
if (!piece || piece.startsWith('--')) { console.error(USAGE); process.exit(2); }
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const pieceJson = path.join(PROJECT, piece, 'piece.json');
const P = fs.existsSync(pieceJson) ? JSON.parse(fs.readFileSync(pieceJson, 'utf8')) : {};
const SERIES = path.resolve(PROJECT, opt('--series') ?? P.series ?? piece);   // piece.json "series" is relative to the project

const venv = path.join(os.homedir(), '.cache', 'animate-tts-venv', process.platform === 'win32' ? 'Scripts' : 'bin');
const env = { ...process.env, ANIMATE_FRAMES: process.env.ANIMATE_FRAMES || path.join(os.homedir(), '.cache', 'animate-frames'), PYTHONUTF8: '1' };
if (fs.existsSync(venv)) env.PATH = venv + path.delimiter + env.PATH;

const shots = opt('--shots'), workers = opt('--workers');
const STEPS = [
  ['voice', 'python', [path.join(TOOLS, 'tts.py'), piece]],
  ['voice', process.execPath, [path.join(TOOLS, 'voice.mjs'), piece]],
  ['build', process.execPath, [path.join(TOOLS, 'build.mjs'), piece]],
  ['preflight', process.execPath, [path.join(TOOLS, 'preflight.mjs'), piece]],
  ['export', process.execPath, [path.join(TOOLS, 'export.mjs'), piece, '--share', '--no-captions', ...(shots ? ['--shots', shots] : []),
    ...(workers ? ['--workers', workers] : []), ...(argv.includes('--final') ? ['--share-best'] : [])]],
  ['review', process.execPath, [path.join(TOOLS, 'review.mjs'), piece]],
];
const LOW_GB = 6;
const freeGb = () => os.freemem() / 2 ** 30;
const first = opt('--from') ?? (shots ? 'build' : 'voice'), names = STEPS.map((s) => s[0]);
const skip = (n) => (n === 'review' && argv.includes('--no-review')) || (n === 'preflight' && argv.includes('--no-preflight'));
const log = []; let minFree = Infinity;
for (const [name, cmd, args] of STEPS.filter(([n]) => names.indexOf(n) >= names.indexOf(first) && !skip(n))) {
  const free = freeGb(); minFree = Math.min(minFree, free);
  if (free < LOW_GB) console.warn(`\n!! only ${free.toFixed(1)} GB of memory free before ${path.basename(args[0])} (under ${LOW_GB} GB): close other programs, or expect fewer export workers\n`);
  const t0 = Date.now(), r = spawnSync(cmd, args, { stdio: 'inherit', env, cwd: PROJECT, shell: false });
  const sec = (Date.now() - t0) / 1000;
  log.push(`${path.basename(args[0], path.extname(args[0]))} ${sec.toFixed(1)}s`);
  console.log(`\n== ${path.basename(args[0])}: ${sec.toFixed(1)}s (${free.toFixed(1)} GB free at the start)\n`);
  if (r.status !== 0 && name === 'preflight' && argv.includes('--force')) { console.warn('preflight failed; --force: exporting anyway'); continue; }
  if (r.status !== 0) { console.error(name === 'preflight' ? 'preflight failed: fix what it lists (the export would show the same), or --force to export anyway' : `${name} failed`); process.exit(r.status || 1); }
}
const line = `${new Date().toISOString().slice(0, 16)} ${path.basename(piece)}${shots ? ` --shots ${shots}` : ''}: ${log.join(' · ')} · min free ${minFree.toFixed(1)} GB`;
fs.mkdirSync(SERIES, { recursive: true });
fs.appendFileSync(path.join(SERIES, 'timings.log'), line + '\n');
console.log(line);
