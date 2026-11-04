#!/usr/bin/env node
// A thumbnail (cover) for a piece, drawn from its own strongest frame: zoom onto the subject, punch the contrast, light the
// eyes, a big title with a tape-style colour split, a small episode tag. One PNG per variant, at the piece's own size.
//   usage: node tools/thumb.mjs <piece dir> [--variant a,b] [--out <dir>] [--fonts Anton,BebasNeue,...|all]
//   --fonts: the base cover once per title font -> <out>/fonts/thumb-<Font>.png (default out: <piece>/publish), for
//            tools/thumbcheck.mjs --pick to judge and choose: `node tools/thumbcheck.mjs <piece>/publish/fonts/*.png --pick`
// piece.json -> "thumb": {
//   "t": 99.5,                       the frame (seconds) the picture comes from
//   "zoom": 1.3, "focus": [540, 900], the frame point that lands at the thumbnail's centre, and how close
//   "tilt": -2,                      degrees (a dutch angle)
//   "punch": { "contrast": 1.3, "saturate": 1.2, "brightness": 1.0 },
//   "glow": [[x, y, r, "#ff2a1a", 0.9]], light added on the thumbnail (its own coordinates): eyes, a screen, a lamp
//   "light": { "color": "#ff2a10", "from": "left", "amt": 0.5 },  a coloured side light over the picture (soft-light)
//   "shade": 0.55,                   how dark the band behind the title gets (0..1)
//   "lines": [{ "text": "NEVER SAY", "size": 150 }, { "text": "YOUR NAME", "size": 230, "color": "#ff2a1a" }],
//   "y": 1280,                       the title block's centre
//   "tag": "TAPE 1 OF 6",            a small label top left (inside the 3:4 profile-grid crop)
//   "font": "Anton", "weight": 900,  the title face: a file in a fonts/ folder (below), or an installed font (default Impact)
//   "fit": 0.86,                     scale the title block so its widest row fills this share of the width (max 1.8x the sizes)
//   "tagFont": "VT323",              the tag's face (default Consolas)
//   "subject": [x0, y0, x1, y1],      the thing to look at (cover coordinates): thumbcheck.mjs checks it is big, sharp, uncovered
//   "spot": [x, y, r, 0.35],         light on the subject and the rest darkened (default from "subject"; false: none)
//   "mask": [[x0, y0, x1, y1, 0.9]], soft dark patches over what fights the subject (the frame's own text)
//   "titleStyle": "label",           poster (default) | label (handwritten on masking tape) | type (typewritten strip) | osd (mono on black bars)
//   "lines": [{ ..., "ink": "#b3150d" }], a row's ink on a label/type strip (default: dark ink, red ink for a row with a "color")
//   "split": 0.02,                   the title's red/cyan colour split, as a share of its size
//   "tear": true,                    slide a band of the big title row sideways (a tracking glitch; off: it bends the letters)
//   "variants": { "b": { ...any of the above } }   A/B covers; "a" is the base
// }
// -> <piece>/publish/thumb.png (variant a) and thumb-<v>.png, each with thumb[-v].json: the title boxes, for tools/thumbcheck.mjs.
// Fonts: every .ttf/.otf/.woff2 in a fonts/ folder of the piece, of its series (piece.json "series") or of a folder above it;
// the family is the file name up to the first "-" or "[" (Anton-Regular.ttf -> "Anton", Oswald[wght].ttf -> "Oswald").
// The piece sees window.THUMB = true while the frame renders (a series can hide its subtitles under the title).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const only = opt('--variant')?.split(','), outDir = opt('--out'), fontsArg = opt('--fonts');
const dir = args[0];
if (!dir) { console.error('usage: node tools/thumb.mjs <piece dir> [--variant a,b] [--out <dir>]'); process.exit(2); }
const ROOT = path.resolve(dir), PIECE = JSON.parse(fs.readFileSync(path.join(ROOT, 'piece.json'), 'utf8'));
const BASE = PIECE.thumb;
if (!BASE) { console.error('piece.json has no "thumb" block (see the usage at the top of tools/thumb.mjs)'); process.exit(2); }
const { variants = {}, ...base } = BASE;
const all = { a: base, ...Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { ...base, ...v }])) };
const OUT = path.resolve(outDir || path.join(ROOT, 'publish'));
fs.mkdirSync(OUT, { recursive: true });

// the font files this piece can use: its own fonts/, its series' fonts/, then fonts/ folders above it
const fontDirs = [path.join(ROOT, 'fonts')];
if (PIECE.series) for (let d = ROOT; ; d = path.dirname(d)) { const c = path.join(d, PIECE.series, 'fonts'); if (fs.existsSync(c)) { fontDirs.push(c); break; } if (path.dirname(d) === d) break; }
for (let d = path.dirname(ROOT); path.dirname(d) !== d; d = path.dirname(d)) fontDirs.push(path.join(d, 'fonts'));
const FONTS = {};
for (const d of fontDirs) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) {
  if (!/\.(ttf|otf|woff2?)$/i.test(f)) continue;
  const family = f.replace(/[-\[.].*$/, '');
  if (!FONTS[family]) FONTS[family] = { file: path.join(d, f), variable: /\[wght\]/i.test(f) };
}
// --fonts: the base cover once per face (all = every font file found, plus Impact as the reference)
if (fontsArg) {
  const list = fontsArg === 'all' ? ['Impact', ...Object.keys(FONTS)] : fontsArg.split(',').map((x) => x.trim());
  for (const k of Object.keys(all)) delete all[k];
  for (const f of list) all[`font-${f}`] = { ...base, fit: base.fit ?? 0.86, font: f };   // same width for every face: a fair fight
}

const browser = await chromium.launch(), page = await browser.newPage();
page.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
await page.addInitScript(() => { window.THUMB = true; });
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href + '?export=1');
await page.waitForFunction(() => window.TIMELINE && window.renderFrame);
await page.evaluate(async (fonts) => {
  for (const [family, f] of Object.entries(fonts)) {
    const bin = Uint8Array.from(atob(f.b64), (ch) => ch.charCodeAt(0));
    const face = new FontFace(family, bin.buffer, f.variable ? { weight: '100 900' } : {});
    document.fonts.add(await face.load());
    if (f.variable) (window.THUMB_VARIABLE ||= []).push(family);
  }
  await document.fonts.ready;
}, Object.fromEntries(Object.entries(FONTS).map(([k, f]) => [k, { variable: f.variable, b64: fs.readFileSync(f.file).toString('base64') }])));

for (const [name, cfg] of Object.entries(all)) {
  if (only && !only.includes(name)) continue;
  const res = await page.evaluate((c) => {
    const T = window.TIMELINE, W = T.width, H = T.height;
    const src = document.createElement('canvas'); src.width = W; src.height = H;
    window.renderFrame(Math.round(c.t * T.fps) / T.fps, src);
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const g = out.getContext('2d');
    const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    g.fillStyle = '#050605'; g.fillRect(0, 0, W, H);

    // ---- the picture: zoom onto the focus, tilt, punch
    const zoom = Math.max(1, c.zoom ?? 1), [fx0, fy0] = c.focus ?? [W / 2, H / 2];
    // keep the frame covering the whole cover (a focus near the edge would show the black under it)
    const fx = Math.min(W - W / 2 / zoom, Math.max(W / 2 / zoom, fx0)), fy = Math.min(H - H / 2 / zoom, Math.max(H / 2 / zoom, fy0)), tilt = ((c.tilt ?? 0) * Math.PI) / 180, P = c.punch ?? {};
    g.save(); g.translate(W / 2, H / 2); g.rotate(tilt); g.scale(zoom, zoom); g.translate(-fx, -fy);
    g.filter = `contrast(${P.contrast ?? 1.25}) saturate(${P.saturate ?? 1.15}) brightness(${P.brightness ?? 1})`;
    g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0); g.filter = 'none'; g.restore();

    // ---- a coloured side light: lifts the shadow side into the accent colour
    if (c.light) {
      const L = c.light, sides = { left: [0, 0, W, 0], right: [W, 0, 0, 0], top: [0, 0, 0, H], bottom: [0, H, 0, 0] };
      const [ax, ay, bx, by] = sides[L.from ?? 'left'], lg = g.createLinearGradient(ax, ay, bx, by);
      lg.addColorStop(0, L.color ?? '#ff2a10'); lg.addColorStop(0.55, 'rgba(0,0,0,0)');
      g.save(); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = L.amt ?? 0.5; g.fillStyle = lg; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'screen'; g.globalAlpha = (L.amt ?? 0.5) * 0.35; g.fillRect(0, 0, W, H); g.restore();
    }

    // ---- the subject lit, the rest pushed down (separation): a soft spot on the subject (default: the "subject" box),
    // and the frame outside it darkened. "spot": [x, y, r, amt] or false
    const sb = c.subject, spot = c.spot === false ? null : c.spot ?? (sb ? [(sb[0] + sb[2]) / 2, (sb[1] + sb[3]) / 2, Math.max(sb[2] - sb[0], sb[3] - sb[1]) * 0.55, 0.35] : null);
    if (spot) {
      const [sx, sy, sr, sa = 0.35] = spot;
      const lit = g.createRadialGradient(sx, sy, 0, sx, sy, sr);
      lit.addColorStop(0, 'rgba(255,236,214,1)'); lit.addColorStop(1, 'rgba(255,236,214,0)');
      g.save(); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = sa * 1.6; g.fillStyle = lit; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'screen'; g.globalAlpha = sa * 0.28; g.fillRect(0, 0, W, H);
      const dark = g.createRadialGradient(sx, sy, sr * 0.75, sx, sy, sr * 1.9);
      dark.addColorStop(0, 'rgba(0,0,0,0)'); dark.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, sa * 2)})`);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.fillStyle = dark; g.fillRect(0, 0, W, H); g.restore();
    }
    // ---- masks: soft dark patches over what fights the subject (the frame's own text, a busy corner). [x0, y0, x1, y1, alpha]
    for (const [x0, y0, x1, y1, a = 0.9] of c.mask ?? []) {
      g.save(); g.filter = 'blur(40px)'; g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.restore();
      g.save(); g.fillStyle = `rgba(0,0,0,${a * 0.85})`; g.fillRect(x0 + 40, y0 + 40, Math.max(0, x1 - x0 - 80), Math.max(0, y1 - y0 - 80)); g.restore();
    }

    // ---- added light (eyes, screens): a hot core and a wide halo, screen-blended
    g.save(); g.globalCompositeOperation = 'screen';
    for (const [x, y, r, col = '#ff3a1a', k = 0.9] of c.glow ?? []) {
      const tx = x, ty = y, R = r;
      for (const [rr, a] of [[R * 4.5, 0.35 * k], [R * 1.6, 0.8 * k], [R * 0.55, 1 * k]]) {
        const gr = g.createRadialGradient(tx, ty, 0, tx, ty, rr);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = a; g.fillStyle = gr; g.fillRect(tx - rr, ty - rr, rr * 2, rr * 2);
      }
    }
    g.restore();

    // ---- grade: a red edge, a heavy vignette, a dark band behind the title
    const vig = g.createRadialGradient(W / 2, H * 0.45, W * 0.3, W / 2, H * 0.5, H * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(0.65, 'rgba(40,0,0,0.35)'); vig.addColorStop(1, 'rgba(0,0,0,0.92)');
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
    // ---- the title layout: measured in its own face, scaled as one block, rows stacked by their real cap heights
    // the title's look: poster (heavy caps, outline, colour split), label (handwritten on a strip of masking tape, like the
    // tape's own label), type (typewritten on a clean paper strip, an archive card), osd (the deck's own text: mono on black bars)
    const STY = c.titleStyle ?? 'poster', FACE = c.font ?? { label: 'Ink Free', type: 'SpecialElite', osd: 'VT323' }[STY] ?? 'Impact';
    const FONT = `"${FACE}", Impact, "Arial Black", sans-serif`, WEIGHT = c.weight ?? ((window.THUMB_VARIABLE || []).includes(FACE) ? 900 : 400);   // a one-weight face at 900 gets a smeared fake bold
    const y0 = c.y ?? H * 0.68, lines = c.lines ?? [], boxes = [];
    const fontAt = (px) => `${WEIGHT} ${px}px ${FONT}`;
    const widths = lines.map((l) => { g.font = fontAt(l.size ?? 180); return g.measureText(l.text).width; });
    let k = c.fit ? Math.min(1.8, (W * c.fit) / Math.max(...widths)) : 1;
    k = Math.min(k, (W * (STY === 'label' || STY === 'type' ? 0.74 : 0.9)) / Math.max(1, ...widths));   // never wider than 90% (a strip, with its padding)
    const rows = lines.map((l) => {
      const size = Math.floor((l.size ?? 180) * k); g.font = fontAt(size);
      const m = g.measureText(l.text);
      return { ...l, size, w: m.width, cap: m.actualBoundingBoxAscent, desc: Math.max(0, m.actualBoundingBoxDescent) };
    });
    const GAP = (r) => r.cap * (STY === 'poster' ? 0.16 : STY === 'osd' ? 0.55 : 0.8), blockH = rows.reduce((a, r, i) => a + r.cap + (i ? GAP(r) : 0), 0);
    if (lines.length) {
      const sh = c.shade ?? 0.55, band = g.createLinearGradient(0, y0 - blockH * 1.1, 0, y0 + blockH * 1.1);
      band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.3, `rgba(0,0,0,${sh})`); band.addColorStop(0.7, `rgba(0,0,0,${sh})`); band.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = band; g.fillRect(0, y0 - blockH * 1.1, W, blockH * 2.2);
    }

    // ---- the title
    const strip = (x0, y0, w, h, rough, seed) => {   // a strip of tape or paper: torn (rough) or cut ends
      const P = [], n = 7;
      P.push([x0, y0]); P.push([x0 + w, y0]);
      for (let k = 1; k < n; k++) P.push([x0 + w + (rough ? (hash(seed + k) - 0.5) * h * 0.22 : 0), y0 + (h * k) / n]);
      P.push([x0 + w, y0 + h]); P.push([x0, y0 + h]);
      for (let k = n - 1; k > 0; k--) P.push([x0 + (rough ? (hash(seed + 20 + k) - 0.5) * h * 0.22 : 0), y0 + (h * k) / n]);
      g.beginPath(); P.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath();
    };
    let y = y0 - blockH / 2;
    rows.forEach((r, i) => {
      const size = r.size, x = W / 2;
      y += r.cap + (i ? GAP(r) : 0);
      g.save(); g.font = fontAt(size); g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      let col = r.color ?? '#f4f1e6', bx0 = x - r.w / 2, bx1 = x + r.w / 2, by0 = y - r.cap, by1 = y + r.desc;
      if (STY === 'poster') {
        g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = size * 0.25; g.lineWidth = size * 0.1; g.strokeStyle = '#000'; g.strokeText(r.text, x, y);
        g.shadowBlur = 0;
        const split = Math.max(2, size * (c.split ?? 0.02));
        g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.85;
        g.fillStyle = '#ff1e1e'; g.fillText(r.text, x + split, y);
        g.fillStyle = '#18e4ff'; g.fillText(r.text, x - split, y);
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        g.fillStyle = col; g.fillText(r.text, x, y);
        if (r.glow) { g.shadowColor = col; g.shadowBlur = size * 0.35; g.globalAlpha = 0.6; g.fillText(r.text, x, y); }
      } else if (STY === 'label' || STY === 'type') {
        // ink on a cream strip: dark ink, and the accent row in red ink
        const padX = size * 0.32, padY = size * 0.2, h = r.cap + r.desc + padY * 2, w = r.w + padX * 2;
        const tilt = STY === 'label' ? (((c.labelTilt ?? -2.5) * (i % 2 ? -0.7 : 1)) * Math.PI) / 180 : 0;
        const cy = y - r.cap / 2 + r.desc / 2;
        g.translate(x, cy); g.rotate(tilt); g.translate(-x, -cy);
        g.shadowColor = 'rgba(0,0,0,0.75)'; g.shadowBlur = size * 0.3; g.shadowOffsetY = size * 0.06;
        strip(x - w / 2, y - r.cap - padY, w, h, STY === 'label', c.t + i * 7);
        const paper = g.createLinearGradient(0, y - r.cap - padY, 0, y + r.desc + padY);
        paper.addColorStop(0, STY === 'label' ? '#e3d9bd' : '#ece8dc'); paper.addColorStop(1, STY === 'label' ? '#cfc3a2' : '#dcd6c6');
        g.fillStyle = paper; g.fill(); g.shadowColor = 'transparent';
        if (STY === 'label') { g.globalAlpha = 0.18; g.fillStyle = '#7a6a48'; for (let k = 0; k < 40; k++) g.fillRect(x - w / 2 + hash(c.t + k) * w, y - r.cap - padY + hash(c.t + k + 99) * h, 2, 2); g.globalAlpha = 1; }
        col = r.color ? (r.ink ?? '#b3150d') : (r.ink ?? '#1b1712');
        g.fillStyle = col; g.fillText(r.text, x, y);
        bx0 = x - w / 2; bx1 = x + w / 2; by0 = y - r.cap - padY; by1 = y + r.desc + padY;
      } else if (STY === 'osd') {
        // the deck's text: a black bar, mono letters with a little bloom
        const padX = size * 0.25, padY = size * 0.16, w = r.w + padX * 2;
        g.fillStyle = 'rgba(0,0,0,0.86)'; g.fillRect(x - w / 2, y - r.cap - padY, w, r.cap + r.desc + padY * 2);
        col = r.color ?? '#f2f2ee';
        g.shadowColor = col; g.shadowBlur = size * 0.12; g.fillStyle = col; g.fillText(r.text, x, y);
        g.shadowBlur = 0; g.globalAlpha = 0.35; g.fillStyle = '#4fe3ff'; g.fillText(r.text, x - Math.max(2, size * 0.015), y); g.globalAlpha = 1; g.fillStyle = col; g.fillText(r.text, x, y);
        bx0 = x - w / 2; bx1 = x + w / 2; by0 = y - r.cap - padY; by1 = y + r.desc + padY;
      }
      g.restore();
      boxes.push({ text: r.text, font: FACE, style: STY, x0: bx0, x1: bx1, y0: by0, y1: by1, cap: r.cap, color: col });
    });
    // a tracking tear through the biggest title row, below its middle (higher up, a thin strip reads as a strike-through)
    if (lines.length && c.tear) {
      const big = boxes.reduce((a, b) => (b.cap > a.cap ? b : a));
      const ty = Math.round(big.y0 + big.cap * (0.5 + hash(c.t) * 0.12)), th = Math.round(big.cap * 0.24), dx = Math.round(16 + hash(c.t + 1) * 10);
      const strip = g.getImageData(0, ty, W, th); g.putImageData(strip, dx, ty);
    }

    // ---- the episode tag, top left, inside the 3:4 grid crop
    if (c.tag) {
      const top = (H - W * 4 / 3) / 2 + 70, MONO = `${c.tagFont ? `"${c.tagFont}", ` : ''}"Consolas", "Courier New", monospace`;
      g.save(); g.font = `${c.tagFont ? 400 : 700} ${c.tagFont ? 84 : 68}px ${MONO}`; g.textBaseline = 'middle';
      const tw = g.measureText(c.tag).width;
      g.fillStyle = '#d0140c'; g.fillRect(60, top - 50, tw + 130, 100);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(104, top, 19, 0, Math.PI * 2); g.fill();
      g.fillText(c.tag, 146, top + 3); g.restore();
      boxes.push({ text: c.tag, tag: true, x0: 60, x1: 190 + tw, y0: top - 50, y1: top + 50, cap: 48, color: '#fff' });
    }

    // ---- tape over everything (so the title sits in the picture): scanlines and grain
    g.save(); g.globalAlpha = 0.09; g.fillStyle = '#000';
    for (let yy = 0; yy < H; yy += 4) g.fillRect(0, yy, W, 2);
    g.restore();
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (hash(i * 0.25 + c.t) - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    return { url: out.toDataURL('image/png'), boxes, width: W, height: H };
  }, cfg);
  const file = name.startsWith('font-') ? path.join(OUT, 'fonts', `thumb-${name.slice(5)}.png`) : path.join(OUT, name === 'a' ? 'thumb.png' : `thumb-${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(res.url.split(',')[1], 'base64'));
  fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify({ piece: PIECE.name, variant: name, font: cfg.font ?? null, titleStyle: cfg.titleStyle ?? 'poster', t: cfg.t, subject: cfg.subject ?? null, width: res.width, height: res.height, boxes: res.boxes }, null, 2));
  console.log('thumb', path.relative(process.cwd(), file));
}
await browser.close();
