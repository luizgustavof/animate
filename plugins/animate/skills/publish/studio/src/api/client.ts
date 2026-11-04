// The one door to tools/studio.mjs. The token comes in the opening URL once (?t=…), is kept in localStorage and
// removed from the address bar, then rides every request as a header (media URLs carry it as ?t= because <video> can't set headers).
import type { BatchItem, Checks, Job, Meta, PieceDetail, StatRow, StudioState } from './types';

const KEY = 'studio-token';   // localStorage: the server keeps one token per computer, so it survives restarts

function readToken(): string {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('t');
  if (fromUrl) {
    localStorage.setItem(KEY, fromUrl);
    url.searchParams.delete('t');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    return fromUrl;
  }
  return localStorage.getItem(KEY) || '';
}

export const token = readToken();

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    signal,
    headers: { 'x-studio-token': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `erro ${res.status}`, res.status);
  return data as T;
}

export const media = {
  poster: (slug: string, w = 360) => `/media/${encodeURIComponent(slug)}/poster?w=${w}&t=${encodeURIComponent(token)}`,
  video: (slug: string) => `/media/${encodeURIComponent(slug)}/video?t=${encodeURIComponent(token)}`,
};

export const api = {
  state: (signal?: AbortSignal) => call<StudioState>('GET', '/api/state', undefined, signal),
  piece: (slug: string, signal?: AbortSignal) => call<PieceDetail>('GET', `/api/pieces/${encodeURIComponent(slug)}`, undefined, signal),
  check: (slug: string, meta: Meta, opts: { at?: string | null; privacy?: string } = {}, signal?: AbortSignal) =>
    call<Checks>('POST', `/api/pieces/${encodeURIComponent(slug)}/check`, { meta, ...opts }, signal),
  saveMeta: (slug: string, meta: Meta) => call<{ meta: Meta; checks: Checks }>('PUT', `/api/pieces/${encodeURIComponent(slug)}/meta`, { meta }),
  writeWords: (slug: string) => call<Job>('POST', `/api/pieces/${encodeURIComponent(slug)}/words`, {}),
  unpublish: (slug: string, key: string) => call<Job>('POST', `/api/pieces/${encodeURIComponent(slug)}/unpublish`, { key, confirm: slug }),
  publish: (slug: string, opts: { platforms: string[]; at: string | null; privacy?: string }) =>
    call<Job>('POST', `/api/pieces/${encodeURIComponent(slug)}/publish`, opts),
  cancel: (id: string) => call<{ cancelled: boolean }>('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`, {}),
  nextSlot: (channel: string, signal?: AbortSignal) => call<Record<string, string | null>>('GET', `/api/channels/${encodeURIComponent(channel)}/next-slot`, undefined, signal),
  saveTikTokApp: (clientKey: string, clientSecret: string) => call<{ ok: true }>('PUT', '/api/platforms/tiktok/app', { clientKey, clientSecret }),
  connect: (channel: string, platform: string) => call<Job>('POST', `/api/channels/${encodeURIComponent(channel)}/connect/${platform}`, {}),
  batchPlan: (signal?: AbortSignal) => call<BatchItem[]>('GET', '/api/batch', undefined, signal),
  batch: (slugs: string[]) => call<Job>('POST', '/api/batch', { slugs }),
  stats: (signal?: AbortSignal) => call<StatRow[]>('GET', '/api/stats', undefined, signal),
  refreshStats: () => call<Job>('POST', '/api/stats/refresh', {}),
};
