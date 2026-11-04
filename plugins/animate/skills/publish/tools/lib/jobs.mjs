// Long work for the studio (uploads, AI writing, renders): each job gets an id, an AbortController and an event stream.
// Subscribers (the SSE route) receive every event; finished jobs are kept a while so a reloaded page can still read the result.
import crypto from 'node:crypto';

const jobs = new Map();          // id → { id, kind, target, status, events, result, error, controller, startedAt, endedAt }
const listeners = new Set();     // (event) => void
const KEEP_MS = 30 * 60e3, MAX_EVENTS = 200;

function broadcast(ev) {
  for (const fn of listeners) { try { fn(ev); } catch {} }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// the public view of a job: no controller, the last events only
const view = (j) => ({
  id: j.id, kind: j.kind, target: j.target, status: j.status, result: j.result ?? null, error: j.error ?? null,
  startedAt: j.startedAt, endedAt: j.endedAt ?? null, last: j.events.at(-1) ?? null,
});

export function list() {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.endedAt && now - j.endedAt > KEEP_MS) jobs.delete(id);
  return [...jobs.values()].map(view);
}

export const get = (id) => (jobs.has(id) ? view(jobs.get(id)) : null);

// the running job of this kind on this target, if any (one upload per piece, one writer per piece)
export const running = (kind, target) => [...jobs.values()].find(j => j.kind === kind && j.target === target && j.status === 'running');

// fn({ signal, emit }) → result. emit(event) adds { job, kind, target } and goes to every subscriber.
// { replace: true } aborts a running job of the same kind and target instead of returning it (sign-ins: a closed page or a
// reloaded studio leaves one waiting). Never used for uploads, where the running one must win.
export function start(kind, target, fn, { replace = false } = {}) {
  const existing = running(kind, target);
  if (existing && !replace) return view(existing);
  if (existing) { existing.controller.abort(); existing.status = 'cancelled'; }
  const j = { id: crypto.randomUUID(), kind, target, status: 'running', events: [], controller: new AbortController(), startedAt: Date.now() };
  jobs.set(j.id, j);
  const emit = (e) => {
    const ev = { job: j.id, kind, target, at: Date.now(), ...e };
    if (e.type !== 'progress') { j.events.push(ev); if (j.events.length > MAX_EVENTS) j.events.shift(); }
    else j.events[j.events.length - 1]?.type === 'progress' ? (j.events[j.events.length - 1] = ev) : j.events.push(ev);
    broadcast(ev);
  };
  emit({ type: 'started' });
  Promise.resolve()
    .then(() => fn({ signal: j.controller.signal, emit }))
    .then((result) => { j.status = 'done'; j.result = result ?? null; })
    .catch((err) => { j.status = j.controller.signal.aborted ? 'cancelled' : 'failed'; j.error = err?.message || String(err); })
    .finally(() => { j.endedAt = Date.now(); emit({ type: 'finished', status: j.status, result: j.result ?? null, error: j.error ?? null }); });
  return view(j);
}

export function cancel(id) {
  const j = jobs.get(id);
  if (!j || j.status !== 'running') return false;
  j.controller.abort();
  return true;
}
