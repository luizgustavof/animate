#!/usr/bin/env node
// Sound check: a listener's critique of the mix, measured. Finds what tires or irritates a viewer on a phone and says where,
// why, which bus it comes from and by how much to pull it down — instead of "it sounds loud".
//   usage: node tools/soundcheck.mjs <piece dir>        (also run by review.mjs; writes review/sound.svg)
// Reads renders/audio.wav (the mix as delivered), renders/audio-score.wav (the score before the voice), the stems
// (stem-sfx.wav, stem-music.wav, stem-voice.wav), voice.json (when each line is spoken) and TIMELINE.acts (the payoff act
// is allowed to be the loudest moment; nothing else is).
// Loudness is ITU BS.1770 (K-weighted): momentary = 400 ms, short-term = 3 s, every 100 ms. The checks:
//   startle     a sound that jumps >= 10 LU over the 8 s before it, outside the payoff (one is a scare; many are a nuisance)
//   payoff      the payoff more than 16 LU over the episode's integrated loudness: it hurts on earbuds, not scares
//   piercing    clicks and cracks: 100 ms blocks whose sample peak stands >= 20 dB over their own RMS and above -12 dBFS
//   harsh       loud stretches (momentary >= integrated - 4) with more than 30% of their energy in 2-5 kHz, where the ear is
//               most sensitive and tires first
//   masking     a voice line the score sits within 8 dB of, in the speech band (300 Hz - 4 kHz): the viewer strains to hear it
//   fatigue     more than 25% of the sounding time with short-term loudness >= integrated + 3 LU: no rest for the ear
//   busy        more than 12 sound-effect onsets (the sfx stem jumping >= 6 dB in 100 ms) inside any 10 s
//   hiss        the tape bed above 4 kHz louder than -32 dBFS in the pauses (the user asked for a low hiss)
// Each finding names the bus that dominates the score there (sfx or music, from the stems) and the cut that would clear it.
// piece.json "review": { "soundIgnore": [[t0, t1, "why"]] } lets a deliberate moment pass (printed as OK, allowed).
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SR = 48000, HOP = SR / 10;
function decode(file, ch = 2) {
  if (!fs.existsSync(file)) return null;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', String(ch), '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 2 ** 31 });
  if (r.status !== 0) return null;
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
  const out = Array.from({ length: ch }, () => new Float32Array(f.length / ch));
  for (let i = 0; i < f.length; i++) out[i % ch][Math.floor(i / ch)] = f[i];
  return out;
}
// a biquad run over a whole signal (RBJ coefficients or the BS.1770 K-weighting stages)
function biquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
const K1 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];   // 48 kHz
const K2 = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];
const rbj = (type, f0, q) => {
  const w = 2 * Math.PI * f0 / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
  if (type === 'bp') return [al / a0, 0, -al / a0, -2 * c / a0, (1 - al) / a0];
  if (type === 'hp') return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0];
  return [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0];   // lp
};
const band = (x, lo, hi) => biquad(biquad(biquad(biquad(x, rbj('hp', lo, 0.707)), rbj('hp', lo, 0.707)), rbj('lp', hi, 0.707)), rbj('lp', hi, 0.707));
// power per 100 ms hop, summed over channels
function hopPower(chs) {
  const n = Math.floor(chs[0].length / HOP), p = new Float64Array(n);
  for (const x of chs) for (let h = 0; h < n; h++) { let s = 0; for (let i = h * HOP; i < (h + 1) * HOP; i++) s += x[i] * x[i]; p[h] += s / HOP; }
  return p;
}
// a level over a window of `w` hops ending at each hop, in dB (LUFS when the power is K-weighted)
const windowed = (p, w, off = 0) => Array.from(p, (_, h) => { let s = 0, n = 0; for (let k = Math.max(0, h - w + 1); k <= h; k++) { s += p[k]; n++; } return off + 10 * Math.log10(s / n + 1e-12); });
const lufs = (chs) => { const kp = hopPower(chs.map((x) => biquad(biquad(x, K1), K2))); return { M: windowed(kp, 4, -0.691), S: windowed(kp, 30, -0.691), kp }; };
function integrated(kp) {   // BS.1770 gating: 400 ms blocks every 100 ms, absolute gate -70 LUFS, relative gate -10 LU
  const bp = []; for (let i = 3; i < kp.length; i++) bp.push((kp[i - 3] + kp[i - 2] + kp[i - 1] + kp[i]) / 4);
  const L = (p) => -0.691 + 10 * Math.log10(p + 1e-12), mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const abs = bp.filter((p) => L(p) > -70), rel = L(mean(abs)) - 10;
  return L(mean(abs.filter((p) => L(p) > rel)));
}
const db = (p) => 10 * Math.log10(p + 1e-12);
const fmt = (t) => `${t.toFixed(1)}s`;

export function soundCheck(root, T = {}) {
  const R = path.join(root, 'renders'), piece = fs.existsSync(path.join(root, 'piece.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'piece.json'), 'utf8')) : {};
  const mix = decode(path.join(R, 'audio.wav'));
  if (!mix) return null;
  const score = decode(path.join(R, 'audio-score.wav')), sfx = decode(path.join(R, 'stem-sfx.wav')), music = decode(path.join(R, 'stem-music.wav')), voice = decode(path.join(R, 'stem-voice.wav'), 1);
  const L = lufs(mix), I = integrated(L.kp), n = L.M.length;
  const busM = (chs) => (chs ? lufs(chs).M : null), mS = busM(sfx), mM = busM(music);
  const lines = fs.existsSync(path.join(root, 'voice.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'voice.json'), 'utf8')).lines || [] : [];
  const payoff = (T.acts || []).filter((a) => a.role === 'payoff' || a.role === 'gift');
  const inPayoff = (t) => payoff.some((a) => t >= a.t0 - 0.3 && t < a.t1);
  const ignore = piece.review?.soundIgnore || [];
  const who = (h) => {   // which bus of the score dominates at hop h
    if (!mS || !mM) return 'score';
    const d = mS[h] - mM[h];
    return d > 3 ? 'sfx' : d < -3 ? 'music' : 'sfx+music';
  };
  const speaking = (t) => lines.find((l) => t >= l.t0 - 0.1 && t <= l.t1 + 0.1);
  const findings = [], stats = {};
  const add = (rule, t0, t1, text, fix, sev = 'WARN') => {
    const ok = ignore.find(([a, b]) => t0 >= a - 1e-6 && t1 <= b + 1e-6);
    findings.push({ rule, t0, t1, text, fix, sev: ok ? 'OK' : sev, why: ok?.[2] });
  };
  // runs of hops where cond holds, merged across gaps under `gap` hops
  const runs = (cond, gap = 3) => { const out = []; let a = null, last = -99; for (let h = 0; h < n; h++) if (cond(h)) { if (a == null || h - last > gap) { if (a != null) out.push([a, last]); a = h; } last = h; } if (a != null) out.push([a, last]); return out; };

  // ---- startle: a jump over the 8 s before it, outside the payoff. It has to be the score jumping too: a voice coming in
  // after a silence is a line starting, not a jolt (masking judges the voice)
  // (a context needs 3 s of sound in it: the first sound after the tape starts is the opening, not a jump)
  const context = (M) => M.map((_, h) => { const w = M.slice(Math.max(0, h - 82), Math.max(0, h - 2)).filter((v) => v > -60).sort((x, y) => x - y); return w.length >= 30 ? w[Math.floor(w.length / 2)] : Infinity; });
  const ctx = context(L.M), SM = score ? lufs(score).M : L.M, ctxS = score ? context(SM) : ctx;
  for (const [a, b] of runs((h) => L.M[h] >= I - 4 && L.M[h] - ctx[h] >= 10 && SM[h] - ctxS[h] >= 10 && !inPayoff(h / 10))) {
    let pk = a; for (let h = a; h <= b; h++) if (L.M[h] > L.M[pk]) pk = h;
    const jump = L.M[pk] - ctx[pk], line = speaking(pk / 10);
    add('startle', a / 10, (b + 1) / 10, `${fmt(pk / 10)}: ${who(pk)} jumps ${jump.toFixed(1)} LU over the 8 s before (momentary ${L.M[pk].toFixed(1)} LUFS)${line ? `, over the line "${line.text.slice(0, 30)}"` : ''}`,
      `pull the ${who(pk)} there down ${Math.ceil(jump - 6)} dB (a jump of <= 6 LU reads as a change, not a jolt)`);
  }
  const startles = findings.filter((f) => f.rule === 'startle' && f.sev !== 'OK').length;
  if (startles > 2) findings.filter((f) => f.rule === 'startle').forEach((f) => { if (f.sev === 'WARN') f.sev = 'FAIL'; });
  // ---- payoff loudness
  for (const a of payoff) {
    let pk = Math.round(a.t0 * 10); for (let h = Math.round(a.t0 * 10); h < Math.min(n, Math.round(a.t1 * 10)); h++) if (L.M[h] > L.M[pk]) pk = h;
    const over = L.M[pk] - I;
    if (over > 16) add('payoff', a.t0, a.t1, `the payoff peaks ${over.toFixed(1)} LU over the episode (${L.M[pk].toFixed(1)} vs ${I.toFixed(1)} LUFS) at ${fmt(pk / 10)}`, `bring it down ${Math.ceil(over - 14)} dB: the silence before it does the scaring`);
  }
  // ---- piercing: a 10 ms burst of the score >= 20 dB over the 400 ms before it, and loud in the mix (the ear hears a click
  // by its short energy against what came just before, not by its sample peak)
  if (score) {
    const B = SR / 100, nb = Math.floor(score[0].length / B), e = new Float64Array(nb);
    for (const x of score) for (let k = 0; k < nb; k++) { let q = 0; for (let i = k * B; i < (k + 1) * B; i++) q += x[i] * x[i]; e[k] += q / B; }
    const pierce = new Float64Array(n);
    for (let k = 40; k < nb; k++) {
      let c = 0; for (let j = k - 40; j < k - 1; j++) c += e[j]; c /= 39;
      const jump = db(e[k]) - db(c), h = Math.floor(k / 10);
      if (h < n && jump >= 20 && db(e[k]) > -24 && !inPayoff(k / 100)) pierce[h] = Math.max(pierce[h], jump);
    }
    // one finding per click, except a click that keeps coming back (a pluck every 2 s, a reel): one finding for the series
    const hits = runs((h) => pierce[h] > 0, 2).map(([a, b]) => ({ a, b, worst: Math.max(...pierce.slice(a, b + 1)), bus: who(a) }));
    for (let i = 0; i < hits.length;) {
      let j = i + 1; while (j < hits.length && hits[j].bus === hits[i].bus && hits[j].a - hits[j - 1].b <= 60) j++;
      const g = hits.slice(i, j), worst = Math.max(...g.map((x) => x.worst));
      if (g.length >= 3) add('piercing', g[0].a / 10, (g[g.length - 1].b + 1) / 10, `${fmt(g[0].a / 10)}-${fmt((g[g.length - 1].b + 1) / 10)}: a ${g[0].bus} click that keeps coming back, ${g.length} times, up to ${worst.toFixed(0)} dB over the 400 ms before it`, 'a softer attack (2-5 ms) on that sound, or 6 dB less: a repeated jab tires faster than a single one');
      else for (const x of g) add('piercing', x.a / 10, (x.b + 1) / 10, `${fmt(x.a / 10)}: a click/crack ${x.worst.toFixed(0)} dB over the 400 ms before it (${x.bus})`, 'soften its attack (2-5 ms instead of an instant start) or lower it 6 dB');
      i = j;
    }
  }
  // ---- harshness: energy share in 2-5 kHz on loud stretches
  {
    const hp = hopPower(mix.map((x) => band(x, 2000, 5000))), all = hopPower(mix);
    const w = (p, h) => p.slice(Math.max(0, h - 3), h + 1).reduce((a, v) => a + v, 0);
    const share = Array.from({ length: n }, (_, h) => w(hp, h) / (w(all, h) + 1e-12));
    stats.harsh = Math.max(0, ...share.filter((_, h) => L.M[h] >= I - 4 && !speaking(h / 10)));
    for (const [a, b] of runs((h) => L.M[h] >= I - 4 && share[h] > 0.3 && !speaking(h / 10), 5)) {
      if (b - a < 3) continue;
      const m = Math.max(...share.slice(a, b + 1));
      add('harsh', a / 10, (b + 1) / 10, `${fmt(a / 10)}-${fmt((b + 1) / 10)}: ${(m * 100).toFixed(0)}% of the energy in 2-5 kHz on a loud stretch (${who(a)})`, `a cut of 4-6 dB around 3 kHz on that ${who(a)} (a lower filter frequency, or a lowpass)`);
    }
  }
  // ---- masking: each voice line against what else is in the delivered mix, speech band. The voice's share of the mix is
  // fitted per line (the mix is the voice times a gain plus the rest), so the ducking, the sidechain and the loudness stage
  // are all counted as they really came out
  if (voice && lines.length) {
    const m = band(mix[0].map((v, i) => (v + mix[1][i]) / 2), 300, 4000), vb = band(voice[0], 300, 4000);
    // the mix runs a little late (the limiter's look-ahead): find the lag (+-10 ms) on the longest line first
    const long = lines.reduce((x, y) => (y.t1 - y.t0 > x.t1 - x.t0 ? y : x)), la = Math.round(long.t0 * SR), lb = Math.min(m.length - 480, vb.length, Math.round(long.t1 * SR));
    let lag = 0, bestC = -Infinity;
    for (let d = -480; d <= 480; d++) { let c = 0; for (let i = la + 480; i < lb; i += 4) c += m[i + d] * vb[i]; if (c > bestC) { bestC = c; lag = d; } }
    for (const l of lines) {
      const a = Math.round(l.t0 * SR), b = Math.min(m.length - Math.abs(lag), vb.length, Math.round(l.t1 * SR));
      if (b - a < SR / 5 || a + lag < 0) continue;
      let mv = 0, vv = 0; for (let i = a; i < b; i++) { mv += m[i + lag] * vb[i]; vv += vb[i] * vb[i]; }
      const g = mv / (vv || 1e-12); let rr = 0; for (let i = a; i < b; i++) { const r = m[i + lag] - g * vb[i]; rr += r * r; }
      const snr = db(g * g * vv) - db(rr);
      stats.voice = Math.min(stats.voice ?? Infinity, snr);
      if (snr < 8) add('masking', l.t0, l.t1, `"${l.text.slice(0, 40)}": the voice only ${snr.toFixed(1)} dB over the score in the speech band (${who(a)})`, `${8 - Math.floor(snr)} dB less ${who(a)} under this line, or move the hit into the pause after it`);
    }
  }
  // ---- fatigue: time spent well over the episode's loudness
  {
    const sounding = L.S.filter((v) => v > -50), loud = sounding.filter((v) => v >= I + 3).length / Math.max(1, sounding.length);
    stats.loud = loud;
    if (loud > 0.25) add('fatigue', 0, n / 10, `${(loud * 100).toFixed(0)}% of the sounding time is >= 3 LU over the episode's loudness: the ear never rests`, 'quieter beds between the events; let the pauses be pauses', 'WARN');
  }
  // ---- busy: sound-effect onsets per 10 s
  if (mS) {
    const on = []; for (let h = 1; h < n; h++) if (mS[h] - mS[h - 1] >= 6 && mS[h] > I - 20) on.push(h / 10);
    let worst = [0, 0]; for (let i = 0; i < on.length; i++) { let j = i; while (j < on.length && on[j] < on[i] + 10) j++; if (j - i > worst[0]) worst = [j - i, on[i]]; }
    stats.busy = worst[0];
    if (worst[0] > 12 && !inPayoff(worst[1])) add('busy', worst[1], worst[1] + 10, `${worst[0]} sound-effect onsets in 10 s from ${fmt(worst[1])}: too many things asking for attention`, 'drop or merge the smaller ones; keep the one the picture is about');
  }
  // ---- hiss in the pauses
  if (score) {
    const hf = hopPower(score.map((x) => band(x, 4000, 16000))), quiet = [];
    // the pauses: no line, the score sounding (not a signal drop), and no event in the way (the score within 6 LU of its median)
    const on = SM.filter((v) => v > -50).sort((x, y) => x - y), smed = on[Math.floor(on.length / 2)] ?? -50;
    for (let h = 0; h < Math.min(n, hf.length, SM.length); h++) if (!speaking(h / 10) && SM[h] > -50 && SM[h] < smed + 6) quiet.push(db(hf[h] / 2));
    if (quiet.length) { quiet.sort((x, y) => x - y); const med = quiet[Math.floor(quiet.length / 2)]; stats.hiss = med; if (med > -32) add('hiss', 0, n / 10, `the tape hiss in the pauses reads ${med.toFixed(1)} dBFS above 4 kHz`, `lower the hiss beds ${Math.ceil(med + 35)} dB (lib HISS)`); }
  }
  findings.sort((a, b) => a.t0 - b.t0);
  return { I, M: L.M, lines, payoff, findings, stats, duration: n / 10 };
}

export function printSoundCheck(r) {
  if (!r) { console.log('\nSOUND CHECK: no renders/audio.wav'); return true; }
  console.log(`\nSOUND CHECK (a listener's critique, measured: integrated ${r.I.toFixed(1)} LUFS; momentary 400 ms / short-term 3 s, BS.1770)`);
  const rules = ['startle', 'payoff', 'piercing', 'harsh', 'masking', 'fatigue', 'busy', 'hiss'];
  for (const f of r.findings) console.log(`  ${f.sev.padEnd(4)}  ${f.rule.padEnd(8)} ${f.text}${f.sev === 'OK' ? `  (allowed: ${f.why || ''})` : `\n                 -> ${f.fix}`}`);
  const bad = r.findings.filter((f) => f.sev === 'FAIL').length, warn = r.findings.filter((f) => f.sev === 'WARN').length;
  const counts = rules.map((k) => `${k} ${r.findings.filter((f) => f.rule === k && f.sev !== 'OK').length}`).join(', ');
  const st = r.stats, num = (v, f) => (v == null || !isFinite(v) ? '-' : f(v));
  console.log(`  levels: worst voice clarity ${num(st.voice, (v) => v.toFixed(1) + ' dB')} (>= 8) · harshest loud stretch ${num(st.harsh, (v) => (v * 100).toFixed(0) + '%')} in 2-5 kHz (<= 30%) · loud time ${num(st.loud, (v) => (v * 100).toFixed(0) + '%')} (<= 25%) · busiest 10 s ${num(st.busy, (v) => v + ' onsets')} (<= 12) · hiss in pauses ${num(st.hiss, (v) => v.toFixed(1) + ' dBFS')} (<= -32)`);
  console.log(`sound check: ${bad ? 'FAIL' : warn ? 'WARN' : 'PASS'} (${counts})`);
  return !bad;
}

// review/sound.svg: the momentary loudness over time, the voice lines shaded, the payoff marked, every finding in red
export function soundSvg(r, file) {
  if (!r) return;
  const W = 1600, H = 360, top = 20, bot = 300, x = (t) => 40 + (t / r.duration) * (W - 60), y = (l) => top + ((-5 - Math.max(-60, Math.min(-5, l))) / 55) * (bot - top);
  const pts = r.M.map((l, h) => `${x(h / 10).toFixed(1)},${y(l).toFixed(1)}`).join(' ');
  const col = { startle: '#e5484d', payoff: '#e5484d', piercing: '#f76b15', harsh: '#ffb224', masking: '#8e4ec6', busy: '#ffb224', fatigue: '#e5484d', hiss: '#8e4ec6' };
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="monospace" font-size="12"><title>Sound check</title><rect width="${W}" height="${H}" fill="#111"/>`,
    ...r.lines.map((l) => `<rect x="${x(l.t0)}" y="${top}" width="${Math.max(1, x(l.t1) - x(l.t0))}" height="${bot - top}" fill="#3b82f6" opacity="0.18"/>`),
    ...r.payoff.map((a) => `<rect x="${x(a.t0)}" y="${top}" width="${x(a.t1) - x(a.t0)}" height="${bot - top}" fill="#22c55e" opacity="0.15"/>`),
    ...[-10, -20, -30, -40, -50].map((l) => `<line x1="40" x2="${W - 20}" y1="${y(l)}" y2="${y(l)}" stroke="#333"/><text x="4" y="${y(l) + 4}" fill="#777">${l}</text>`),
    `<line x1="40" x2="${W - 20}" y1="${y(r.I)}" y2="${y(r.I)}" stroke="#888" stroke-dasharray="6 4"/><text x="${W - 160}" y="${y(r.I) - 4}" fill="#aaa">integrated ${r.I.toFixed(1)}</text>`,
    `<polyline points="${pts}" fill="none" stroke="#e5e5e5" stroke-width="1.2"/>`,
    ...r.findings.filter((f) => f.sev !== 'OK' && f.rule !== 'fatigue' && f.rule !== 'hiss').map((f, i) => `<rect x="${x(f.t0)}" y="${bot + 6 + (i % 3) * 14}" width="${Math.max(3, x(f.t1) - x(f.t0))}" height="10" fill="${col[f.rule]}"/><title>${f.rule}: ${f.text.replace(/[<&"]/g, '')}</title>`),
    ...Array.from({ length: Math.floor(r.duration / 10) + 1 }, (_, k) => `<text x="${x(k * 10) - 8}" y="${H - 6}" fill="#777">${k * 10}s</text>`),
    `<text x="44" y="14" fill="#aaa">momentary loudness (LUFS) · blue = voice lines · green = payoff · bars = findings (red startle/payoff, orange piercing, yellow harsh/busy, purple masking)</text></svg>`];
  fs.writeFileSync(file, svg.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] && path.resolve(process.argv[2]);
  if (!root) { console.error('usage: node tools/soundcheck.mjs <piece dir>'); process.exit(2); }
  let T = {};
  if (fs.existsSync(path.join(root, 'index.html'))) {
    const require = createRequire(import.meta.url);
    const { chromium } = (() => { try { return require('playwright'); } catch { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();
    const browser = await chromium.launch(), page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?export=1');
    await page.waitForFunction(() => window.TIMELINE);
    T = await page.evaluate(() => ({ acts: window.TIMELINE.acts || [] }));
    await browser.close();
  }
  const r = soundCheck(root, T);
  if (r) { fs.mkdirSync(path.join(root, 'review'), { recursive: true }); soundSvg(r, path.join(root, 'review', 'sound.svg')); }
  process.exit(printSoundCheck(r) ? 0 : 1);
}
