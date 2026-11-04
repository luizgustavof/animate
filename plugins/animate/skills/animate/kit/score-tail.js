  // =====================================================================
  //  kit/score-tail.js — render, fold the tail over the loop point, loudness stage
  //  (RMS-normalise to -17 dBFS, look-ahead limiter at -1 dBFS; stems share the mix gain curve)
  // =====================================================================
  // the queued short notes (kit/score-head.js lazy): the first second now, then each next second while the render is
  // suspended a second earlier (AHEAD keeps a note that starts right at a suspend point ahead of the render clock)
  const LAZY_STEP = 1, LAZY_AHEAD = 0.25, DUR = len / sampleRate;
  const horizon = (at) => (at + 2 * LAZY_STEP >= DUR ? Infinity : at + LAZY_STEP + LAZY_AHEAD);   // the last suspend builds the rest
  lazyRun(horizon(0));
  for (let T = LAZY_STEP; T < DUR - LAZY_STEP / 2; T += LAZY_STEP) {
    const at = T;
    ac.suspend(at).then(() => { lazyRun(horizon(at), at); ac.resume(); });
  }
  ac.__lazyFlush = () => lazyRun(Infinity);   // tools/export.mjs builds everything to sign the score without rendering it
  const buf = await ac.startRendering();
  // fold the tail over the loop point so the loop is seamless
  const N = Math.round(LOOP_T * sampleRate), L = new Float32Array(N), Rr = new Float32Array(N);
  const c0 = buf.getChannelData(0), c1 = buf.getChannelData(1);
  for (let i = 0; i < N; i++) { L[i] = c0[i] + (i + N < len ? c0[i + N] : 0); Rr[i] = c1[i] + (i + N < len ? c1[i + N] : 0); }
  return normIn === 'raw' ? { left: L, right: Rr, sampleRate } : levelScore({ left: L, right: Rr, sampleRate }, normIn);
}
function levelScore({ left: L, right: Rr, sampleRate }, normIn) {
  const N = L.length;
  // loudness for a phone (subagents-short): RMS-normalise to -17 dBFS, then a look-ahead limiter at -1 dBFS.
  // Stems reuse the mix's gain and gain curve, so they sum back to the mix.
  let k = normIn?.k, g = normIn?.g;
  if (!g) {
    let sum = 0; for (let i = 0; i < N; i++) sum += (L[i] * L[i] + Rr[i] * Rr[i]) / 2;
    k = 10 ** (-17 / 20) / Math.sqrt(sum / N || 1e-12);
    const ceil = 0.89; g = new Float32Array(N);
    for (let i = 0; i < N; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(Rr[i])) * k; g[i] = p > ceil ? ceil / p : 1; }
    const att = Math.exp(-1 / (0.0015 * sampleRate)), rel = Math.exp(-1 / (0.09 * sampleRate));
    for (let i = N - 2; i >= 0; i--) g[i] = Math.min(g[i], 1 - (1 - g[i + 1]) * att);
    let r = 1; for (let i = 0; i < N; i++) { r = Math.min(g[i], 1 - (1 - r) * rel); g[i] = r; }
  }
  for (let i = 0; i < N; i++) { L[i] *= k * g[i]; Rr[i] *= k * g[i]; }
  return { left: L, right: Rr, sampleRate, norm: { k, g } };
}
function wavB64(s) {
  const bytes = encodeWav(s.left, s.right, s.sampleRate);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function renderAudioWav() { return wavB64(await buildScore(48000, 'mix')); }
async function renderAudioStems() {
  const mix = await buildScore(48000, 'mix');
  const music = await buildScore(48000, 'music', mix.norm), sfx = await buildScore(48000, 'sfx', mix.norm);
  return { music: wavB64(music), sfx: wavB64(sfx) };
}
// everything export needs in one pass: the mix and its music and sfx stems rendered side by side (each OfflineAudioContext
// renders on its own audio thread), then all three levelled with the mix's loudness curve, so the stems still sum to the mix
async function renderAudioAll() {
  const [rm, ru, rs] = await Promise.all(['mix', 'music', 'sfx'].map((p) => buildScore(48000, p, 'raw')));
  const mix = levelScore(rm);
  return { mix: wavB64(mix), music: wavB64(levelScore(ru, mix.norm)), sfx: wavB64(levelScore(rs, mix.norm)) };
}
window.renderAudioAll = renderAudioAll;
window.renderAudioWav = renderAudioWav;
window.renderAudioStems = renderAudioStems;
</script>
</body>
</html>
