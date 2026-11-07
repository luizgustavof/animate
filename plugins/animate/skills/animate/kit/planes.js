// =====================================================================
//  kit/planes.js — opt-in multiplane camera: depth without 3D (piece.json "planes": true adds this file).
//
//  Inside a scene, draw the shot as planes at depths instead of straight onto the era:
//    planes([
//      { z: 1.8, draw: () => { wall(...); cabinet(...); } },   // far: moves least, blurs when the focus is near
//      { z: 1.0, draw: () => marcella(...) },                  // the subject (z 1 = world coords as drawn)
//      { z: 0.8, draw: () => counter(1300) },                  // near
//      { z: 0.4, draw: () => bottle(...) },                    // a foreground object the lens looks past
//    ], { cam: { x, y, zoom, rot }, focus: 1.0, aperture: 26, haze: { color: '#cfe0ff', amt: 0.15 } })
//  cam      the camera's move in world units: a plane at depth z moves by cam.x / z (parallax), a dolly (zoom > 1)
//           grows near planes more than far ones, rot (radians) tilts near planes more. Pivot: the frame's centre.
//  focus    the depth in focus; animate it for a focus pull (focusPull below).
//  aperture blur in px at 1080 wide per unit of |1/z - 1/focus| (0 = everything sharp). ~20–30 reads as a big-sensor lens.
//  haze     far planes fade toward a colour by amt * (1 - 1/z): air between us and the back wall.
//  Planes are drawn far to near, each into its own canvas, then blurred and laid over the era. Captions and tags
//  pushed to DEFER still draw later at full resolution, unmoved. Cast shadows (kit/light.js shadowed) drawn inside a
//  plane land as a soft dark shape on the planes behind it. Deterministic: a function of the arguments only.
// =====================================================================
const PLANE_CV = [];
function planeCanvas(i, w, h) {
  let c = PLANE_CV[i];
  if (!c || c.width !== w || c.height !== h) { c = document.createElement('canvas'); c.width = w; c.height = h; PLANE_CV[i] = c; }
  return c;
}
// a focus pull: from depth a to depth b over [t0, t0 + d] (eased)
const focusPull = (t, t0, d, a, b) => lerp(a, b, EZ.io(seg(t, t0, t0 + d)));
function planes(list, o = {}) {
  const g = ctx, base = g.getTransform(), cv = g.canvas, w = cv.width, h = cv.height, px = w / W;
  const cam = { x: 0, y: 0, zoom: 1, rot: 0, ...(o.cam || {}) }, focus = o.focus ?? 1, ap = o.aperture ?? 0;
  const order = list.map((p, i) => [p, i]).sort((a, b) => b[0].z - a[0].z);
  order.forEach(([P, i], n) => {
    const pc = planeCanvas(n, w, h), pg = pc.getContext('2d'), k = 1 / P.z, s = 1 + (cam.zoom - 1) * k;
    pg.setTransform(1, 0, 0, 1, 0, 0); pg.globalAlpha = 1; pg.globalCompositeOperation = 'source-over'; pg.filter = 'none'; pg.setLineDash([]);
    pg.clearRect(0, 0, w, h);
    pg.setTransform(base);
    pg.translate(W / 2, H / 2); if (cam.rot) pg.rotate(cam.rot * k); pg.scale(s, s); pg.translate(-W / 2 - cam.x * k, -H / 2 - cam.y * k);
    const keep = ctx; ctx = pg;
    const rl = typeof relightBegin === 'function' ? relightBegin(pc) : undefined;   // kit/relight.js: each plane is relit on its own
    try { P.draw(); } finally { ctx = keep; if (rl !== undefined) relightEnd(pc, rl); }
    // air: far planes take on the haze colour (only where the plane has paint)
    if (o.haze && P.z > 1) {
      const a = (o.haze.amt ?? 0.15) * (1 - k);
      pg.save(); pg.setTransform(1, 0, 0, 1, 0, 0); pg.globalCompositeOperation = 'source-atop'; pg.globalAlpha = clamp(a); pg.fillStyle = o.haze.color || '#d8e4f0'; pg.fillRect(0, 0, w, h); pg.restore();
    }
    const blur = (P.blur ?? ap * Math.abs(k - 1 / focus)) * px;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = P.alpha ?? 1; g.globalCompositeOperation = 'source-over';
    g.filter = blur > 0.35 ? `blur(${blur.toFixed(2)}px)` : 'none';
    g.drawImage(pc, 0, 0); g.restore();
  });
}
