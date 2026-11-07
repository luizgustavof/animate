#!/usr/bin/env node
// Prove a kit or tool change left every existing piece pixel-identical.
//   node tools/regress.mjs --baseline     build every piece and style demo into _lab/baseline/ (run BEFORE the change)
//   node tools/regress.mjs                build them again into _lab/now/ and compare 12 frames of each (exit 1 on any DIFF)
//   [--only name,name] [--frames N]
// Builds use tools/build.mjs --out, so no piece's own index.html is touched. Pieces that don't build are listed and skipped.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SKILL, '../../../..');
const LAB = path.join(REPO, '_lab');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const baseline = args.includes('--baseline');
const only = opt('--only') ? opt('--only').split(',') : null;
const NF = Number(opt('--frames') || 12);

const targets = [];
const add = (name, dir) => { if (fs.existsSync(path.join(dir, 'src')) || fs.existsSync(path.join(dir, 'piece.json'))) targets.push({ name, dir }); };
const PIECES = path.join(REPO, 'pieces');
if (fs.existsSync(PIECES)) for (const n of fs.readdirSync(PIECES)) if (!n.startsWith('lab-')) add(n, path.join(PIECES, n));
for (const n of fs.readdirSync(path.join(SKILL, 'styles'))) add('style-' + n, path.join(SKILL, 'styles', n, 'demo'));
for (const n of fs.readdirSync(path.join(SKILL, 'examples'))) add('example-' + n, path.join(SKILL, 'examples', n));

function frameCount(dir) {
  const m = fs.existsSync(path.join(dir, 'piece.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'piece.json'), 'utf8')) : {};
  const f = m.format || {};
  return f.frames || Math.round((f.duration || 10) * (f.fps || 24));
}
const node = (script, a) => spawnSync(process.execPath, [path.join(SKILL, 'tools', script), ...a], { encoding: 'utf8' });

const outDir = path.join(LAB, baseline ? 'baseline' : 'now');
let fail = 0, skipped = [];
for (const t of targets) {
  if (only && !only.includes(t.name)) continue;
  const out = path.join(outDir, t.name + '.html');
  const b = node('build.mjs', [t.dir, '--out', out]);
  if (b.status !== 0) { skipped.push(`${t.name} (${(b.stderr || b.stdout).trim().split('\n')[0]})`); continue; }
  if (baseline) { console.log(`baseline ${t.name}`); continue; }
  const base = path.join(LAB, 'baseline', t.name + '.html');
  if (!fs.existsSync(base)) { skipped.push(`${t.name} (no baseline)`); continue; }
  const n = frameCount(t.dir), frames = [...new Set(Array.from({ length: NF }, (_, i) => Math.round(i * (n - 1) / (NF - 1))))];
  const h = node('framehash.mjs', [base, out, ...frames.map(String)]);
  const last = (h.stdout.trim().split('\n').pop() || '').trim();
  if (h.status !== 0) { fail++; console.log(`DIFF ${t.name}: ${last}\n${h.stdout}${h.stderr}`); } else console.log(`ok   ${t.name}: ${last}`);
}
if (skipped.length) console.log('skipped:\n  ' + skipped.join('\n  '));
if (!baseline) console.log(fail ? `${fail} piece(s) changed` : 'all pieces identical');
process.exit(fail ? 1 : 0);
