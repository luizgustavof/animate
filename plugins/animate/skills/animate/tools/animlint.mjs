#!/usr/bin/env node
// animlint: the principles of animation, checked as numbers on the telemetry tracks (tools/telemetry.mjs).
//   usage: node tools/animlint.mjs <piece dir | index.html | telemetry.json> [--from s] [--to s] [--all] [--json]
// Runs telemetry first when <piece>/review/telemetry.json is missing or older than index.html.
// Tracks = probes the piece marks (probe('marcella.hand.r', x, y)) and cached sprites, in frame pixels, one sample per
// drawing (on 2s, or 1s with STYLE.ones). Segments break at cuts and morph bridges; distances scale with the frame
// (UNIT = short side / 1080).
//   FAIL  pop        one drawing that jumps far more than the drawings on either side (a teleport, a pose switched, a missed key)
//   FAIL  size pop   a box that snaps in size between two drawings (not at a cut)
//   WARN  hard start a move whose first drawing is already near its top speed (no ease-in / slow-in)
//   WARN  hard stop  a move that ends at near top speed (no ease-out / slow-out; dead stop)
//   WARN  linear     a long move at constant speed (reads mechanical; ease or a spring)
//   WARN  jitter     back-and-forth twitching in place (a sign flip every drawing or two, not a move)
//   WARN  text over  a string drawn over a probed character (a caption on a face or a hand)
//   WARN  flash      the frame's brightness jumps between two drawings away from any cut (flicker)
//   info  no antic.  a big move with neither anticipation (a small move the other way first) nor overshoot/settle
//   info  straight   a big move along a dead straight line (living things move in arcs)
//   info  frozen     a probed character with no motion at all for a long stretch (no moving hold: breathe, blink, drift)
//   info  still      the whole frame unchanged for a long stretch
// Repeats of one issue on one track fold into one line with their times. --all lists every occurrence; --json prints all.
// Exit code 1 when anything FAILs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? (args.splice(i, 1), true) : false; };
const from = opt('--from', null), to = opt('--to', null), all = flag('--all'), asJson = flag('--json');
const src = args[0];
if (!src) { console.error('usage: node tools/animlint.mjs <piece dir | index.html | telemetry.json> [--from s] [--to s] [--all] [--json]'); process.exit(2); }

// ---- telemetry: reuse it when fresh and covering the range, else (re)run it
let telFile, html = null;
if (src.endsWith('.json')) telFile = path.resolve(src);
else {
  html = path.resolve(src.endsWith('.html') ? src : path.join(src, 'index.html'));
  telFile = path.join(path.dirname(html), 'review', 'telemetry.json');
  let ok = false;
  if (fs.existsSync(telFile)) {
    const t = JSON.parse(fs.readFileSync(telFile, 'utf8'));
    ok = t.built === fs.statSync(html).mtimeMs && (from == null || t.from <= Number(from) + 1e-6) && (to == null || t.to >= Number(to) - 1e-6);
  }
  if (!ok) {
    const a = [path.join(HERE, 'telemetry.mjs'), html, '--quiet', '--out', telFile];
    if (from != null) a.push('--from', from); if (to != null) a.push('--to', to);
    if (!asJson) console.log('running telemetry…');
    execFileSync(process.execPath, a, { stdio: ['ignore', 'ignore', 'inherit'] });
  }
}
const T = JSON.parse(fs.readFileSync(telFile, 'utf8'));
const FPS = T.fps, U = Math.min(T.width, T.height) / 1080, DT = T.step / FPS;
const lo = from != null ? Number(from) : -1, hi = to != null ? Number(to) : 1e9;
const frames = T.frames.filter((fr) => fr.f / FPS >= lo - 1e-6 && fr.f / FPS < hi);

// ---- where segments must break: cuts, shot changes, morph bridges
const cutF = new Set(T.cuts.map((c) => Math.round(c * FPS)));
const inBridge = (t) => T.bridges.some((r) => Math.abs(t - r.tc) < r.d + 1e-6);
const breakBetween = (a, b) => {
  if (b.f - a.f > T.step) return true;
  if (a.shot !== b.shot) return true;
  for (let f = a.f + 1; f <= b.f; f++) if (cutF.has(f)) return true;
  return inBridge(a.f / FPS) || inBridge(b.f / FPS);
};

// ---- tracks: id -> samples { f, x, y, w, h }
const norm = (id) => String(id).replace(/[|:][\d.]+/g, '');
const tracks = new Map();
for (const fr of frames) {
  const seen = new Set();
  for (const it of fr.items) {
    if (it.k === 'text') continue;
    const id = (it.k === 'sprite' ? 'sprite ' : '') + norm(it.id);
    if (seen.has(id)) continue;   // the same thing drawn twice in one frame (a shadow pass): keep the first
    seen.add(id);
    const b = it.box, s = b ? { f: fr.f, x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, w: b[2] - b[0], h: b[3] - b[1] } : { f: fr.f, x: it.x, y: it.y };
    s.fr = fr;
    (tracks.get(id) || tracks.set(id, { id, k: it.k, S: [] }).get(id)).S.push(s);
  }
}
// split each track into runs without a break
function runs(S) {
  const out = []; let cur = [];
  for (const s of S) {
    if (cur.length && breakBetween(cur[cur.length - 1].fr, s.fr)) { out.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) out.push(cur);
  return out;
}
const median = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const offFrame = (s, m = 0) => s.x < -m || s.y < -m || s.x > T.width + m || s.y > T.height + m;

const issues = [];
const add = (sev, kind, id, t, note) => issues.push({ sev, kind, id, t: +t.toFixed(2), note });

const VMIN = 30 * U;   // px/s: slower than this is "holding"
for (const tr of tracks.values()) {
  const isChar = tr.k === 'probe';   // probes are things the piece cares about: characters, hands, heroes
  for (const R of runs(tr.S)) {
    if (R.length < 2) continue;
    const d = [], v = [];
    for (let i = 1; i < R.length; i++) { const dx = R[i].x - R[i - 1].x, dy = R[i].y - R[i - 1].y; d.push([dx, dy]); v.push(Math.hypot(dx, dy) / DT); }
    // pops: one step, big in absolute terms, standing alone: both drawings next to it move far less
    // (a fast eased gesture has big steps side by side; a snap has one big step between holds)
    const isPop = (i) => { const step = v[i] * DT, ref = Math.max(v[i - 1] ?? 0, v[i + 1] ?? 0) * DT; return step > 120 * U && step > 4 * Math.max(ref, 4 * U) ? ref : -1; };
    for (let i = 0; i < v.length; i++) {
      const ref = isPop(i), step = v[i] * DT;
      if (ref >= 0) add('FAIL', 'pop', tr.id, R[i + 1].f / FPS, `jumps ${Math.round(step)} px in one drawing (the drawings beside it: ≤${Math.round(ref)} px)`);
      if (R[i].w && R[i + 1].w) {
        const a0 = R[i].w * R[i].h, a1 = R[i + 1].w * R[i + 1].h, k = Math.max(a0, a1) / Math.max(1, Math.min(a0, a1));
        if (k > 1.8 && Math.max(a0, a1) > (60 * U) ** 2) add('FAIL', 'size pop', tr.id, R[i + 1].f / FPS, `box area x${k.toFixed(1)} in one drawing`);
      }
    }
    // moves: runs of speed above VMIN (one slow drawing inside a move does not end it)
    const moves = []; let m0 = -1;
    for (let i = 0; i <= v.length; i++) {
      const moving = i < v.length && (v[i] > VMIN || (m0 >= 0 && i + 1 < v.length && v[i + 1] > VMIN && v[i] > VMIN * 0.3));
      if (moving && m0 < 0) m0 = i;
      if (!moving && m0 >= 0) { moves.push([m0, i - 1]); m0 = -1; }
    }
    for (const [a, b] of moves) {
      const n = b - a + 1, vs = v.slice(a, b + 1), vpk = Math.max(...vs);
      let len = 0; for (let i = a; i <= b; i++) len += Math.hypot(...d[i]);
      const P0 = R[a], P1 = R[b + 1], t0 = P0.f / FPS, t1 = P1.f / FPS;
      const chord = Math.hypot(P1.x - P0.x, P1.y - P0.y);
      let popped = false; for (let i = a; i <= b; i++) if (isPop(i) >= 0) popped = true;
      if (n < 3 || len < 60 * U || popped) continue;
      const startsRun = a === 0, endsRun = b === v.length - 1;   // moving already when the shot starts / still moving when it ends
      if (!startsRun && !offFrame(P0, 40 * U) && vs[0] > 0.7 * vpk) add('WARN', 'hard start', tr.id, t0, `first drawing at ${Math.round(vs[0] / vpk * 100)}% of top speed (${Math.round(vpk)} px/s): ease in`);
      if (!endsRun && !offFrame(P1, 40 * U) && vs[n - 1] > 0.7 * vpk) add('WARN', 'hard stop', tr.id, t1, `last drawing at ${Math.round(vs[n - 1] / vpk * 100)}% of top speed: ease out or overshoot and settle`);
      if (n >= 6) {
        const mid = vs.slice(1, -1), mean = mid.reduce((s, x) => s + x, 0) / mid.length;
        const cv = Math.sqrt(mid.reduce((s, x) => s + (x - mean) ** 2, 0) / mid.length) / (mean || 1);
        if (cv < 0.06) add('WARN', 'linear', tr.id, t0, `${(t1 - t0).toFixed(1)}s at a constant ${Math.round(mean)} px/s (spread ${Math.round(cv * 100)}%): ease or spring it`);
      }
      if (!isChar) continue;
      if (chord > 150 * U) {
        const ux = (P1.x - P0.x) / chord, uy = (P1.y - P0.y) / chord;
        // anticipation: a small move against the direction in the 0.4s before
        let antic = false;
        for (let i = a - 1; i >= 0 && (R[a].f - R[i].f) / FPS <= 0.4; i--) if ((R[i + 1].x - R[i].x) * ux + (R[i + 1].y - R[i].y) * uy < -3 * U) antic = true;
        // overshoot: passing the rest point along the direction, then coming back (inside the move's tail or the 0.4s after)
        let over = false; const rest = P1, endF = Math.min(R.length - 1, b + 1 + Math.round(0.4 * FPS / T.step));
        let restFinal = R[endF];
        const proj = (s) => (s.x - restFinal.x) * ux + (s.y - restFinal.y) * uy;
        for (let i = Math.max(a, b - Math.ceil(n * 0.3)); i <= endF; i++) if (proj(R[i]) > Math.max(0.02 * chord, 3 * U)) over = true;
        void rest;
        if (!antic && !over) add('info', 'no antic.', tr.id, t0, `${Math.round(chord)} px move with no anticipation before nor overshoot after`);
        // arcs: the path's largest sideways deviation from its chord
        let dev = 0;
        for (let i = a; i <= b + 1; i++) dev = Math.max(dev, Math.abs((R[i].x - P0.x) * -uy + (R[i].y - P0.y) * ux));
        if (chord > 250 * U && dev < 0.03 * chord) add('info', 'straight', tr.id, t0, `${Math.round(chord)} px along a straight line (bends ${Math.round(dev)} px): move in an arc`);
      }
    }
    // jitter: in place (little net travel over 0.5s) but reversing direction on most drawings
    const win = Math.max(4, Math.round(0.5 * FPS / T.step));
    for (let i = 0; i + win <= d.length; i += Math.ceil(win / 2)) {
      const W = d.slice(i, i + win), net = Math.hypot(W.reduce((s, q) => s + q[0], 0), W.reduce((s, q) => s + q[1], 0));
      let flips = 0, amp = 0;
      for (let j = 1; j < W.length; j++) { if (W[j][0] * W[j - 1][0] + W[j][1] * W[j - 1][1] < 0) flips++; amp = Math.max(amp, Math.hypot(...W[j])); }
      if (flips >= W.length * 0.6 && amp > 1.5 * U && net < 8 * U) { add('WARN', 'jitter', tr.id, R[i].f / FPS, `${flips} reversals in ${(win * DT).toFixed(1)}s, ±${Math.round(amp)} px: twitching in place`); i += win; }
    }
    // frozen: a probed character with no motion at all
    if (isChar) {
      let s0 = 0;
      for (let i = 1; i <= R.length; i++) {
        const still = i < R.length && Math.hypot(R[i].x - R[s0].x, R[i].y - R[s0].y) < 2 * U;
        if (!still) { const dur = (R[i - 1].f - R[s0].f) / FPS; if (dur >= 4) add('info', 'frozen', tr.id, R[s0].f / FPS, `no motion for ${dur.toFixed(1)}s: a moving hold (breathe, blink, drift) keeps it alive`); s0 = i; }
      }
    }
  }
}

// ---- text over probed characters (point probes count as a 60 px disc, box probes as their box)
const textHits = new Map();
for (const fr of frames) {
  if (inBridge(fr.f / FPS)) continue;
  const texts = fr.items.filter((i) => i.k === 'text'), probes = fr.items.filter((i) => i.k === 'probe');
  for (const p of probes) {
    const r = 60 * U, pb = p.box || [p.x - r, p.y - r, p.x + r, p.y + r];
    for (const t of texts) {
      const b = t.box;
      if (b[0] < pb[2] && b[2] > pb[0] && b[1] < pb[3] && b[3] > pb[1]) {
        const key = norm(p.id) + '|' + t.id;
        if (!textHits.has(key)) { textHits.set(key, fr.f); add('WARN', 'text over', norm(p.id), fr.f / FPS, `"${t.id.slice(0, 32)}" drawn over it`); }
      }
    }
  }
}

// ---- whole frame: flashes away from cuts, long still stretches
for (let i = 1; i < frames.length; i++) {
  const a = frames[i - 1], b = frames[i];
  if (breakBetween(a, b)) continue;
  const dl = b.luma - a.luma, dl2 = i + 1 < frames.length && !breakBetween(b, frames[i + 1]) ? frames[i + 1].luma - b.luma : 0;
  if (Math.abs(dl) > 14 && Math.sign(dl2) === -Math.sign(dl) && Math.abs(dl2) > 10) add('WARN', 'flash', 'frame', b.f / FPS, `brightness ${a.luma}→${b.luma}→${frames[i + 1].luma} and back: flicker`);
}
{
  let s0 = null;
  for (let i = 1; i <= frames.length; i++) {
    const still = i < frames.length && frames[i].motion != null && frames[i].motion < 0.15 && !breakBetween(frames[i - 1], frames[i]);
    if (still && s0 == null) s0 = i - 1;
    if (!still && s0 != null) { const dur = (frames[i - 1].f - frames[s0].f) / FPS; if (dur >= 3) add('info', 'still', 'frame', frames[s0].f / FPS, `nothing moves for ${dur.toFixed(1)}s`); s0 = null; }
  }
}

// ---- report
issues.sort((a, b) => ({ FAIL: 0, WARN: 1, info: 2 }[a.sev] - { FAIL: 0, WARN: 1, info: 2 }[b.sev]) || a.t - b.t);
if (asJson) { console.log(JSON.stringify({ piece: T.piece, frames: frames.length, tracks: tracks.size, issues }, null, 1)); process.exit(issues.some((i) => i.sev === 'FAIL') ? 1 : 0); }
const probeN = [...tracks.values()].filter((t) => t.k === 'probe').length;
console.log(`animlint ${T.piece}: ${frames.length} drawings, ${tracks.size} tracks (${probeN} probe, ${tracks.size - probeN} sprite)`);
if (!probeN) console.log('  no probes: only sprites and the whole frame are checked. Mark characters: probe(\'who.part\', x, y) in their draw function.');
const groups = new Map();
for (const i of issues) { const k = i.sev + '|' + i.kind + '|' + i.id; (groups.get(k) || groups.set(k, []).get(k)).push(i); }
const count = { FAIL: 0, WARN: 0, info: 0 };
for (const [k, L] of groups) {
  const [sev, kind, id] = k.split('|'); count[sev] += L.length;
  const times = L.map((i) => i.t + 's');
  console.log(`${sev.padEnd(4)} ${kind.padEnd(10)} ${id.slice(0, 28).padEnd(28)} ${L.length > 1 ? `x${L.length} ` : ''}${all ? times.join(' ') : times.slice(0, 4).join(' ') + (times.length > 4 ? ' …' : '')}`);
  console.log(`     ${L[0].note}`);
  if (all) for (const i of L.slice(1)) console.log(`     ${i.t}s ${i.note}`);
}
console.log(`${count.FAIL} FAIL, ${count.WARN} WARN, ${count.info} info${issues.length ? '' : ' — clean'}`);
process.exit(count.FAIL ? 1 : 0);
