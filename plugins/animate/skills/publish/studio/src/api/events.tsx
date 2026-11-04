// The single live stream from the server. One EventSource for the whole app, opened by <LiveEvents> and closed on unmount;
// every job event lands in the query cache under ['jobs'] (by id), and a finished job invalidates what it changed. Components
// read progress with useJob / useJobFor and never open streams of their own.
import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { token } from './client';
import type { Job, JobEvent } from './types';

export interface LiveJob {
  id: string;
  kind: Job['kind'];
  target: string;
  status: Job['status'];
  error: string | null;
  result: unknown;
  log: string[];                // the human lines, newest last (bounded)
  progress: { sent: number; total: number; mbps: number } | null;
  uploads: Record<string, Upload>;   // "<slug>:<platform>" → where that upload stands (one job can send several)
  events: JobEvent[];           // non-progress events, bounded
}

// one platform's upload inside a publish (or batch) job
export interface Upload {
  slug: string;
  platform: string;
  phase: 'preparing' | 'sending' | 'processing' | 'done' | 'failed';
  prep?: number;                // 0..1 while the light copy is made (TikTok)
  sent: number;
  total: number;
  mbps: number;
  startedAt: number;
  error?: string;
  entry?: Record<string, unknown>;
}

function track(cur: LiveJob, ev: JobEvent): Record<string, Upload> | null {
  const platform = typeof ev.platform === 'string' ? ev.platform : null;
  if (!platform || !String(ev.type).startsWith('publish:')) return null;
  const slug = typeof ev.slug === 'string' ? ev.slug : cur.target;
  const key = `${slug}:${platform}`;
  const was = cur.uploads[key];
  const base: Upload = was ?? { slug, platform, phase: 'sending', sent: 0, total: 0, mbps: 0, startedAt: ev.at };
  let next: Upload | null = null;
  if (ev.type === 'publish:preparing') next = { ...base, phase: 'preparing', prep: Number(ev.done) || 0 };
  else if (ev.type === 'publish:item') next = { ...base, phase: 'sending', startedAt: ev.at };
  else if (ev.type === 'publish:progress') {
    const sent = Number(ev.sent), total = Number(ev.total);
    next = { ...base, sent, total, mbps: Number(ev.mbps), phase: total && sent >= total ? 'processing' : 'sending' };
  } else if (ev.type === 'publish:done') next = { ...base, phase: 'done', sent: base.total || base.sent, entry: (ev.entry as Record<string, unknown>) ?? undefined };
  else if (ev.type === 'publish:failed') next = { ...base, phase: 'failed', error: String(ev.error ?? '') };
  return next ? { ...cur.uploads, [key]: next } : null;
}

const MAX = 60;
const JOBS = ['jobs'] as const;

function apply(qc: QueryClient, ev: JobEvent) {
  qc.setQueryData<Record<string, LiveJob>>(JOBS, (prev = {}) => {
    const cur: LiveJob = prev[ev.job] ?? {
      id: ev.job, kind: ev.kind, target: ev.target, status: 'running', error: null, result: null, log: [], progress: null, uploads: {}, events: [],
    };
    const next: LiveJob = { ...cur };
    const up = track(cur, ev);
    if (up) next.uploads = up;
    if (ev.type === 'publish:progress') {
      next.progress = { sent: Number(ev.sent), total: Number(ev.total), mbps: Number(ev.mbps) };
    } else {
      next.events = [...cur.events, ev].slice(-MAX);
      if (ev.type === 'log' || ev.type === 'publish:log') next.log = [...cur.log, String(ev.message)].slice(-MAX);
      if (ev.type === 'finished') {
        next.status = ev.status as Job['status'];
        next.error = (ev.error as string) ?? null;
        next.result = ev.result ?? null;
      }
    }
    return { ...prev, [ev.job]: next };
  });
  if (ev.type === 'finished' || ev.type === 'publish:done') {
    qc.invalidateQueries({ queryKey: ['state'] });
    if (ev.kind === 'words' || ev.kind === 'publish') qc.invalidateQueries({ queryKey: ['piece', ev.target] });
    if (typeof ev.slug === 'string') qc.invalidateQueries({ queryKey: ['piece', ev.slug] });
    if (ev.kind === 'unpublish') { qc.invalidateQueries({ queryKey: ['piece', String(ev.target).split(':')[0]] }); qc.invalidateQueries({ queryKey: ['slot'] }); qc.invalidateQueries({ queryKey: ['stats'] }); }
    if (ev.kind === 'batch') qc.invalidateQueries({ queryKey: ['batch'] });
    if (ev.kind === 'stats') qc.invalidateQueries({ queryKey: ['stats'] });
  }
}

// jobs the server is still running that this page never saw start (a reload, a second tab): add them from /api/state so
// a sign-in or upload in progress shows as such. Jobs already known are left alone; the stream keeps them current.
export function seedJobs(qc: QueryClient, jobs: Job[]) {
  const known = qc.getQueryData<Record<string, LiveJob>>(JOBS) ?? {};
  const missing = jobs.filter(j => j.status === 'running' && !known[j.id]);
  if (!missing.length) return;
  qc.setQueryData<Record<string, LiveJob>>(JOBS, (prev = {}) => {
    const next = { ...prev };
    for (const j of missing) if (!next[j.id]) next[j.id] = {
      id: j.id, kind: j.kind, target: j.target, status: 'running', error: null, result: null, progress: null, uploads: {},
      log: j.last?.type === 'log' ? [String(j.last.message)] : [], events: j.last ? [j.last] : [],
    };
    return next;
  });
}

// connection state for the little "ao vivo" mark; a tiny external store so no context re-renders the tree
let connected = false;
const subs = new Set<() => void>();
const setConnected = (v: boolean) => { if (connected !== v) { connected = v; subs.forEach(f => f()); } };
export const useLive = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => connected);

export function LiveEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource(`/api/events?t=${encodeURIComponent(token)}`);
    const onJob = (m: MessageEvent<string>) => { try { apply(qc, JSON.parse(m.data) as JobEvent); } catch { /* a malformed line is skipped */ } };
    const onHello = () => setConnected(true);
    const onError = () => setConnected(false);
    es.addEventListener('job', onJob as EventListener);
    es.addEventListener('hello', onHello);
    es.addEventListener('error', onError);
    return () => {
      es.removeEventListener('job', onJob as EventListener);
      es.removeEventListener('hello', onHello);
      es.removeEventListener('error', onError);
      es.close();
      setConnected(false);
    };
  }, [qc]);
  return null;
}
