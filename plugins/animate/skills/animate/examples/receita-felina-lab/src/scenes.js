// =====================================================================
//  SCENES — three shots of the kitchen. Each is drawn as planes at depths (kit/planes.js): the wall far,
//  the cast in the middle, the counter near, the bottle in the foreground the lens looks past.
// =====================================================================
const SH = (fn, o) => (typeof shadowed === 'function' ? shadowed(fn, o) : fn);
const marcellaS = SH(marcella), babidiS = SH(babidi, { blur: 12 }), bottleS = SH(bottle, { dx: 40, dy: 22, blur: 18 }), bowlS = SH(bowl), eggS = SH(egg, { blur: 6 });

function pieceLight(era, t) {
  return {
    ambient: [0.96, 0.95, 0.94],
    lights: [{ x: LX(0.15), y: LY(0.3), r: 900, color: [1, 0.95, 0.82], power: 0.06 }],
    shadow: { dx: 30, dy: 22, blur: 14, alpha: 0.26, color: [0.2, 0.16, 0.22] },
    key: { dir: [-0.55, -0.7, 0.75], color: [1, 0.96, 0.88], power: 1 },        // a window up and to the left
    fill: { dir: [0.6, 0.5, 1], color: [0.82, 0.9, 1], power: 0.45 },          // sky bounce from the right
    rim: { dir: [0.9, -0.2], color: [1, 0.95, 0.85], power: 0.18 },
    relight: { depth: 1.0, ao: 0.4 },
  };
}

// ---- the set
function wall(y1) {
  RF(0, () => {
    cut(rect(-30, -30, W + 60, y1 + 30, 0), KP.wall, { key: 'wall', shadow: false, tear: 0, shade: false, pat: pat.gingham('rgba(255,255,255,0.35)', 22) });
    cut(rect(-30, y1, W + 60, H - y1 + 30, 0), KP.tile, { key: 'tiles', shadow: false, tear: 0, shade: false, pat: pat.lines('rgba(150,180,190,0.35)', 70) });
  });
}
function cabinet(x, y, w, h, key) {
  RF(0.14, () => {
    cut(rect(x, y, w, h, 8), KP.cab, { key: key + 'b', mat: 'wood' });
    const n = Math.max(1, Math.round(w / 260));
    for (let i = 0; i < n; i++) {
      const dx = x + 16 + i * (w - 16) / n, dw = (w - 16) / n - 16;
      cut(rect(dx, y + 16, dw, h - 32, 6), KP.cab, { key: key + 'd' + i, h: 0.03, sb: 4, sy: 3, mat: 'wood' });
      cut(ellipsePts(dx + (i % 2 ? 26 : dw - 26), y + 60, 9, 9, 0, 12), '#b98a5a', { key: key + 'k' + i, h: 0.07, sb: 3, mat: 'metal' });
    }
  }, { mat: 'wood' });
}
function shelf(x, y, w, key = 'shelf') { RF(0.2, () => cut(rect(x, y, w, 34, 5), PAL.wood, { key, pat: pat.grainWood('rgba(120,60,20,0.2)') }), { mat: 'wood' }); }
function counterTop(y, key = 'ctr') {
  RF(0.24, () => {
    cut(rect(-30, y, W + 60, 60, 4), KP.counter, { key: key + 't', tear: 0.4, pat: pat.grainWood('rgba(110,55,20,0.22)'), sy: -2, mat: 'wood' });
    cut(rect(-30, y + 60, W + 60, H - y, 0), KP.cab, { key: key + 'c', tear: 0, shade: false, h: -0.02, shadow: false });
    for (let i = 0; i < 4; i++) {
      cut(rect(-10 + i * 280, y + 90, 260, H - y, 6), KP.cab, { key: key + 'd' + i, sb: 4, sy: 3 });
      cut(ellipsePts(-10 + i * 280 + (i % 2 ? 30 : 230), y + 150, 10, 10, 0, 12), '#b98a5a', { key: key + 'k' + i, h: 0.06, sb: 3, mat: 'metal' });
    }
  }, { mat: 'wood' });
}
function rail(x0, x1, y) {
  RF(0.12, () => {
    cut(rect(x0, y - 6, x1 - x0, 12, 6), '#9aa3ad', { key: 'rail', sb: 4, mat: 'metal' });
    cut(capsulePts(x0 + 50, y, x0 + 50, y + 230, 18), '#9aa3ad', { key: 'ladle', mat: 'metal' });
    cut(ellipsePts(x0 + 50, y + 250, 34, 26, 0, 18), '#9aa3ad', { key: 'ladleb', mat: 'metal' });
    cut(capsulePts(x0 + 130, y, x0 + 130, y + 190, 18), '#c08048', { key: 'spat', mat: 'wood' });
    cut(rect(x0 + 108, y + 180, 44, 80, 10), '#c08048', { key: 'spatb', mat: 'wood' });
  }, { mat: 'metal' });
}
function mugSteam(x, y, s) { RF(0.32, () => mug(x, y, s, PAL.teal, 'mug'), { mat: 'ceramic' }); }
function plantPot(x, y, s) { RF(0.3, () => plant(x, y, s, PAL.pinkL, 'plant'), { mat: 'cloth' }); }
const titleTag = () => { const f = () => tag('RECEITA FELINA', LX(0.33), SAFE.top + 70, 64, { fill: PAL.orange, color: '#fff8ec', rot: -0.03, tape: false }); if (DEFER) DEFER.push(f); else f(); };
const caption = (str) => { const f = () => tag(str, CX, H - SAFE.bottom - 40, 46, { rot: 0.012, tape: false, frac: ev(E0 + 0.3, 0.5) }); if (DEFER) DEFER.push(f); else f(); };

// ---- 1. Marcella behind the counter, Babidi asleep on the shelf, the bottle in the foreground
function sceneCounter() {
  const ct = LY(0.62), u = UNIT;
  planes([
    { z: 1.6, draw: () => {
      wall(LY(0.42));
      shelf(LX(0.55), LY(0.24), LX(0.47));
      cabinet(LX(0.57), LY(0.24) + 34, LX(0.45), LY(0.15), 'ucab');
      rail(LX(0.06), LX(0.32), LY(0.40));
      babidiS(LX(0.8), LY(0.24), 0.95 * u, { pose: 0, awake: 0 });
    } },
    { z: 1.0, draw: () => {
      marcellaS(LX(0.42), ct - 210 * u, 1.05 * u, { mouth: talking(TT, 0.4, 3.6), look: [0.3, -0.2], tilt: -0.03 });
      mugSteam(LX(0.14), ct - 96 * u, 0.9 * u);
      plantPot(LX(0.82), ct - 60 * u, 0.8 * u);
    } },
    { z: 0.9, draw: () => {
      counterTop(ct);
      arm(LX(0.22), ct + 10 * u, LX(0.3), ct + 26 * u, 1.05 * u, 'aL');
      arm(LX(0.64), ct + 10 * u, LX(0.56), ct + 26 * u, 1.05 * u, 'aR');
    } },
    { z: 0.5, draw: () => bottleS(LX(0.95), LY(0.86), 1.2 * u) },
  ], { cam: { x: Math.sin(TT * 0.4) * 30, zoom: 1 + TT * 0.006 }, focus: 1.0, aperture: 24, haze: { color: '#e4f0ec', amt: 0.12 } });
  titleTag();
  caption('E aquela ali em cima é a Babidi,');
}

// ---- 2. close on the counter: the whisk turns, a hand reaches for the bottle
function sceneHands() {
  const u = UNIT, ct = LY(0.36), t = TT - E0, a = t * 9;
  const grab = ev(TIMELINE.cues.grab, 0.6);
  planes([
    { z: 1.5, draw: () => { wall(LY(0.2)); rail(LX(0.55), LX(0.85), LY(0.12)); } },
    { z: 1.0, draw: () => {
      RF(0.24, () => cut(rect(-30, ct, W + 60, H - ct + 30, 0), KP.counter, { key: 'ctr2', tear: 0, pat: pat.grainWood('rgba(110,55,20,0.22)'), shadow: false }), { mat: 'wood' });
      eggS(LX(0.15), LY(0.47), 1.2 * u, 'egg1'); eggS(LX(0.24), LY(0.5), 1.2 * u, 'egg2');
      bowlS(LX(0.42), LY(0.5), 1.25 * u);
      const wx = LX(0.42) + Math.cos(a) * 60 * u, wy = LY(0.5) + 10 * u + Math.sin(a) * 14 * u;
      whisk(wx, wy, 1.2 * u, -1.1 + Math.sin(a) * 0.08);
      const hx = wx + Math.cos(-1.1) * 300 * u, hy = wy + Math.sin(-1.1) * 300 * u;
      arm(hx + 220 * u, hy - 120 * u, hx + 20 * u, hy - 10 * u, 1.3 * u, 'aW');
      // the other hand slides in and takes the bottle
      const bx = lerp(LX(0.86), LX(0.74), EZ.io(seg(TT, TIMELINE.cues.grab + 0.4, TIMELINE.cues.grab + 1.4)));
      bottleS(bx, LY(0.66), 1.25 * u);
      arm(LX(1.15), lerp(LY(0.8), LY(0.58), grab), lerp(LX(1.05), bx + 40 * u, grab), LY(0.52), 1.3 * u, 'aB');
    } },
  ], { cam: { x: Math.sin(TT * 0.6) * 18, zoom: 1.02 }, focus: 1.0, aperture: 24, haze: { color: '#e4f0ec', amt: 0.1 } });
  caption('primeiro, os ovos e o azeite...');
}

// ---- 3. Babidi wakes and stretches on the shelf
function sceneShelf() {
  const u = UNIT, cu = TIMELINE.cues;
  const awake = ev(cu.wake, 0.4), pose = EZ.io(seg(TT, cu.stretch, cu.stretch + 0.9)) * (1 - EZ.io(seg(TT, 9.4, 10)) * 0.4);
  const yawn = Math.sin(clamp((TT - cu.stretch - 0.2) / 0.9) * Math.PI);
  planes([
    { z: 1.6, draw: () => { wall(LY(0.9)); } },
    { z: 1.0, draw: () => {
      shelf(LX(-0.05), LY(0.6), LX(1.1), 'shelf3');
      cabinet(LX(-0.05), LY(0.6) + 34, LX(1.1), LY(0.4), 'ucab3');
      RF(0.24, () => { cut(rect(LX(0.08), LY(0.6) - 150 * u, 110 * u, 150 * u, 18 * u), '#e9e4d6', { key: 'jar', mat: 'glass' }); cut(rect(LX(0.07), LY(0.6) - 172 * u, 130 * u, 32 * u, 8 * u), PAL.orange, { key: 'jarlid', h: 0.02, mat: 'metal' }); }, { mat: 'glass' });
      babidiS(LX(0.6), LY(0.6), 2.4 * u, { pose, awake, yawn, h: 0.4 });
    } },
  ], { cam: { x: 0, y: 0, zoom: 1 + (TT - E0) * 0.01 }, focus: 1.0, aperture: 24, haze: { color: '#e4f0ec', amt: 0.1 } });
  caption('a dona da receita.');
}
