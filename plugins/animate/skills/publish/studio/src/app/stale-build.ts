// A tab opened before a rebuild still points at the old hashed chunks, which no longer exist.
// Loading one fails ("Failed to fetch dynamically imported module"); a reload picks up the new index.html.
// Guarded so a genuinely broken build can't reload forever: at most once per 10 s.

const KEY = 'studio:stale-reload';

export function isStaleChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg);
}

/** Reloads the page if allowed; returns false when a reload just happened (let the error show). */
export function reloadForNewBuild(): boolean {
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 10_000) return false;
  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
  return true;
}

// Vite's own preload helper reports failures here (CSS / nested chunk preloads)
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewBuild()) event.preventDefault();
});
