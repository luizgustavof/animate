// =====================================================================
//  CAST — Marcella, Babidi and the props of the Receita Felina kitchen, drawn with the cut-paper kit.
//  Heights and materials (relief(), cut { h, mat }) only matter when piece.json has "relight": true;
//  RF() makes them no-ops otherwise, so the same scenes build the "before" and the "after".
// =====================================================================
const RF = (h, fn, o) => (typeof relief === 'function' ? relief(h, fn, o) : fn());
const KP = {
  hair: '#d42a3c', hairD: '#9e1426', skin: '#f2cbb2', skinD: '#d79c86', sweater: '#2c2833', print: '#9c86e0',
  tabby: '#a48d6c', tabbyD: '#6e5a42', tabbyL: '#d9c7a6', eye: '#9bbf4a', oil: '#ecc53a', oilD: '#c99a1c', cap: '#5aa05a',
  cab: '#f4efe6', cabD: '#d9d1c2', wall: '#bfe3d6', tile: '#dcebf0', counter: '#c98a52',
};
const talking = (t, t0, t1) => (t < t0 || t > t1 ? 0 : clamp(Math.abs(Math.sin(t * 7.3)) * (0.45 + 0.55 * Math.abs(Math.sin(t * 2.9 + 1))) * 1.2));

// ---- Marcella: a bust behind the counter. (x, y) = the base of the neck; s = scale
function marcella(x, y, s, o = {}) {
  const t = TT, br = typeof breathe === 'function' ? breathe(t, 3) : { y: 0, s: 0 }, bl = typeof blink === 'function' ? blink(t, 3) : 0;
  const tilt = (o.tilt ?? 0) + Math.sin(t * 1.3) * 0.025, mo = o.mouth ?? 0;
  RF(0.42, () => {
    // hair behind: a mass of curls, it trails the head a beat late
    const sway = Math.sin((t - 0.25) * 1.3) * 6 * s;
    RF(-0.04, () => {
      const R = RNG('mhb');
      for (let i = 0; i < 26; i++) {   // an arc of curls around the head, from one shoulder over the top to the other
        const a = -0.15 + i / 25 * (Math.PI + 0.3), rr = R.r(150, 175) * s;
        curl(x - Math.cos(a) * rr + sway * (i / 25), y - 170 * s - Math.sin(a) * rr * 0.95 + (Math.sin(a) < 0.35 ? 90 * s : 0), R.r(40, 52) * s, 'mhb' + i);
      }
      for (let i = 0; i < 8; i++) { const side = i < 4 ? -1 : 1, k = i % 4; curl(x + side * (150 + R.r(-10, 15)) * s + sway, y - 20 * s + k * 60 * s, R.r(40, 50) * s, 'mhs' + i); }
    }, { mat: 'hair' });
    // the torso: a dark sweater with a purple print, breathing
    ctx.save(); ctx.translate(x, y + br.y * s); ctx.scale(1 + br.s, 1 + br.s); ctx.translate(-x, -y);
    RF(0, () => {
      cut([[x - 175 * s, y + 70 * s], [x - 120 * s, y + 18 * s], [x + 120 * s, y + 18 * s], [x + 175 * s, y + 70 * s], [x + 200 * s, y + 420 * s], [x - 200 * s, y + 420 * s]], KP.sweater, { key: 'mtor', h: 0.02, crayon: '#45404f', crAl: 0.35 });
      for (let i = 0; i < 3; i++) cut(ellipsePts(x - 40 * s + i * 40 * s, y + 250 * s, 18 * s, 34 * s, 0.3 * (i - 1), 14), KP.print, { key: 'mpr' + i, h: 0.03, sb: 3 });
    }, { mat: 'cloth' });
    ctx.restore();
    // neck and head (tilts on the neck)
    RF(0.02, () => cut(rect(x - 34 * s, y - 70 * s, 68 * s, 110 * s, 22 * s), KP.skinD, { key: 'mneck', shadow: false }), { mat: 'skin' });
    ctx.save(); ctx.translate(x, y - 40 * s); ctx.rotate(tilt); ctx.translate(-x, -(y - 40 * s));
    const hx = x, hy = y - 170 * s;
    RF(0.06, () => {
      cut(ellipsePts(hx - 92 * s, hy + 10 * s, 18 * s, 26 * s, 0, 14), KP.skin, { key: 'mel' });
      cut(ellipsePts(hx + 92 * s, hy + 10 * s, 18 * s, 26 * s, 0, 14), KP.skin, { key: 'mer' });
      cut([...ellipsePts(hx, hy, 92 * s, 118 * s, 0, 40, Math.PI, TAU), ...ellipsePts(hx, hy + 30 * s, 92 * s, 100 * s, 0, 40, 0, Math.PI)], KP.skin, { key: 'mhead' });
      cut(ellipsePts(hx + 4 * s, hy + 30 * s, 9 * s, 14 * s, 0, 12), KP.skin, { key: 'mnose', h: 0.03, sb: 3, sy: 3 });
    }, { mat: 'skin' });
    mface(hx, hy, s, bl, mo, o.look ?? [0, 0]);
    // bangs and the front curls, over the forehead
    RF(0.12, () => {
      const R = RNG('mhf');
      for (let i = 0; i < 7; i++) curl(hx - 85 * s + i * 28 * s, hy - 100 * s + Math.sin(i * 1.7) * 10 * s, R.r(30, 38) * s, 'mbg' + i);
      for (let i = 0; i < 5; i++) curl(hx - 120 * s + R.n(8) * s, hy - 40 * s + i * 50 * s, R.r(30, 36) * s, 'mfl' + i);
      for (let i = 0; i < 5; i++) curl(hx + 120 * s + R.n(8) * s, hy - 40 * s + i * 50 * s, R.r(30, 36) * s, 'mfr' + i);
    }, { mat: 'hair' });
    ctx.restore();
  });
}
function curl(x, y, r, key) {
  cut(ellipsePts(x, y, r, r * 0.92, 0, 18), KP.hair, { key, crayon: KP.hairD, crAl: 0.45, crPer: 26, sb: 5, sy: 4, tear: 0.6, grain: 0.5 });
  ink(arcPts(x + r * 0.05, y + r * 0.05, r * 0.5, 0.3, 4.6, 10), { w: 2.4 * r / 36, color: 'rgba(110,10,25,0.55)', amt: 0.3, key: key + 'c' });
}
function mface(x, y, s, bl, mo, look) {
  const I = PAL.ink;
  for (const side of [-1, 1]) {
    const ex = x + side * 38 * s, ey = y + 2 * s;
    if (bl > 0.6) ink([[ex - 13 * s, ey + 2 * s], [ex + 13 * s, ey + 2 * s]], { w: 3.4 * s, color: I, amt: 0.2, key: 'mbl' + side });
    else {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, ey, 15 * s, 11 * s * (1 - bl), 0, 0, TAU); ctx.fill();
      dot(ex + look[0] * 5 * s, ey + look[1] * 3 * s, 7 * s, '#3b2a22'); dot(ex + look[0] * 5 * s + 2.5 * s, ey - 2.5 * s, 2.2 * s, '#fff');
    }
    ink([[ex - 18 * s, ey - 26 * s], [ex, ey - 31 * s], [ex + 16 * s, ey - 27 * s]], { w: 4.4 * s, color: KP.hairD, amt: 0.2, key: 'mbrow' + side });
    ctx.strokeStyle = '#6a6470'; ctx.lineWidth = 4.5 * s; ctx.beginPath(); ctx.arc(ex, ey, 27 * s, 0, TAU); ctx.stroke();
  }
  ctx.strokeStyle = '#6a6470'; ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.moveTo(x - 11 * s, y); ctx.quadraticCurveTo(x, y - 8 * s, x + 11 * s, y); ctx.stroke();
  ctx.fillStyle = 'rgba(232,120,120,0.28)'; ctx.beginPath(); ctx.ellipse(x - 52 * s, y + 42 * s, 15 * s, 9 * s, 0, 0, TAU); ctx.ellipse(x + 52 * s, y + 42 * s, 15 * s, 9 * s, 0, 0, TAU); ctx.fill();
  const my = y + 70 * s;
  if (mo > 0.08) { ctx.fillStyle = '#5a1e22'; ctx.beginPath(); ctx.ellipse(x, my, 15 * s, 4 * s + 13 * s * mo, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#e07f86'; ctx.beginPath(); ctx.ellipse(x, my + 6 * s * mo, 8 * s, 3 * s * mo, 0, 0, TAU); ctx.fill(); }
  else ink(arcPts(x, my - 10 * s, 14 * s, Math.PI * 0.25, Math.PI * 0.75, 8), { w: 3.4 * s, color: '#8a3a3a', amt: 0.2, key: 'msm' });
}
// a forearm and hand resting on (or reaching across) the counter: elbow (ex, ey) to wrist (wx, wy)
function arm(ex, ey, wx, wy, s, key, o = {}) {
  RF(0.5, () => {
    RF(0, () => cut(capsulePts(ex, ey, wx, wy, 74 * s, 8), KP.sweater, { key: key + 's', crayon: '#45404f', crAl: 0.35 }), { mat: 'cloth' });
    const a = Math.atan2(wy - wy + (o.down ?? 0.25), wx - ex >= 0 ? 1 : -1), dir = Math.sign(wx - ex) || 1;
    RF(0.04, () => {
      const hx = wx + dir * 34 * s, hy = wy + 6 * s;
      cut(ellipsePts(hx, hy, 42 * s, 28 * s, a * 0.2, 20), KP.skin, { key: key + 'h' });
      for (let i = 0; i < 4; i++) cut(capsulePts(hx + dir * 22 * s, hy - 14 * s + i * 10 * s, hx + dir * (52 + (i === 0 || i === 3 ? -4 : 2)) * s, hy - 12 * s + i * 11 * s, 15 * s, 6), KP.skin, { key: key + 'f' + i, sb: 3, sy: 3, h: 0.02 });
      cut(capsulePts(hx - dir * 6 * s, hy - 22 * s, hx + dir * 20 * s, hy - 34 * s, 17 * s, 6), KP.skin, { key: key + 'th', sb: 3, h: 0.03 });
    }, { mat: 'skin' });
  });
}

// ---- Babidi: a tabby. pose 0 = a loaf asleep, 1 = stretched, awake. (x, y) = the belly on the surface; s = scale
function babidi(x, y, s, o = {}) {
  const p = clamp(o.pose ?? 0), awake = clamp(o.awake ?? 0), t = TT;
  const bl = typeof blink === 'function' ? blink(t, 7) : 0;
  RF(o.h ?? 0.4, () => {
    const len = lerp(105, 150, p) * s, hgt = lerp(52, 40, p) * s, bx = x + lerp(0, 20, p) * s;
    // tail: hangs over the edge, swings late (secondary motion)
    const sw = (u) => Math.sin(u * 1.6) * 0.25 + Math.sin(u * 0.7) * 0.15;
    const tail = []; let tx = bx + len * 0.85, ty = y - 6 * s, ta = Math.PI * 0.42;
    for (let i = 0; i < 9; i++) { tail.push([tx, ty]); ta += sw(t - i * 0.08) * 0.18; tx += Math.cos(ta) * 20 * s; ty += Math.sin(ta) * 20 * s; }
    RF(-0.04, () => tail.forEach((q, i) => i && cut(capsulePts(tail[i - 1][0], tail[i - 1][1], q[0], q[1], lerp(34, 24, i / 8) * s, 6), i % 2 ? KP.tabbyD : KP.tabby, { key: 'btl' + i, shadow: false, grain: 0.5 })), { mat: 'fur' });
    // body
    cut(ellipsePts(bx, y - hgt, len, hgt, 0, 36), KP.tabby, { key: 'bbody', crayon: KP.tabbyD, crAl: 0.5, crPer: 22, crLen: 16, crA: 1.2, pat: pat.stripes('rgba(90,70,48,0.45)', 12 * s, 38 * s, 0.25) });
    cut(ellipsePts(bx - len * 0.25, y - hgt * 0.55, len * 0.55, hgt * 0.5, 0, 24), KP.tabbyL, { key: 'bbelly', h: 0.02, shadow: false, grain: 0.6 });
    // front paws: tucked in the loaf, reaching forward in the stretch
    const pr = lerp(0, 70, p) * s;
    for (let i = 0; i < 2; i++) cut(capsulePts(bx - len * 0.7, y - 18 * s - i * 4 * s, bx - len * 0.82 - pr - i * 14 * s, y - 14 * s - i * 6 * s, 30 * s, 6), i ? KP.tabbyL : '#e8dcc4', { key: 'bpaw' + i, h: 0.03 + i * 0.01, sb: 4 });
    // head: lifts and turns up as she wakes
    const hx = bx - len * 0.9 - lerp(0, 30, p) * s, hy = y - hgt * lerp(1.2, 1.9, awake) - Math.sin(t * 1.1) * 2 * s;
    babidiHead(hx, hy, s * 1.0, { eyes: awake * (1 - bl), yawn: o.yawn ?? 0 });
  }, { mat: 'fur' });
}
function babidiHead(x, y, s, o = {}) {
  RF(0.08, () => {
    for (const side of [-1, 1]) {
      cut([[x + side * 26 * s, y - 34 * s], [x + side * 54 * s, y - 84 * s], [x + side * 64 * s, y - 20 * s]], KP.tabby, { key: 'bear' + side, sb: 4 });
      cut([[x + side * 34 * s, y - 34 * s], [x + side * 52 * s, y - 70 * s], [x + side * 56 * s, y - 30 * s]], '#e6b3a8', { key: 'beari' + side, shadow: false, h: 0.01, grain: 0.4 });
    }
    cut(ellipsePts(x, y, 72 * s, 58 * s, 0, 32), KP.tabby, { key: 'bhead', crayon: KP.tabbyD, crAl: 0.45, crPer: 20, crLen: 12, crA: 1.4,
      pat: (bb) => { for (let i = 0; i < 3; i++) ink([[x - 18 * s + i * 18 * s, y - 56 * s], [x - 12 * s + i * 12 * s, y - 30 * s]], { w: 6 * s, color: 'rgba(90,70,48,0.6)', amt: 0.3, key: 'bfs' + i }); } });
    cut(ellipsePts(x, y + 22 * s, 34 * s, 22 * s, 0, 20), KP.tabbyL, { key: 'bmuz', h: 0.03, shadow: false });
  }, { mat: 'fur' });
  // eyes: lines asleep, green almonds with slit pupils awake
  for (const side of [-1, 1]) {
    const ex = x + side * 28 * s, ey = y - 6 * s, op = clamp(o.eyes ?? 0);
    if (op < 0.15) ink(arcPts(ex, ey - 4 * s, 12 * s, 0.25, Math.PI - 0.25, 8), { w: 3.6 * s, color: '#3a2c20', amt: 0.2, key: 'bes' + side });
    else {
      ctx.fillStyle = KP.eye; ctx.beginPath(); ctx.ellipse(ex, ey, 15 * s, 12 * s * op, side * 0.15, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1e1a14'; ctx.beginPath(); ctx.ellipse(ex, ey, 3.5 * s, 10 * s * op, 0, 0, TAU); ctx.fill();
      dot(ex + 4 * s, ey - 4 * s * op, 2.4 * s, '#fff');
      ctx.strokeStyle = '#3a2c20'; ctx.lineWidth = 2.6 * s; ctx.beginPath(); ctx.ellipse(ex, ey, 15 * s, 12 * s * op, side * 0.15, 0, TAU); ctx.stroke();
    }
  }
  cut([[x - 8 * s, y + 12 * s], [x + 8 * s, y + 12 * s], [x, y + 21 * s]], '#d98a8a', { key: 'bnose', shadow: false, h: 0.05, grain: false });
  if ((o.yawn ?? 0) > 0.05) { ctx.fillStyle = '#7a2e34'; ctx.beginPath(); ctx.ellipse(x, y + 34 * s, 12 * s, 14 * s * o.yawn, 0, 0, TAU); ctx.fill(); }
  else ink([[x - 12 * s, y + 30 * s], [x, y + 24 * s], [x + 12 * s, y + 30 * s]], { w: 2.6 * s, color: '#3a2c20', amt: 0.2, key: 'bmouth' });
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) ink([[x + side * 30 * s, y + 22 * s + i * 6 * s], [x + side * 92 * s, y + 10 * s + i * 14 * s]], { w: 1.8 * s, color: 'rgba(255,255,255,0.85)', amt: 0.4, key: 'bwh' + side + i });
}

// ---- props
function bottle(x, y, s, key = 'btl') {   // (x, y) = the base centre
  RF(0.55, () => {
    const body = [...rrectPts(x - 62 * s, y - 330 * s, 124 * s, 330 * s, 26 * s)];
    cut(body, KP.oil, { key: key + 'b', mat: 'glass', crayon: KP.oilD, crAl: 0.3, pat: (bb) => { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - 44 * s, y - 310 * s, 14 * s, 280 * s); } });
    cut([[x - 62 * s, y - 330 * s], [x - 26 * s, y - 400 * s], [x + 26 * s, y - 400 * s], [x + 62 * s, y - 330 * s]], KP.oil, { key: key + 'sh', mat: 'glass', shadow: false });
    cut(rect(x - 30 * s, y - 470 * s, 60 * s, 76 * s, 10 * s), KP.cap, { key: key + 'c', mat: 'ceramic', h: 0.02 });
    cut(rect(x - 56 * s, y - 220 * s, 112 * s, 110 * s, 6 * s), '#f6f1e2', { key: key + 'l', mat: 'paper', h: 0.02, shadow: false });
    ink([[x - 36 * s, y - 180 * s], [x + 36 * s, y - 180 * s]], { w: 6 * s, color: PAL.greenD, amt: 0.4, key: key + 'lt' });
    ink([[x - 30 * s, y - 150 * s], [x + 24 * s, y - 150 * s]], { w: 4 * s, color: PAL.greenD, amt: 0.4, key: key + 'lt2' });
  }, { mat: 'glass' });
}
function bowl(x, y, s, key = 'bowl') {   // (x, y) = the rim centre
  RF(0.3, () => {
    cut([[x - 200 * s, y], [x + 200 * s, y], [x + 150 * s, y + 140 * s], [x + 60 * s, y + 165 * s], [x - 60 * s, y + 165 * s], [x - 150 * s, y + 140 * s]], '#f2ead8', { key: key + 'b', mat: 'ceramic', pat: pat.stripes('rgba(80,140,170,0.45)', 14 * s, 1000, 0) });
    cut(ellipsePts(x, y, 196 * s, 36 * s, 0, 36), '#e9d9a8', { key: key + 'in', shadow: false, mat: 'liquid', h: -0.02 });
  }, { mat: 'ceramic' });
}
function whisk(x, y, s, a, key = 'wh') {   // (x, y) = where the wires meet the batter; a = handle angle
  RF(0.42, () => {
    const hx = x + Math.cos(a) * 260 * s, hy = y + Math.sin(a) * 260 * s;
    for (let i = -2; i <= 2; i++) ink([[x + i * 16 * s, y + 6 * s], [x + i * 22 * s + Math.cos(a) * 110 * s, y + Math.sin(a) * 110 * s - Math.abs(i) * 4 * s], [x + Math.cos(a) * 160 * s, y + Math.sin(a) * 160 * s]], { w: 3.4 * s, color: '#9aa3ad', amt: 0.3, key: key + 'w' + i });
    cut(capsulePts(x + Math.cos(a) * 160 * s, y + Math.sin(a) * 160 * s, hx, hy, 30 * s, 6), '#b0b8c2', { key: key + 'h', mat: 'metal' });
  }, { mat: 'metal' });
}
function egg(x, y, s, key) { RF(0.3, () => cut(ellipsePts(x, y, 34 * s, 42 * s, 0.4, 24), '#f4e6cf', { key, mat: 'ceramic' }), { mat: 'ceramic' }); }
