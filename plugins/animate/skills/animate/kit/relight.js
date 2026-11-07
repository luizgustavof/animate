// =====================================================================
//  kit/relight.js — opt-in volume from light: 2.5D relighting with normals made from the shapes themselves
//  (piece.json "relight": true adds this file and marks the piece TIMELINE.gpu).
//
//  Flat cutouts get volume without being redrawn. While a scene draws, every cut() also paints its outline into two
//  hidden buffers the same size as the canvas it draws on:
//    height    how high the paper sits (0 = the back wall). Blurred at three scales it becomes a soft relief: small
//              shapes (an eye, a finger, a curl) turn into domes, big ones (a wall, the counter top) stay flat and only
//              round off at their edges. Its slope is the surface normal.
//    material  how the surface answers light: gloss (R), skin (G: light bleeds red past the terminator), sheen (B:
//              cloth and fur brighten at grazing angles).
//  Then one WebGL pass shades the canvas: a key light and a fill (wrap diffuse, divided by what a flat sheet would
//  get, so flat paper keeps its colour and only the forms change), a specular that only curved glossy parts catch,
//  sheen, an optional rim light, and contact shadows (ambient occlusion) where a higher shape stands over a lower one.
//
//  In the piece:
//    relief(h, () => { ...draw... }, { mat: 'skin' })   draw a group at height h (0..1; wall 0, counter ~0.2,
//                                                        a person ~0.45); mat is the group's default material
//    cut(P, fill, { h: 0.06, mat: 'glass' })            per cut: h above the group's height, its own material
//    relief group heights stack: a relief() inside another adds to it.
//  The light comes from the era's pieceLight() rig (kit/light.js), optional keys:
//    key:  { dir: [x, y, z], color: [r, g, b], power }   direction TO the light, screen space (y down, z toward us)
//    fill: { dir, color, power }                          a second, softer light (bounce from the counter, a window)
//    rim:  { dir: [x, y], color, power }                  an edge light from behind, on the edges facing dir
//    relight: { depth, ao, strength, spec }               tuning (defaults below)
//  Without a key the light comes from where the rig's cast shadow points away from (or the top left).
//  Works with kit/planes.js: each plane is relit on its own before the lens blurs it.
//  Materials: paper (default), skin, hair, cloth, fur, wood, ceramic, glass, metal, liquid.
//  Deterministic: a function of what was drawn and the rig.
// =====================================================================
const RELIGHT_MAT = {
  paper: [0.0, 0, 0.0], skin: [0.22, 1, 0.1], hair: [0.5, 0, 0.55], cloth: [0.04, 0, 0.45], fur: [0.12, 0, 0.8],
  wood: [0.3, 0, 0.05], ceramic: [0.75, 0, 0.0], glass: [1.0, 0, 0.0], metal: [0.9, 0, 0.0], liquid: [0.85, 0, 0.0],
};
const RELIGHT_DEF = { depth: 1.0, ao: 0.45, strength: 1.0, spec: 1.0 };
let RLT = null;                       // the buffers the scene is drawing into right now (null = not relighting)
const RL_POOL = new Map();            // canvas -> its { hc, mc } buffers
let RL_BASE = 0, RL_MAT = 'paper';    // the current relief group

function relightBegin(canvas) {
  let b = RL_POOL.get(canvas);
  const w = canvas.width, h = canvas.height;
  if (!b || b.hc.width !== w || b.hc.height !== h) {
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    b = { hc: mk(), mc: mk() }; RL_POOL.set(canvas, b);
  }
  for (const c of [b.hc, b.mc]) { const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
  const prev = { RLT, RL_BASE, RL_MAT };
  RLT = { ...b, n: 0, canvas }; RL_BASE = 0; RL_MAT = 'paper';
  return prev;
}
function relightEnd(canvas, prev) {
  const T = RLT;
  RLT = prev ? prev.RLT : null; RL_BASE = prev ? prev.RL_BASE : 0; RL_MAT = prev ? prev.RL_MAT : 'paper';
  if (!T || !T.n) return;             // nothing was marked (all drawn in planes): leave the canvas as it is
  relightPass(canvas, T.hc, T.mc);
}
function relief(h, fn, o = {}) {
  const kb = RL_BASE, km = RL_MAT;
  RL_BASE = kb + h; if (o.mat) RL_MAT = o.mat;
  try { return fn(); } finally { RL_BASE = kb; RL_MAT = km; }
}
// called by cut() (styles/cut-paper/kit.js) with the outline it just filled
function relightMark(Q, fill, o = {}) {
  if (!RLT || (typeof LIGHT_SIL !== 'undefined' && LIGHT_SIL) || o.h === null) return;
  if (typeof fill === 'string') { const m = fill.match(/rgba\([^)]*,\s*([\d.]+)\s*\)$/); if (m && +m[1] < 0.2) return; }   // holes and veils
  const hv = clamp(RL_BASE + (o.h ?? 0)), mat = RELIGHT_MAT[o.mat || RL_MAT] || RELIGHT_MAT.paper, m = ctx.getTransform(), keep = ctx;
  RLT.n++;
  for (const [c, col] of [[RLT.hc, `rgb(${Math.round(hv * 255)},0,0)`], [RLT.mc, `rgb(${Math.round(mat[0] * 255)},${Math.round(mat[1] * 255)},${Math.round(mat[2] * 255)})`]]) {
    ctx = c.getContext('2d'); ctx.setTransform(m); ctx.fillStyle = col;
    try { trace(Q, true); ctx.fill(); } finally { ctx = keep; }
  }
}

const RLGL = (() => {
  let cv = null, gl = null, quad = null, warned = false, fmt = null;
  const progs = {}, targets = {}, texs = {};
  const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  function init() {
    if (gl) return true;
    cv = document.createElement('canvas');
    gl = cv.getContext('webgl2', { antialias: false, alpha: true, depth: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) { if (!warned) console.warn('relight: no WebGL2, shapes stay flat'); warned = true; return false; }
    fmt = gl.getExtension('EXT_color_buffer_float') ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    return true;
  }
  const params = () => { for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); };
  function compile(key, fs) {
    if (progs[key]) return progs[key];
    const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(`relight shader "${key}": ${gl.getShaderInfoLog(o)}`); return o; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`relight link "${key}": ${gl.getProgramInfoLog(p)}`);
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    return (progs[key] = { p, u });
  }
  function target(name, w, h) {
    let t = targets[name];
    if (t && t.w === w && t.h === h) return t;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt[0], w, h, 0, gl.RGBA, fmt[1], null); params();
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return (targets[name] = { tex, fb, w, h });
  }
  function upload(name, canvas) {
    if (!texs[name]) { texs[name] = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texs[name]); params(); }
    gl.bindTexture(gl.TEXTURE_2D, texs[name]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return texs[name];
  }
  function draw(prog, out, set) {
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
    gl.viewport(0, 0, out ? out.w : cv.width, out ? out.h : cv.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    let unit = 0;
    for (const [k, v] of Object.entries(set)) {
      const loc = prog.u[k]; if (loc == null) continue;
      if (v && (v.tex || v instanceof WebGLTexture)) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.tex || v); gl.uniform1i(loc, unit++); }
      else if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2fv(loc, v); else if (v.length === 3) gl.uniform3fv(loc, v); else gl.uniform4fv(loc, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function size(w, h) { if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } }
  return { init, compile, target, upload, draw, size, get cv() { return cv; } };
})();

const RELIGHT_GLSL = {
  // a separable gaussian (17 taps, sigma = uSig texels along uDir), on the height's red channel
  blur: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uDir; uniform float uSig;
void main() { float s = 0.0, wsum = 0.0; for (int i = -8; i <= 8; i++) { float x = float(i) / 8.0 * 2.5; float w = exp(-0.5 * x * x);
  s += texture(uSrc, vUv + uDir * float(i) / 8.0 * 2.5 * uSig).r * w; wsum += w; } o = vec4(s / wsum, 0.0, 0.0, 1.0); }`,
  shade: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uCol, uHt, uMat, uB1, uB2, uB3; uniform vec2 uPx;
uniform vec3 uKeyDir, uKeyCol, uFillDir, uFillCol; uniform vec2 uRimDir; uniform vec3 uRimCol;
uniform float uDepth, uAO, uStrength, uSpec;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float relief(vec2 p) { return 0.25 * texture(uB1, p).r + 0.35 * texture(uB2, p).r + 0.4 * texture(uB3, p).r; }
float wrapD(vec3 n, vec3 l) { return max(0.0, (dot(n, l) + 0.35) / 1.35); }
void main() {
  vec4 src = texture(uCol, vUv);
  vec3 col = toLin(src.rgb), mat = texture(uMat, vUv).rgb;
  float h0 = texture(uHt, vUv).r;
  vec2 e = uPx * 2.0;
  float dx = relief(vUv + vec2(e.x, 0.0)) - relief(vUv - vec2(e.x, 0.0));
  float dy = relief(vUv + vec2(0.0, e.y)) - relief(vUv - vec2(0.0, e.y));
  vec3 n = normalize(vec3(-dx * uDepth * 60.0, -dy * uDepth * 60.0, 1.0));     // gl space: y up
  vec3 nf = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(uKeyDir), Lf = normalize(uFillDir);
  float k = wrapD(n, L) / max(wrapD(nf, L), 1e-3), f = wrapD(n, Lf) / max(wrapD(nf, Lf), 1e-3);
  float kw = dot(uKeyCol, vec3(0.333)), fw = dot(uFillCol, vec3(0.333));
  vec3 lit = (uKeyCol * k + uFillCol * f) / max(kw + fw, 1e-3);
  lit = mix(vec3(1.0), lit, uStrength);
  // skin: light bleeds red past the terminator
  vec3 sss = pow(clamp(lit, 0.0, 4.0), vec3(0.55, 0.92, 1.05));
  lit = mix(lit, sss, mat.g);
  // contact shadow: a higher neighbourhood darkens the lower surface
  float ao = 1.0 - uAO * smoothstep(0.0, 0.22, texture(uB3, vUv).r - h0) - uAO * 0.5 * smoothstep(0.0, 0.12, texture(uB1, vUv).r - h0);
  vec3 c = col * lit * clamp(ao, 0.0, 1.0);
  // specular, only where the surface curves (a flat glossy sheet shows none)
  vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float pw = mix(6.0, 90.0, mat.r);
  float sp = max(0.0, pow(max(dot(n, hv), 0.0), pw) - pow(max(hv.z, 0.0), pw));
  c += uKeyCol * sp * mat.r * mat.r * 1.6 * uSpec;
  // sheen: cloth and fur pick up the light at grazing angles on the lit side
  float graze = pow(1.0 - n.z, 1.5) * max(0.0, dot(normalize(n.xy + 1e-5), normalize(L.xy + 1e-5)));
  c += uKeyCol * col * graze * mat.b * 0.9;
  // rim: an edge light from behind
  float rim = pow(1.0 - n.z, 2.0) * max(0.0, dot(normalize(n.xy + 1e-5), normalize(uRimDir + 1e-5)));
  c += uRimCol * rim * step(0.003, h0);
  o = vec4(toSrgb(max(c, 0.0)), src.a);
}`,
};

function relightPass(canvas, hc, mc) {
  if (!RLGL.init()) return;
  const R = (typeof LIGHT_RIG !== 'undefined' && LIGHT_RIG) || {}, P = { ...RELIGHT_DEF, ...(R.relight || {}) };
  const w = canvas.width, h = canvas.height, px = w / W;
  RLGL.size(w, h);
  const C = (k) => RLGL.compile(k, RELIGHT_GLSL[k]);
  const col = RLGL.upload('col', canvas), ht = RLGL.upload('ht', hc), mt = RLGL.upload('mat', mc);
  // the relief at three scales, at half resolution (sigmas in 1080-wide pixels)
  const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), sc = px / 2;
  const blurTo = (name, src, sig) => {
    const a = RLGL.target(name + 'x', hw, hh), b = RLGL.target(name, hw, hh);
    RLGL.draw(C('blur'), a, { uSrc: src, uDir: [1 / hw, 0], uSig: sig * sc });
    RLGL.draw(C('blur'), b, { uSrc: a, uDir: [0, 1 / hh], uSig: sig * sc });
    return b;
  };
  const b1 = blurTo('b1', ht, 4), b2 = blurTo('b2', b1, 14), b3 = blurTo('b3', b2, 38);
  // the light: screen space (y down) -> gl space (y up)
  let kd = R.key && R.key.dir;
  if (!kd) { const s = R.shadow; kd = s ? [-(s.dx ?? 34), -(s.dy ?? 18), 60] : [-0.6, -0.8, 0.9]; }
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const kdn = norm(kd), fd = norm((R.fill && R.fill.dir) || [-kdn[0], 0.2, 1]);
  const kc = ((R.key && R.key.color) || [1, 0.97, 0.92]).map((v) => v * ((R.key && R.key.power) ?? 1));
  const fc = ((R.fill && R.fill.color) || [0.85, 0.9, 1]).map((v) => v * ((R.fill && R.fill.power) ?? 0.45));
  const rd = (R.rim && R.rim.dir) || [kdn[0] * -1, kdn[1] * -1], rc = ((R.rim && R.rim.color) || [1, 1, 1]).map((v) => v * ((R.rim && R.rim.power) ?? 0));
  RLGL.draw(C('shade'), null, {
    uCol: col, uHt: ht, uMat: mt, uB1: b1, uB2: b2, uB3: b3, uPx: [1 / w, 1 / h],
    uKeyDir: [kdn[0], -kdn[1], kdn[2]], uKeyCol: kc, uFillDir: [fd[0], -fd[1], fd[2]], uFillCol: fc,
    uRimDir: [rd[0], -rd[1]], uRimCol: rc,
    uDepth: P.depth * px, uAO: P.ao, uStrength: P.strength, uSpec: P.spec,
  });
  const g = canvas.getContext('2d');
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'copy'; g.filter = 'none';
  g.drawImage(RLGL.cv, 0, 0); g.restore();
}
