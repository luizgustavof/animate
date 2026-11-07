// =====================================================================
//  kit/look.js — an opt-in cinematic finish over the finished 2D frame (WebGL2 on the GPU).
//
//  piece.json  "look": "film" | "warm-night" | "soft-day" | { preset?: "film", ...params }
//  tools/build.mjs injects `const LOOK = {...}` and this file only when the piece asks for a look, and marks the
//  piece TIMELINE.gpu so export / review / still run it on the real GPU. Pieces without "look" never see this file.
//
//  The chain (after STYLE.post, so a style's own finish stays under it):
//    sRGB frame -> linear, highlights lifted into HDR (so bright things can glow)
//    -> bloom: bright pass, a 6-level down/up pyramid, plus halation (a red-shifted wide glow, like film)
//    -> lens: chromatic aberration toward the edges, vignette
//    -> tone: a blend of identity and ACES (tone 0..1), exposure
//    -> grade: temperature / tint, lift / gamma / gain, contrast (S-curve), saturation, haze (lifted blacks)
//    -> grain in cells, seeded by the frame F (deterministic: the same frame is always the same picture)
//  A piece can vary it over time: function lookAt(t) { return { exposure: ..., bloom: ... } } (merged over LOOK).
//  Params: exposure, bloom, thresh, halation, haze, vig, ca, tone, contrast, sat, temp, tint,
//          lift [r,g,b], gamma [r,g,b], gain [r,g,b], grain, grainCell
// =====================================================================
const LOOK_PRESETS = {
  // hot: how far near-white pixels are pushed into HDR (0 = none). Light grounds (paper, a day kitchen) want hot 0 and a
  // high thresh, or the whole page glows and dark text on it washes out; dark scenes want hot ~1 so lamps and eyes glow.
  film:         { exposure: 1.0, hot: 0.6, bloom: 0.22, thresh: 0.8, halation: 0.12, haze: 0.0, vig: 0.3, ca: 0.003, tone: 0.5, contrast: 0.08, sat: 1.04, temp: 0.02, tint: 0.0, lift: [0.01, 0.008, 0.014], gamma: [1, 1, 1], gain: [1, 1, 1], grain: 0.028, grainCell: 1.6 },
  'warm-night': { exposure: 1.0, hot: 1.0, bloom: 0.3, thresh: 0.7, halation: 0.18, haze: 0.0, vig: 0.42, ca: 0.004, tone: 0.6, contrast: 0.1, sat: 1.0, temp: 0.04, tint: 0.0, lift: [0.0, 0.01, 0.03], gamma: [1, 1, 1.02], gain: [1.02, 1.0, 0.97], grain: 0.035, grainCell: 2.0 },
  'soft-day':   { exposure: 1.0, hot: 0.0, bloom: 0.12, thresh: 0.97, halation: 0.0, haze: 0.0, vig: 0.22, ca: 0.002, tone: 0.25, contrast: 0.06, sat: 1.05, temp: 0.03, tint: 0.0, lift: [0.012, 0.01, 0.014], gamma: [1, 1, 1], gain: [1, 1, 1], grain: 0.022, grainCell: 1.4 },
};
function lookParams(t) {
  const L = typeof LOOK === 'string' ? { preset: LOOK } : LOOK || {};
  const base = LOOK_PRESETS[L.preset || 'film'] || LOOK_PRESETS.film;
  const over = typeof lookAt === 'function' ? lookAt(t) || {} : {};
  return { ...base, ...L, ...over };
}
const LOOKGL = (() => {
  let cv = null, gl = null, quad = null, src = null, fmt = null, warned = false;
  const progs = {}, targets = {};
  const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  function init() {
    if (gl) return true;
    cv = document.createElement('canvas');
    gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) { if (!warned) console.warn('look: no WebGL2, the frame is left as drawn'); warned = true; return false; }
    fmt = gl.getExtension('EXT_color_buffer_float') ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    src = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, src);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return true;
  }
  function compile(key, fs) {
    if (progs[key]) return progs[key];
    const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(`look shader "${key}": ${gl.getShaderInfoLog(o)}`); return o; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`look link "${key}": ${gl.getProgramInfoLog(p)}`);
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    return (progs[key] = { p, u });
  }
  function target(name, w, h) {
    let t = targets[name];
    if (t && t.w === w && t.h === h) return t;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt[0], w, h, 0, gl.RGBA, fmt[1], null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return (targets[name] = { tex, fb, w, h });
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
  function upload(canvas) {
    if (cv.width !== canvas.width || cv.height !== canvas.height) { cv.width = canvas.width; cv.height = canvas.height; }
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return src;
  }
  return { init, compile, target, draw, upload, get cv() { return cv; } };
})();

const LOOK_GLSL = {
  // sRGB -> linear, highlights pushed above 1 so a lit window or a flame can bloom
  lin: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform float uExposure, uHot;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() { vec3 c = toLin(texture(uSrc, vUv).rgb); float l = max(c.r, max(c.g, c.b));
  c *= 1.0 + 2.5 * uHot * smoothstep(0.8, 1.0, l); o = vec4(c * uExposure, 1.0); }`,
  bright: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform float uThresh;
void main() { vec3 c = texture(uSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * max(l - uThresh, 0.0) / max(l, 1e-4), 1.0); }`,
  down: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uTexel;
void main() { vec3 a = texture(uSrc, vUv + uTexel * vec2(-1, -1)).rgb + texture(uSrc, vUv + uTexel * vec2(1, -1)).rgb + texture(uSrc, vUv + uTexel * vec2(-1, 1)).rgb + texture(uSrc, vUv + uTexel * vec2(1, 1)).rgb;
  o = vec4(a * 0.125 + texture(uSrc, vUv).rgb * 0.5, 1.0); }`,
  up: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform sampler2D uAdd; uniform vec2 uTexel;
void main() { vec3 s = vec3(0); for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) s += texture(uSrc, vUv + uTexel * vec2(x, y)).rgb * (x == 0 && y == 0 ? 4.0 : (x == 0 || y == 0 ? 2.0 : 1.0));
  o = vec4(s / 16.0 + texture(uAdd, vUv).rgb, 1.0); }`,
  final: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uLin; uniform sampler2D uBloom; uniform sampler2D uWide;
uniform float uBloomK, uHal, uHaze, uVig, uCA, uTone, uCon, uSat, uTemp, uTint, uGrain, uGrainCell, uSeed;
uniform vec3 uLift, uGamma, uGain;
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
float h(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main() {
  vec2 d = vUv - 0.5; float r2 = dot(d, d);
  vec3 c; c.r = texture(uLin, vUv - d * uCA * r2 * 4.0).r; c.g = texture(uLin, vUv).g; c.b = texture(uLin, vUv + d * uCA * r2 * 4.0).b;
  vec3 bl = texture(uBloom, vUv).rgb, wide = texture(uWide, vUv).rgb;
  c += bl * uBloomK;
  c += wide * vec3(1.0, 0.45, 0.25) * uHal;                   // halation: film's red glow around bright edges
  c *= 1.0 - uVig * smoothstep(0.05, 0.6, r2 * 1.8);
  vec3 ac = aces(c * 1.45);                                    // ACES lifted so a mid grey stays near where it was
  c = mix(min(c, vec3(1.0)), ac, uTone);
  c = toSrgb(clamp(c, 0.0, 1.0));
  c += vec3(uTemp, 0.0, -uTemp) * 0.5 + vec3(0.0, uTint, 0.0) * 0.5;   // white balance
  c = pow(max(c, 0.0), 1.0 / uGamma) * uGain + uLift * (1.0 - c);
  c = mix(c, c * c * (3.0 - 2.0 * c), uCon * 4.0);             // S-curve contrast
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = mix(c, vec3(1.0, 0.97, 0.94), uHaze * (1.0 - l));        // haze: lifted, warm blacks
  vec2 q = gl_FragCoord.xy / max(uGrainCell, 1.0), i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  vec2 so = vec2(uSeed * 37.0, uSeed * 11.0);
  float n = mix(mix(h(i + so), h(i + so + vec2(1, 0)), f.x), mix(h(i + so + vec2(0, 1)), h(i + so + vec2(1, 1)), f.x), f.y);
  c += (n - 0.5) * 2.45 * uGrain * (0.5 + 0.5 * (1.0 - l));
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
};

// applyLook(canvas): run the chain over the finished frame in place (called by kit/morph.js after STYLE.post)
function applyLook(canvas) {
  if (!LOOKGL.init()) return;
  const P = lookParams(TT), w = canvas.width, h = canvas.height;
  const src = LOOKGL.upload(canvas), C = (k) => LOOKGL.compile(k, LOOK_GLSL[k]);
  const lin = LOOKGL.target('lin', w, h);
  LOOKGL.draw(C('lin'), lin, { uSrc: src, uExposure: P.exposure, uHot: P.hot });
  let lw = Math.max(1, w >> 1), lh = Math.max(1, h >> 1);
  const lv = [LOOKGL.target('b0', lw, lh)];
  LOOKGL.draw(C('bright'), lv[0], { uSrc: lin, uThresh: P.thresh });
  const NL = 6;
  for (let i = 1; i < NL; i++) { lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1); lv.push(LOOKGL.target('b' + i, lw, lh)); LOOKGL.draw(C('down'), lv[i], { uSrc: lv[i - 1], uTexel: [1 / lv[i - 1].w, 1 / lv[i - 1].h] }); }
  for (let i = NL - 1; i > 0; i--) { const dst = LOOKGL.target('u' + (i - 1), lv[i - 1].w, lv[i - 1].h); LOOKGL.draw(C('up'), dst, { uSrc: i === NL - 1 ? lv[NL - 1] : LOOKGL.target('u' + i, lv[i].w, lv[i].h), uAdd: lv[i - 1], uTexel: [1 / lv[i].w, 1 / lv[i].h] }); }
  const k = w / 1080;
  LOOKGL.draw(C('final'), null, {
    uLin: lin, uBloom: LOOKGL.target('u0', lv[0].w, lv[0].h), uWide: LOOKGL.target('u2', lv[2].w, lv[2].h),
    uBloomK: P.bloom, uHal: P.halation, uHaze: P.haze, uVig: P.vig, uCA: P.ca, uTone: P.tone, uCon: P.contrast, uSat: P.sat,
    uTemp: P.temp, uTint: P.tint, uLift: P.lift, uGamma: P.gamma, uGain: P.gain,
    uGrain: P.grain, uGrainCell: P.grainCell * k, uSeed: F % 251,
  });
  const g = canvas.getContext('2d');
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'copy'; g.filter = 'none';
  g.drawImage(LOOKGL.cv, 0, 0); g.restore();
}
