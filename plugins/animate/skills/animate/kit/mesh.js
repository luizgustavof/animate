// =====================================================================
//  kit/mesh.js — painted art that bends: draw an image through a deformed grid (the trick Spine and Live2D use for
//  "mesh" attachments), in plain canvas 2D. A character's parts can be painted pictures (a lock of hair, a sleeve, an
//  arm) that bend with the rig (kit ik2, follow / jiggle springs) instead of shapes drawn in code.
//
//  meshImage(img, src, map, o)
//    img   an Image / canvas (the painted part, transparent around it)
//    src   [sx, sy, sw, sh] the part of img to use (default: all of it)
//    map   (u, v) -> [x, y]: where the texture point (u, v) (0..1 across, 0..1 down the src rect) lands, in the
//          current coordinates. The identity map is (u, v) => [x0 + u * w, y0 + v * h].
//    o     cols (6), rows (16): grid density along u / v — more rows for long bending things (hair, tails, cloth)
//  Each grid cell is two triangles; each triangle is clipped and drawn with the affine transform that takes its source
//  triangle to its place, grown by half a pixel so no seams show between them. Deterministic: map is a pure function.
//
//  hangMap(x0, y0, w, h, sway)  a map for something hanging from its top edge (hair, a curtain, a dish towel):
//    row v is pushed sideways by sway(v) -> [dx, dy] (0 at the root, growing toward the tip; see kit lockSway)
// =====================================================================
function meshImage(img, src, map, o = {}) {
  const [sx, sy, sw, sh] = src || [0, 0, img.width, img.height];
  const cols = o.cols ?? 6, rows = o.rows ?? 16, P = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) P.push(map(i / cols, j / rows));
  const at = (i, j) => P[j * (cols + 1) + i], S = (i, j) => [sx + sw * i / cols, sy + sh * j / rows];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    tri(img, S(i, j), S(i + 1, j), S(i, j + 1), at(i, j), at(i + 1, j), at(i, j + 1));
    tri(img, S(i + 1, j), S(i + 1, j + 1), S(i, j + 1), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  }
}
// one textured triangle: source (s0, s1, s2) -> destination (d0, d1, d2)
function tri(img, s0, s1, s2, d0, d1, d2) {
  // grow the destination triangle by ~0.6 px around its centre (hides the hairline seams of antialiased clips)
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.6, p[1] + dy / l * 0.6]; };
  const [e0, e1, e2] = [grow(d0), grow(d1), grow(d2)];
  // affine M with M * s = d for the three corners
  const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2, den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(den) < 1e-9) return;
  const a = ((d1[0] - d0[0]) * (y2 - y0) - (d2[0] - d0[0]) * (y1 - y0)) / den;
  const c = ((d2[0] - d0[0]) * (x1 - x0) - (d1[0] - d0[0]) * (x2 - x0)) / den;
  const b = ((d1[1] - d0[1]) * (y2 - y0) - (d2[1] - d0[1]) * (y1 - y0)) / den;
  const d = ((d2[1] - d0[1]) * (x1 - x0) - (d1[1] - d0[1]) * (x2 - x0)) / den;
  const e = d0[0] - a * x0 - c * y0, f = d0[1] - b * x0 - d * y0;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.lineTo(e2[0], e2[1]); ctx.closePath(); ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
function hangMap(x0, y0, w, h, sway) {
  return (u, v) => { const [dx, dy] = sway(v); return [x0 + u * w + dx, y0 + v * h + dy]; };
}
