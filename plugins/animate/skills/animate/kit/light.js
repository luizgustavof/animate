// =====================================================================
//  kit/light.js — opt-in 2D lighting for an era: a light map, window rays with dust, and cast shadows.
//
//  piece.json "light": true makes tools/build.mjs add this file. The piece then defines
//    function pieceLight(era, t) { return rig | null }      (world coords, like the scene)
//  rig = {
//    ambient: [r, g, b]          the room's base light, 0..1 per channel (multiplied over the era; 1 = untouched)
//    lights:  [{ x, y, r, color: [r,g,b], power, flicker?, seed? }]   soft pools that lift the ambient back up
//    glow:    [{ x, y, r, color, alpha }]                             screen-blended warmth (lamp halos, sun spill)
//    rays:    [{ from: [[x,y],[x,y]], dir: [dx,dy], len, color, alpha, n?, dust? }]   a window's beams + floating dust
//    shadow:  { dx, dy, blur, alpha, color }  the default cast shadow (away from the key light)
//  }
//  kit/morph.js calls lightBegin(era, t) before the scene draws and lightEnd(target) after it, both inside the
//  era's camera transform; captions and tags (DEFER) are drawn later at full resolution and stay unlit.
//  Cast shadows: wrap a drawing function once, in the piece:  babidi = shadowed(babidi);  cake = shadowed(cake, { blur: 10 })
//  It draws the figure's silhouette (the same function, into an offscreen canvas), offsets and blurs it, and
//  multiplies it onto what is already drawn (the wall, the counter), then draws the figure over it.
//  Everything is a function of (era, t): deterministic.
// =====================================================================
let LIGHT_RIG = null, LIGHT_SIL = false;
const LIGHT_CV = {};
function lightCanvas(k, w, h) {
  let c = LIGHT_CV[k];
  if (!c || c.width !== w || c.height !== h) { c = document.createElement('canvas'); c.width = w; c.height = h; LIGHT_CV[k] = c; }
  return c;
}
const rgbA = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
function lightBegin(era, t) { LIGHT_RIG = typeof pieceLight === 'function' ? pieceLight(era, t) || null : null; }
// a smooth deterministic flicker: sum of sines seeded per light
const flick = (t, seed, amt) => 1 + amt * (0.5 * Math.sin(t * 7.3 + seed) + 0.3 * Math.sin(t * 13.1 + seed * 2.1) + 0.2 * Math.sin(t * 23.7 + seed * 3.7));

function lightEnd(target) {
  const R = LIGHT_RIG; LIGHT_RIG = null;
  if (!R) return;
  const g = ctx, m = g.getTransform(), w = target.width, h = target.height;
  // 1. the light map: ambient, plus each light's pool, multiplied over the era
  if (R.ambient || R.lights) {
    const lm = lightCanvas('map', w, h), lc = lm.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1; lc.filter = 'none';
    lc.fillStyle = rgbA(R.ambient || [1, 1, 1]); lc.fillRect(0, 0, w, h);
    lc.setTransform(m); lc.globalCompositeOperation = 'lighter';
    for (const L of R.lights || []) {
      const p = (L.power ?? 0.3) * (L.flicker ? flick(TT, L.seed ?? 1, L.flicker) : 1), c = L.color || [1, 0.95, 0.85];
      const gr = lc.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      gr.addColorStop(0, rgbA(c.map((v) => v * p))); gr.addColorStop(0.45, rgbA(c.map((v) => v * p * 0.55))); gr.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = gr; lc.beginPath(); lc.arc(L.x, L.y, L.r, 0, TAU); lc.fill();
    }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none'; g.globalCompositeOperation = 'multiply'; g.drawImage(lm, 0, 0); g.restore();
  }
  // 2. rays: soft beams from a window edge, screen-blended, with slow striping and drifting dust in them
  for (const Ry of R.rays || []) {
    const [[ax, ay], [bx, by]] = Ry.from, [dx, dy] = Ry.dir, len = Ry.len ?? 900, n = Ry.n ?? 7, col = Ry.color || [1, 0.92, 0.75];
    const dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
    g.save(); g.globalCompositeOperation = 'screen'; g.filter = `blur(${5 * m.a}px)`;
    for (let i = 0; i < n; i++) {
      const R0 = RNG('ray', i), u0 = (i + R0.r(0, 0.3)) / n, u1 = u0 + R0.r(0.15, 0.45) / n;   // beams with gaps between them
      const p0 = [lerp(ax, bx, u0), lerp(ay, by, u0)], p1 = [lerp(ax, bx, u1), lerp(ay, by, u1)];
      const a = (Ry.alpha ?? 0.22) * (0.55 + 0.45 * Math.sin(TT * R0.r(0.2, 0.5) + R0.r(0, TAU)));
      const gr = g.createLinearGradient(p0[0], p0[1], p0[0] + ux * len, p0[1] + uy * len);
      gr.addColorStop(0, rgbA(col, a)); gr.addColorStop(1, rgbA(col, 0));
      const sp = 1.12;   // beams widen a little with distance
      g.fillStyle = gr; g.beginPath();
      g.moveTo(...p0); g.lineTo(...p1);
      g.lineTo(p1[0] + ux * len + (p1[0] - p0[0]) * (sp - 1) * 3, p1[1] + uy * len + (p1[1] - p0[1]) * (sp - 1) * 3);
      g.lineTo(p0[0] + ux * len, p0[1] + uy * len); g.closePath(); g.fill();
    }
    g.filter = 'none';
    // dust motes: drift slowly along and across the beam, twinkle as they turn
    const nd = Ry.dust ?? 40;
    for (let i = 0; i < nd; i++) {
      const D = RNG('dust', i), v = mod(D.r(0, 1) + TT * D.r(0.008, 0.02), 1), s = D.r(0, 1);
      const x = lerp(ax, bx, s) + ux * len * v + Math.sin(TT * D.r(0.3, 0.8) + i) * 14, y = lerp(ay, by, s) + uy * len * v + Math.cos(TT * D.r(0.3, 0.7) + i) * 10;
      const tw = 0.5 + 0.5 * Math.sin(TT * D.r(1.5, 3.5) + i * 1.7), r = D.r(1.5, 3.8);
      g.fillStyle = rgbA(col, (Ry.alpha ?? 0.22) * 2.6 * tw * Math.sin(v * Math.PI)); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.restore();
  }
  // 3. sun patches (unless the scene already laid them on its background with lightPatches())
  if (!R._patched) lightPatches(R);
  // 4. glow: screen-blended halos (the oven's window, a sunlit patch on the wall)
  for (const G of R.glow || []) {
    const a = (G.alpha ?? 0.35) * (G.flicker ? flick(TT, G.seed ?? 2, G.flicker) : 1), c = G.color || [1, 0.8, 0.5];
    const gr = g.createRadialGradient(G.x, G.y, 0, G.x, G.y, G.r);
    gr.addColorStop(0, rgbA(c, a)); gr.addColorStop(1, rgbA(c, 0));
    g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = gr; g.beginPath(); g.arc(G.x, G.y, G.r, 0, TAU); g.fill(); g.restore();
  }
}
// sun patches: a window's light landing on the wall / counter — its panes as a skewed bright shape, shifted along
// the light, the mullions as bars across it. patch = { x, y, w, h, shift: [dx, dy], skew, color, alpha, bars, blur }.
// Only for a window OFF frame (beside or behind the camera) throwing its light onto the wall we see: a window on the
// back wall shines toward us and can't land on its own wall (light the counter under it with a pool instead).
// Call lightPatches() right after the scene's background so figures in front stay out of the light; otherwise lightEnd
// lays them over everything.
function lightPatches(R = LIGHT_RIG) {
  if (!R || LIGHT_SIL) return;
  R._patched = true;
  const g = ctx, m = g.getTransform();
  for (const P of R.patches || []) {
    const [sx, sy] = P.shift || [-300, 400], k = P.skew ?? -0.4, col = P.color || [1, 0.9, 0.7], bw = P.bars ?? 14;
    const q = (u, v) => [P.x + sx + u * P.w + v * P.h * k, P.y + sy + v * P.h];   // u across, v down, sheared along the light
    const pane = (u0, v0, u1, v1) => { g.beginPath(); g.moveTo(...q(u0, v0)); g.lineTo(...q(u1, v0)); g.lineTo(...q(u1, v1)); g.lineTo(...q(u0, v1)); g.closePath(); g.fill(); };
    const hu = bw / 2 / P.w, hv = bw / 2 / P.h;
    g.save(); g.globalCompositeOperation = 'soft-light'; g.filter = `blur(${(P.blur ?? 6) * m.a}px)`;
    g.fillStyle = rgbA(col, P.alpha ?? 0.8);
    for (const [u0, u1] of [[0, 0.5 - hu], [0.5 + hu, 1]]) for (const [v0, v1] of [[0, 0.5 - hv], [0.5 + hv, 1]]) pane(u0, v0, u1, v1);
    g.globalCompositeOperation = 'screen'; g.fillStyle = rgbA(col, (P.alpha ?? 0.8) * (P.screen ?? 0.55));
    for (const [u0, u1] of [[0, 0.5 - hu], [0.5 + hu, 1]]) for (const [v0, v1] of [[0, 0.5 - hv], [0.5 + hv, 1]]) pane(u0, v0, u1, v1);
    g.restore();
  }
}

// ---- cast shadows
function castShadow(draw, o = {}) {
  const S = { dx: 34, dy: 18, blur: 16, alpha: 0.32, color: [0.18, 0.11, 0.2], ...((LIGHT_RIG && LIGHT_RIG.shadow) || {}), ...o };
  if (!S.alpha) return;
  const g = ctx, cv = g.canvas, off = lightCanvas('sil', cv.width, cv.height), oc = off.getContext('2d'), m = g.getTransform();
  oc.setTransform(1, 0, 0, 1, 0, 0); oc.globalCompositeOperation = 'source-over'; oc.globalAlpha = 1; oc.filter = 'none'; oc.clearRect(0, 0, off.width, off.height);
  oc.setTransform(m);
  const keepCtx = ctx, keepDefer = DEFER, keepSpark = SPARK_AT;
  ctx = oc; DEFER = []; LIGHT_SIL = true;
  try { draw(); } finally { ctx = keepCtx; DEFER = keepDefer; SPARK_AT = keepSpark; LIGHT_SIL = false; }
  oc.setTransform(1, 0, 0, 1, 0, 0); oc.globalAlpha = 1; oc.filter = 'none'; oc.globalCompositeOperation = 'source-in';
  oc.fillStyle = rgbA(S.color); oc.fillRect(0, 0, off.width, off.height);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = S.alpha; g.globalCompositeOperation = 'multiply'; g.filter = `blur(${S.blur * m.a}px)`;
  g.drawImage(off, S.dx * m.a, S.dy * m.a); g.restore();
}
// shadowed(fn, o?) -> a drop-in replacement for fn that casts its shadow first; o may be a function of fn's arguments.
// Inside another figure's silhouette pass it draws plainly (no shadows of shadows). Only while a rig is lit.
function shadowed(fn, o = {}) {
  return function (...a) {
    if (!LIGHT_RIG || LIGHT_SIL || !LIGHT_RIG.shadow) return fn.apply(this, a);
    castShadow(() => fn.apply(this, a), typeof o === 'function' ? o(...a) : o);
    return fn.apply(this, a);
  };
}
