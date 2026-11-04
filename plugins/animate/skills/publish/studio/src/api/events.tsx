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
  events: JobEvent[];           // non-progress events, bounded
}

const MAX = 60;
const JOBS = ['jobs'] as const;

function apply(qc: QueryClient, ev: JobEvent) {
  qc.setQueryData<Record<string, LiveJob>>(JOBS, (prev = {}) => {
    const cur: LiveJob = prev[ev.job] ?? {
      id: ev.job, kind: ev.kind, target: ev.target, status: 'running', error: null, result: null, log: [], progress: null, events: [],
    };
    const next: LiveJob = { ...cur };
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
