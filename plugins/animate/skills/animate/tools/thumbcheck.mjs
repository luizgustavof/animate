#!/usr/bin/env node
// Thumbnail critic: judges covers the way a phone shows them, small and cropped, and says what to fix.
//   usage: node tools/thumbcheck.mjs <thumb.png> [<thumb-b.png> ...] [--sheet out.png] [--pick]
//   --pick: the covers are candidates for one slot (fonts from `thumb.mjs --fonts`, A/B variants): rank them and name the best
// For each cover (a thumb[-v].json beside it, from tools/thumb.mjs, adds the title checks):
//   1. sizes: the TikTok profile grid (3:4 centre crop, 130 px wide, the size it really is on a phone), the Shorts shelf
//      (9:16, 160 px), the feed (full, 360 px), and the 3:4 crop in grey (the value structure: does it read without colour?)
//   2. value contrast: RMS contrast of the luma at grid size (a cover that is all one grey disappears in the grid)
//   3. darkness: mean luma and how much is crushed to black (dark is the genre; mud is not)
//   4. colour punch: Hasler-Süsstrunk colourfulness, and whether one accent colour dominates (one loud colour reads better than four)
//   5. focus: where the detail sits (gradient energy) — how much of it is inside the 3:4 crop, and how concentrated it is
//      (one subject beats a busy frame)
//   6. title (needs the .json): cap height in grid pixels (readable from ~9 px), every box inside the 3:4 crop, the Otsu light/dark
//      contrast inside each box (two-tone split, like a WCAG ratio)
//   6b. the title's face (needs the .json): stroke width at grid size (thin strokes vanish at 130 px) and glyph survival
//      (the letters shrunk to grid size and back: how much of their shape is left, IoU) — what separates one font from another
//   6c. what earns the click (one focal point, short text that adds to the title, a sharp lit subject; needs the .json, "subject" from thumb.json for the last three):
//      the title takes at most 18% of the 3:4 crop; it does not repeat the video's title or caption (publish/meta.json);
//      the subject is sharp (edge crispness over the tape noise), big (≥ 30% of the crop), not covered by the title, and stands out from its surround
//   7. squint: at 24 px wide, does the subject still separate from the background
//   8. series: covers given together should differ in layout (16 px luma correlation < 0.7; calibrated on two mascot
//      face covers that read alike in the grid: 0.72)
// Prints PASS / WARN / FAIL per check, a score out of 100 and the fixes; writes the sheet (default: <first>-check.png).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright'); } catch { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();

const args = process.argv.slice(2);
const si = args.indexOf('--sheet'), sheetOut = si >= 0 ? args.splice(si, 2)[1] : null;
const pi = args.indexOf('--pick'), PICK = pi >= 0 && Boolean(args.splice(pi, 1));
const files = args;
if (!files.length) { console.error('usage: node tools/thumbcheck.mjs <thumb.png> [...] [--sheet out.png]'); process.exit(2); }
const items = files.map((f) => {
  const side = f.replace(/\.png$/i, '.json');
  const up = path.basename(path.dirname(path.resolve(f))), owner = up === 'publish' ? path.basename(path.dirname(path.dirname(path.resolve(f)))) : up;
  let said = '';
  for (let d = path.dirname(path.resolve(f)), i = 0; i < 3; i++, d = path.dirname(d)) {
    const m = path.join(d, 'meta.json');
    if (fs.existsSync(m)) { try { const j = JSON.parse(fs.readFileSync(m, 'utf8')); said = [j.title, j.youtube?.title, j.tiktok?.caption, j.description].filter(Boolean).join(' '); } catch {} break; }
  }
  return { said, name: `${owner}/${path.basename(f)}`, url: 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'), meta: fs.existsSync(side) ? JSON.parse(fs.readFileSync(side, 'utf8')) : null };
});

const browser = await chromium.launch(), page = await browser.newPage();
const res = await page.evaluate(async (items) => {
  const load = (u) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const draw = (img, sx, sy, sw, sh, w, h) => { const c = canvas(w, h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h); return c; };
  const px = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lumaOf = (d) => { const L = new Float32Array(d.length / 4); for (let i = 0; i < L.length; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; return L; };
  const relLum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const out = [], smalls = [];
  for (const it of items) {
    const img = await load(it.url), W = img.width, H = img.height;
    const cropH = Math.min(H, Math.round(W * 4 / 3)), cropY = Math.round((H - cropH) / 2);
    const grid = draw(img, 0, cropY, W, cropH, 130, Math.round(130 * cropH / W));
    const gd = px(grid), L = lumaOf(gd), n = L.length;
    let mean = 0; for (const v of L) mean += v; mean /= n;
    let vr = 0, crushed = 0; for (const v of L) { vr += (v - mean) ** 2; if (v < 0.05) crushed++; } const rms = Math.sqrt(vr / n);
    // colourfulness (Hasler & Süsstrunk 2003) on the grid tile
    let ma = 0, mb = 0, sa = 0, sb = 0; const rg = [], yb = [];
    for (let i = 0; i < n; i++) { const r = gd[i * 4], g = gd[i * 4 + 1], b = gd[i * 4 + 2]; rg.push(r - g); yb.push(0.5 * (r + g) - b); }
    rg.forEach((v) => (ma += v)); yb.forEach((v) => (mb += v)); ma /= n; mb /= n;
    rg.forEach((v) => (sa += (v - ma) ** 2)); yb.forEach((v) => (sb += (v - mb) ** 2));
    const colourful = Math.sqrt(sa / n + sb / n) + 0.3 * Math.sqrt(ma * ma + mb * mb);
    // the loud colours: saturated pixels by hue sector (12), the share of the biggest one
    const hues = new Array(12).fill(0); let loud = 0;
    for (let i = 0; i < n; i++) {
      const r = gd[i * 4] / 255, g = gd[i * 4 + 1] / 255, b = gd[i * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 0.35 || mx < 0.3) continue;
      let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; h = (h * 60 + 360) % 360;
      hues[Math.floor(h / 30) % 12]++; loud++;
    }
    const accent = loud ? Math.max(...hues) / loud : 0, loudShare = loud / n;
    // focus: gradient energy on the full frame at 180 px wide, inside vs outside the crop, and its concentration
    const fw = 180, fh = Math.round(180 * H / W), F = lumaOf(px(draw(img, 0, 0, W, H, fw, fh)));
    const E = new Float32Array(fw * fh); let eAll = 0, eIn = 0;
    const cy0 = (cropY / H) * fh, cy1 = ((cropY + cropH) / H) * fh;
    for (let y = 1; y < fh - 1; y++) for (let x = 1; x < fw - 1; x++) {
      const i = y * fw + x, gx = F[i + 1] - F[i - 1], gy = F[i + fw] - F[i - fw], e = Math.hypot(gx, gy);
      E[i] = e; eAll += e; if (y >= cy0 && y < cy1) eIn += e;
    }
    // concentration: the share of the energy in the busiest 15% of 12x12 cells
    const cells = []; for (let y = 0; y < fh; y += 12) for (let x = 0; x < fw; x += 12) { let s = 0; for (let yy = y; yy < Math.min(fh, y + 12); yy++) for (let xx = x; xx < Math.min(fw, x + 12); xx++) s += E[yy * fw + xx]; cells.push(s); }
    cells.sort((a, b) => b - a); const top = cells.slice(0, Math.max(1, Math.round(cells.length * 0.15))).reduce((a, b) => a + b, 0);
    const concentration = eAll ? top / eAll : 0, inCrop = eAll ? eIn / eAll : 0;
    // squint: 24 px wide, the spread between the brightest and darkest tenth
    const sq = lumaOf(px(draw(img, 0, cropY, W, cropH, 24, 32))).sort(), squint = sq[Math.floor(sq.length * 0.9)] - sq[Math.floor(sq.length * 0.1)];
    // title boxes: grid size, inside the crop, two-tone contrast
    const titles = [];
    if (it.meta) {
      const full = canvas(W, H); full.getContext('2d').drawImage(img, 0, 0);
      const k = 130 / W;
      for (const b of it.meta.boxes) {
        const x0 = Math.max(0, Math.floor(b.x0)), y0 = Math.max(0, Math.floor(b.y0)), x1 = Math.min(W, Math.ceil(b.x1)), y1 = Math.min(H, Math.ceil(b.y1));
        const d = full.getContext('2d').getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data, ls = [];
        for (let i = 0; i < d.length; i += 4) ls.push(relLum(d[i], d[i + 1], d[i + 2]));
        // two-tone split (Otsu on perceptual lightness): letters vs outline/backdrop, whatever share of the box the letters fill
        // (a heavy face like Impact covers ~70% of its box, so fixed percentiles would compare the letters with themselves)
        const BINS = 64, hist = new Array(BINS).fill(0), sumL = new Array(BINS).fill(0);
        for (const v of ls) { const bin = Math.min(BINS - 1, Math.floor(Math.cbrt(v) * BINS)); hist[bin]++; sumL[bin] += v; }
        let best = -1, cut = 1, wB = 0, sB = 0; const tot = ls.length, sAll = hist.reduce((s, h, i) => s + h * i, 0);
        for (let i = 0; i < BINS - 1; i++) {
          wB += hist[i]; sB += hist[i] * i; const wF = tot - wB; if (!wB || !wF) continue;
          const v = wB * wF * (sB / wB - (sAll - sB) / wF) ** 2; if (v > best) { best = v; cut = i + 1; }
        }
        const mean = (a, b) => { let s = 0, c = 0; for (let i = a; i < b; i++) { s += sumL[i]; c += hist[i]; } return c ? s / c : 0; };
        const ratio = (mean(cut, BINS) + 0.05) / (mean(0, cut) + 0.05);
        // the letters: the light class of that split. Stroke width = 2 * ink / edge; survival = IoU after a trip to grid size
        const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0), on = new Uint8Array(bw * bh);
        for (let i = 0; i < on.length; i++) on[i] = Math.min(BINS - 1, Math.floor(Math.cbrt(ls[i]) * BINS)) >= cut ? 1 : 0;
        let ink = 0, edge = 0;
        for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
          const i = yy * bw + xx; if (!on[i]) continue; ink++;
          if (xx === 0 || yy === 0 || xx === bw - 1 || yy === bh - 1 || !on[i - 1] || !on[i + 1] || !on[i - bw] || !on[i + bw]) edge++;
        }
        const strokePx = edge ? ((2 * ink) / edge) * k : 0;
        const mc = canvas(bw, bh), mg = mc.getContext('2d'), mi = mg.createImageData(bw, bh);
        for (let i = 0; i < on.length; i++) { const v = on[i] * 255; mi.data[i * 4] = mi.data[i * 4 + 1] = mi.data[i * 4 + 2] = v; mi.data[i * 4 + 3] = 255; }
        mg.putImageData(mi, 0, 0);
        const sw = Math.max(1, Math.round(bw * k)), shh = Math.max(1, Math.round(bh * k)), sm = canvas(sw, shh), sg = sm.getContext('2d');
        sg.imageSmoothingQuality = 'high'; sg.drawImage(mc, 0, 0, sw, shh);
        const back = canvas(bw, bh), bg = back.getContext('2d'); bg.imageSmoothingQuality = 'high'; bg.drawImage(sm, 0, 0, bw, bh);
        const bd = bg.getImageData(0, 0, bw, bh).data; let both = 0, either = 0;
        for (let i = 0; i < on.length; i++) { const v = bd[i * 4] >= 128 ? 1 : 0; if (v && on[i]) both++; if (v || on[i]) either++; }
        const survive = either ? both / either : 0;
        titles.push({ text: b.text, font: b.font || it.meta.font || null, strokePx: +strokePx.toFixed(2), survive: +survive.toFixed(2), tag: !!b.tag, capPx: +(b.cap * k).toFixed(1), inCrop: b.y0 >= cropY && b.y1 <= cropY + cropH && b.x0 >= 0 && b.x1 <= W, edge: Math.min(b.x0, W - b.x1), ratio: +ratio.toFixed(1) });
      }
    }
    // the study's rules: title share of the crop, sharpness, subject size / cover / separation
    let titleShare = null, sharp = null, subj = null;
    {
      const full = canvas(W, H), fg = full.getContext('2d'); fg.drawImage(img, 0, 0);
      const sb = it.meta?.subject, [sx0, sy0, sx1, sy1] = sb || [0, cropY, W, cropY + cropH];
      const x0 = Math.max(0, Math.round(sx0)), y0 = Math.max(0, Math.round(sy0)), w = Math.max(8, Math.min(W, Math.round(sx1)) - x0), h = Math.max(8, Math.min(H, Math.round(sy1)) - y0);
      // sharpness: crisp edges over the noise. |dL/dx| at half size inside the subject (outside the title), and the gap between
      // its 99.5th and 90th percentiles (0-255): strong edges stay steep only in a sharp picture, while tape snow raises the
      // typical gradient without making edges. Horizontal only, so the scanlines add nothing.
      // Calibrated on a mascot close-up: the tape-resolution frame 41, the same frame at full resolution 66.
      const hw2 = Math.max(8, Math.round(w / 2)), hh2 = Math.max(8, Math.round(h / 2)), half = canvas(hw2, hh2), hg = half.getContext('2d');
      hg.imageSmoothingQuality = 'high'; hg.drawImage(full, x0, y0, w, h, 0, 0, hw2, hh2);
      const L = lumaOf(hg.getImageData(0, 0, hw2, hh2).data), gs = [];
      const words = (it.meta?.boxes || []).map((b) => [b.x0 - 20, b.y0 - 20, b.x1 + 20, b.y1 + 20]);
      for (let y = 0; y < hh2; y++) for (let x = 1; x < hw2 - 1; x++) {
        const fx = x0 + x * 2, fy = y0 + y * 2;
        if (words.some(([a, b, c, d]) => fx >= a && fx <= c && fy >= b && fy <= d)) continue;
        gs.push(Math.abs(L[y * hw2 + x + 1] - L[y * hw2 + x - 1]) * 255);
      }
      gs.sort((a, b) => a - b);
      sharp = gs.length ? gs[Math.floor(gs.length * 0.995)] - gs[Math.floor(gs.length * 0.9)] : 0;
      if (it.meta) {
        const tb = it.meta.boxes.filter((b) => !b.tag);
        titleShare = tb.reduce((a, b) => a + Math.max(0, b.x1 - b.x0) * Math.max(0, Math.min(b.y1, cropY + cropH) - Math.max(b.y0, cropY)), 0) / (W * cropH);
        if (sb) {
          const area = (sx1 - sx0) * (Math.min(sy1, cropY + cropH) - Math.max(sy0, cropY));
          const over = tb.reduce((a, b) => a + Math.max(0, Math.min(b.x1, sx1) - Math.max(b.x0, sx0)) * Math.max(0, Math.min(b.y1, sy1) - Math.max(b.y0, sy0)), 0);
          // separation: the subject's mean luma against a ring around it (60 px wide)
          const mean = (d) => { let s = 0; const l = lumaOf(d); for (const v of l) s += v; return s / l.length; };
          const inner = mean(fg.getImageData(x0, y0, w, h).data);
          const R = 60, rx0 = Math.max(0, x0 - R), ry0 = Math.max(0, y0 - R), rx1 = Math.min(W, x0 + w + R), ry1 = Math.min(H, y0 + h + R);
          const outer = (mean(fg.getImageData(rx0, ry0, rx1 - rx0, ry1 - ry0).data) * (rx1 - rx0) * (ry1 - ry0) - inner * w * h) / Math.max(1, (rx1 - rx0) * (ry1 - ry0) - w * h);
          subj = { share: area / (W * cropH), covered: over / Math.max(1, area), sep: (inner + 0.02) / (outer + 0.02) };
        }
      }
    }
    const small = px(draw(img, 0, cropY, W, cropH, 16, 21)); smalls.push(lumaOf(small));
    out.push({ said: it.said, titleShare, sharp, subj, name: it.name, W, H, mean, rms, crushed: crushed / n, colourful, accent, loudShare, concentration, inCrop, squint, titles });
  }
  const pairs = [];
  // Pearson correlation of the 16 px luma tiles: dark covers all differ little in absolute terms, so compare the layout
  const z = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length, sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) || 1; return a.map((v) => (v - m) / sd); };
  const zs = smalls.map((a) => z(Array.from(a)));
  for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) { let s = 0; for (let k = 0; k < zs[i].length; k++) s += zs[i][k] * zs[j][k]; pairs.push([i, j, s / zs[i].length]); }
  // the sheet: per cover a row of grid tile (x1 and x2 to read it), shelf, feed, grey crop
  const rows = [];
  for (const it of items) rows.push(await load(it.url));
  const rowH = 560, sheet = canvas(1500, rowH * rows.length + 40), g = sheet.getContext('2d');
  g.fillStyle = '#16181a'; g.fillRect(0, 0, sheet.width, sheet.height); g.font = '600 18px sans-serif'; g.fillStyle = '#9aa';
  rows.forEach((img, r) => {
    const W = img.width, H = img.height, cropH = Math.min(H, Math.round(W * 4 / 3)), cropY = Math.round((H - cropH) / 2), y = 30 + r * rowH;
    const put = (c, x, label) => { g.drawImage(c, x, y + 22); g.fillStyle = '#9aa'; g.fillText(label, x, y + 14); };
    put(draw(img, 0, 0, W, H, 288, 512), 10, `${items[r].name} · feed`);
    const tile = draw(img, 0, cropY, W, cropH, 130, Math.round(130 * cropH / W));
    // the grid as a phone shows it: three tiles side by side, at real size
    const grid3 = canvas(130 * 3 + 4, tile.height), g3 = grid3.getContext('2d'); g3.fillStyle = '#000'; g3.fillRect(0, 0, grid3.width, grid3.height);
    for (let k = 0; k < 3; k++) { g3.globalAlpha = k === 1 ? 1 : 0.35; g3.drawImage(tile, k * 132, 0); }
    put(grid3, 320, 'profile grid, real size');
    const big = canvas(260, Math.round(260 * cropH / W)), gb = big.getContext('2d'); gb.imageSmoothingEnabled = false; gb.drawImage(tile, 0, 0, big.width, big.height);
    put(big, 740, 'grid tile x2');
    put(draw(img, 0, 0, W, H, 160, 284), 1020, 'shorts shelf');
    const grey = draw(img, 0, cropY, W, cropH, 260, Math.round(260 * cropH / W)), gg = grey.getContext('2d'); gg.globalCompositeOperation = 'saturation'; gg.fillStyle = '#000'; gg.fillRect(0, 0, 260, grey.height);
    put(grey, 1200, 'values (grey)');
  });
  return { out, pairs, sheet: sheet.toDataURL('image/png') };
}, items);
await browser.close();

const sheet = sheetOut || files[0].replace(/\.png$/i, '-check.png');
fs.writeFileSync(sheet, Buffer.from(res.sheet.split(',')[1], 'base64'));

const mark = { PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL' }, ranking = [];
for (const r of res.out) {
  const checks = [], fix = [];
  const add = (lvl, name, val, why) => { checks.push([lvl, name, val]); if (lvl !== 'PASS' && why) fix.push(why); };
  add(r.rms >= 0.2 ? 'PASS' : r.rms >= 0.14 ? 'WARN' : 'FAIL', 'value contrast', `RMS ${r.rms.toFixed(2)} (≥0.20)`, 'more light/dark separation: brighten the subject (glow, light, brightness) or darken the backdrop');
  add(r.mean >= 0.1 ? 'PASS' : r.mean >= 0.07 ? 'WARN' : 'FAIL', 'darkness', `mean ${r.mean.toFixed(2)}, crushed ${(100 * r.crushed).toFixed(0)}%`, 'too dark for a phone in daylight: lift the subject (punch.brightness) and keep the black only around it');
  if (r.crushed > 0.45) add('WARN', 'crushed blacks', `${(100 * r.crushed).toFixed(0)}% < 5% luma`, 'half the tile is pure black: zoom in or light the backdrop');
  add(r.colourful >= 25 ? 'PASS' : r.colourful >= 15 ? 'WARN' : 'FAIL', 'colour punch', `colourfulness ${r.colourful.toFixed(0)} (≥25)`, 'add one loud accent (a red title, glowing eyes, a coloured light)');
  add(r.loudShare < 0.02 ? 'WARN' : r.accent >= 0.5 ? 'PASS' : 'WARN', 'one accent', `${(100 * r.loudShare).toFixed(0)}% loud px, top hue ${(100 * r.accent).toFixed(0)}%`, r.loudShare < 0.02 ? 'no saturated colour at all: give the title or the eyes a loud colour' : 'several loud colours fight: keep one accent and mute the rest');
  add(r.inCrop >= 0.75 ? 'PASS' : r.inCrop >= 0.65 ? 'WARN' : 'FAIL', 'in the grid crop', `${(100 * r.inCrop).toFixed(0)}% of the detail inside 3:4`, 'the subject sits outside the profile crop: move it toward the centre');
  add(r.concentration >= 0.38 ? 'PASS' : r.concentration >= 0.3 ? 'WARN' : 'FAIL', 'one subject', `${(100 * r.concentration).toFixed(0)}% of the detail in 15% of the frame (≥38%)`, 'busy frame: zoom in on one thing (a face, the eyes) and darken the rest');
  add(r.squint >= 0.3 ? 'PASS' : r.squint >= 0.2 ? 'WARN' : 'FAIL', 'squint test', `spread ${r.squint.toFixed(2)} at 24 px`, 'at thumbnail distance it is one blob: a bright subject on a dark ground (or the reverse)');
  if (r.titles.length) {
    for (const t of r.titles) {
      const min = t.tag ? 5 : 9;
      add(t.capPx >= min ? 'PASS' : t.capPx >= min * 0.75 ? 'WARN' : 'FAIL', `"${t.text}" size`, `cap ${t.capPx}px in the grid (≥${min})`, `"${t.text}" is too small to read in the grid: bigger, or fewer words`);
      add(t.inCrop ? 'PASS' : 'FAIL', `"${t.text}" in crop`, t.inCrop ? 'inside 3:4' : 'outside the 3:4 crop', `"${t.text}" is cut off in the profile grid: move it toward the centre (y)`);
      if (!t.tag) {
        add(t.strokePx >= 1.6 ? 'PASS' : t.strokePx >= 1.1 ? 'WARN' : 'FAIL', `"${t.text}" stroke`, `${t.strokePx}px in the grid (≥1.6)`, `"${t.text}": the strokes are too thin to survive the grid: a heavier face or weight`);
        add(t.survive >= 0.7 ? 'PASS' : t.survive >= 0.55 ? 'WARN' : 'FAIL', `"${t.text}" letterforms`, `${Math.round(100 * t.survive)}% survive at grid size (≥70%)`, `"${t.text}": the letters blur together small: a plainer, more open face, or fewer letters`);
      }
      add(t.ratio >= 4.5 ? 'PASS' : t.ratio >= 3 ? 'WARN' : 'FAIL', `"${t.text}" contrast`, `${t.ratio}:1 (≥4.5)`, `"${t.text}" melts into the picture: thicker outline, a darker band (shade) or a brighter fill`);
    }
    if (r.titleShare != null) add(r.titleShare <= 0.18 ? 'PASS' : r.titleShare <= 0.26 ? 'WARN' : 'FAIL', 'title share', `${Math.round(100 * r.titleShare)}% of the 3:4 crop (≤18%)`, 'the title shouts over the picture: smaller, so the subject is the one thing to look at');
    if (r.said) {
      const STOP = new Set('ela ele elas eles que uma uns umas para pra nao com sem dos das nos nas seu sua seus suas mas por the and you'.split(' '));
      const norm = (x) => (x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));
      const tw = norm(r.titles.filter((t) => !t.tag).map((t) => t.text).join(' ')), said = new Set(norm(r.said));
      const rep = tw.length ? tw.filter((w) => said.has(w)).length / tw.length : 0;
      add(rep < 0.5 ? 'PASS' : rep < 0.75 ? 'WARN' : 'FAIL', 'adds to the title', `${Math.round(100 * rep)}% of its words are in the title/caption (<50%)`, 'the cover repeats the title: give it the hook the title lacks (a question, the contradiction, a time)');
    }
    const words = r.titles.filter((t) => !t.tag).map((t) => t.text).join(' ').split(/\s+/).filter(Boolean).length;
    add(words <= 4 ? 'PASS' : words <= 6 ? 'WARN' : 'FAIL', 'title length', `${words} words (≤4)`, 'too many words for a glance: cut to the hook (2-4 words)');
  } else add('WARN', 'title', 'no thumb.json: title not checked', null);
  add(r.sharp >= 58 ? 'PASS' : r.sharp >= 46 ? 'WARN' : 'FAIL', 'sharp subject', `edge crispness ${r.sharp.toFixed(0)} (≥58)`, 'the subject is soft: render it at full resolution (thumb mode) and zoom less');
  if (r.subj) {
    add(r.subj.share >= 0.3 ? 'PASS' : r.subj.share >= 0.2 ? 'WARN' : 'FAIL', 'subject size', `${Math.round(100 * r.subj.share)}% of the crop (≥30%)`, 'the subject is small: closer, chin to brow');
    add(r.subj.covered <= 0.08 ? 'PASS' : r.subj.covered <= 0.18 ? 'WARN' : 'FAIL', 'subject uncovered', `${Math.round(100 * r.subj.covered)}% under the title (≤8%)`, 'the title sits on the subject: move it to the empty part of the frame');
    add(r.subj.sep >= 1.8 ? 'PASS' : r.subj.sep >= 1.3 ? 'WARN' : 'FAIL', 'subject stands out', `${r.subj.sep.toFixed(1)}x brighter than around it (≥1.8)`, 'the subject melts into the dark: a rim light, or a darker surround');
  }
  const pts = { PASS: 1, WARN: 0.5, FAIL: 0 }, score = Math.round((100 * checks.reduce((s, c) => s + pts[c[0]], 0)) / checks.length);
  // title legibility, 0-100, continuous (the tie-break between candidates that pass the same checks)
  const tt = r.titles.filter((t) => !t.tag);
  const legible = tt.length ? Math.round(100 * tt.reduce((s, t) => s + 0.3 * Math.min(1, t.capPx / 16) + 0.3 * Math.min(1, t.strokePx / 2.6) + 0.25 * t.survive + 0.15 * Math.min(1, t.ratio / 8), 0) / tt.length) : 0;
  ranking.push({ name: r.name, font: tt[0]?.font, score, legible, fails: checks.filter((c) => c[0] === 'FAIL').length });
  console.log(`\n== ${r.name}  ${r.W}x${r.H}   score ${score}/100`);
  for (const [lvl, name, val] of checks) console.log(`  ${mark[lvl]}  ${name.padEnd(26)} ${val}`);
  if (fix.length) { console.log('  fix:'); for (const f of [...new Set(fix)]) console.log(`   - ${f}`); }
}
if (res.pairs.length) {
  console.log('\n== series (covers side by side should differ)');
  for (const [i, j, r] of res.pairs) console.log(`  ${r < 0.7 ? 'PASS' : 'WARN'}  ${res.out[i].name} vs ${res.out[j].name}: layout correlation ${r.toFixed(2)} (<0.70)${r < 0.7 ? '' : ': too alike in the grid, change the frame or the framing'}`);
}
console.log(`\nsheet: ${sheet}`);
if (PICK && ranking.length > 1) {
  ranking.sort((a, b) => a.fails - b.fails || b.score - a.score || b.legible - a.legible);
  console.log('\n== pick (fewest FAILs, then score, then title legibility)');
  ranking.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(44)} score ${String(r.score).padStart(3)}  legibility ${String(r.legible).padStart(3)}${r.fails ? `  ${r.fails} FAIL` : ''}${r.font ? `  (${r.font})` : ''}`));
  const best = ranking[0];
  console.log(`\nbest: ${best.name}${best.font ? ` — font ${best.font}` : ''}. The numbers judge legibility in the grid, not mood: look at the top three before choosing.`);
}
