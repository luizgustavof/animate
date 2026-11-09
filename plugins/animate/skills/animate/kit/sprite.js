// =====================================================================
//  kit/sprite.js — a cache of offscreen canvases capped by memory, not by count.
//  A still drawing (a set, a prop that does not move) is painted once into a canvas and then costs one drawImage.
//  The cap counts bytes (w * h * 4): a full 1080x1920 set at 3x is ~90 MB, a small prop ~1 MB, so a count limit either
//  overflows the page's memory or throws away cheap sprites. Least recently used goes first.
//  Every export worker is a page with its own cache, so this cap times the worker count is the export's set memory.
//    const c = SPRITE_CACHE.get(id, w, h, (g) => { ...paint into the 2D context g... });
// =====================================================================
const SPRITE_CACHE = (() => {
  const MAX_BYTES = 300 * 2 ** 20;
  const map = new Map();   // insertion order = recency: a hit is moved to the end
  let bytes = 0;
  function evict() {
    while (bytes > MAX_BYTES && map.size > 1) {
      const [k, c] = map.entries().next().value;
      map.delete(k); bytes -= c.width * c.height * 4;
      c.width = c.height = 0;   // give the pixels back now, not at the next GC
    }
  }
  return {
    get(id, w, h, paint) {
      let c = map.get(id);
      if (c) { map.delete(id); map.set(id, c); return c; }
      c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
      c.__probeId = id;   // telemetry (kit/core.js probes): blits of this canvas are tracked by id
      paint(c.getContext('2d'));
      map.set(id, c); bytes += c.width * c.height * 4;
      evict();
      return c;
    },
    get bytes() { return bytes; },
    get size() { return map.size; },
    clear() { for (const c of map.values()) c.width = c.height = 0; map.clear(); bytes = 0; },
  };
})();
