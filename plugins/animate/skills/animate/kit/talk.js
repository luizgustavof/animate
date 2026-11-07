// =====================================================================
//  kit/talk.js — opt-in "alive" helpers for characters (piece.json "talk": true adds this file).
//  All are pure functions of time (and a seed): deterministic, any frame in any order.
//  No lip sync here on purpose: the mouth stays the character's own (it opens with the voice's loudness).
//
//    blink(t, seed)  lid closure 0..1: blinks at irregular 2–5 s gaps, sometimes doubled, ~0.16 s each.
//    breathe(t, seed, rate?)  { y, s }: chest rise (px at s=1) and a tiny scale, ~15 breaths a minute.
//    saccade(t, seed, amt?)   [dx, dy]: small eye darts held for 0.6–2 s.
//    nod(t, o?)      a head dip on stressed syllables (the loudness rising), 0..1.
//    lag(f, t, d)    f(t - d): secondary motion — hair, ears, a tail following the head a beat late.
// =====================================================================
// blinks: a deterministic schedule walked from t = 0 (cached per seed)
const BLINK_CACHE = new Map();
function blinkTimes(seed, upTo) {
  let L = BLINK_CACHE.get(seed);
  if (!L) { L = { t: [], end: 0, i: 0 }; BLINK_CACHE.set(seed, L); }
  while (L.end <= upTo + 6) {
    const R = RNG('blink', seed, L.i++);
    L.end += R.r(2.0, 5.0); L.t.push(L.end);
    if (R.r(0, 1) < 0.18) { L.end += 0.28; L.t.push(L.end); }   // a double blink
  }
  return L.t;
}
function blink(t, seed = 1, dur = 0.16) {
  let c = 0;
  for (const b of blinkTimes(seed, t)) { if (b > t + dur) break; const u = (t - b) / dur; if (u >= 0 && u < 1) c = Math.max(c, u < 0.4 ? EZ.o2(u / 0.4) : 1 - EZ.io((u - 0.4) / 0.6)); }
  return c;
}
function breathe(t, seed = 1, rate = 0.25) {
  const R = RNG('breath', seed), ph = R.r(0, TAU), w = TAU * rate * (1 + 0.06 * Math.sin(t * 0.21 + ph));
  const v = 0.5 - 0.5 * Math.cos(t * w + ph);   // in slowly, out a little faster reads the same at this size
  return { y: -6 * v, s: 0.012 * v };
}
function saccade(t, seed = 1, amt = 0.35) {
  let tt = 0, i = 0, cur = [0, 0];
  for (; tt <= t && i < 400; i++) { const R = RNG('sacc', seed, i); cur = [R.n(amt), R.n(amt * 0.6)]; tt += R.r(0.6, 2.0); }
  return cur;
}
function nod(t, o = {}) {
  if (typeof venv !== 'function') return 0;
  let d = 0;   // the loudness rising, averaged over ~0.2 s so the head moves, not twitches
  for (let k = 0; k < 5; k++) { const u = t - k * 0.04; d += (venv(u) - venv(u - 0.12)) / 5; }
  return clamp(d * (o.gain ?? 3));
}
const lag = (f, t, d) => f(t - d);
