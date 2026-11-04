// Server state, only through TanStack Query: cached, deduplicated, cancelled when a screen unmounts (the signal reaches fetch).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { LiveJob } from './events';
import type { Meta } from './types';

export const useStudio = () => useQuery({ queryKey: ['state'], queryFn: ({ signal }) => api.state(signal), staleTime: 5_000 });
export const usePiece = (slug: string) => useQuery({ queryKey: ['piece', slug], queryFn: ({ signal }) => api.piece(slug, signal), staleTime: 5_000 });
export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: ({ signal }) => api.stats(signal), staleTime: 60_000 });
export const useNextSlot = (channel: string | null) => useQuery({
  queryKey: ['slot', channel], enabled: !!channel, queryFn: ({ signal }) => api.nextSlot(channel!, signal), staleTime: 30_000,
});

// the live view of one job, or of the running job of a kind on a target
export const useJobs = () => useQuery<Record<string, LiveJob>>({ queryKey: ['jobs'], queryFn: () => ({}), staleTime: Infinity, gcTime: Infinity, initialData: {} }).data;
export function useJobFor(kind: LiveJob['kind'], target: string): LiveJob | null {
  const all = useJobs();
  let found: LiveJob | null = null;
  for (const j of Object.values(all)) if (j.kind === kind && j.target === target && (!found || j.status === 'running')) found = j;
  return found;
}

export function useSaveMeta(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meta: Meta) => api.saveMeta(slug, meta),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['piece', slug] }); qc.invalidateQueries({ queryKey: ['state'] }); },
  });
}
export const useWriteWords = (slug: string) => useMutation({ mutationFn: () => api.writeWords(slug) });
export const usePublish = (slug: string) => useMutation({ mutationFn: (o: { platforms: string[]; at: string | null; privacy?: string }) => api.publish(slug, o) });
export const useUnpublish = (slug: string) => useMutation({ mutationFn: (key: string) => api.unpublish(slug, key) });
export const useConnect = () => useMutation({ mutationFn: (o: { channel: string; platform: string }) => api.connect(o.channel, o.platform) });
export const useBatchPlan = (enabled: boolean) => useQuery({ queryKey: ['batch'], enabled, queryFn: ({ signal }) => api.batchPlan(signal), staleTime: 10_000 });
export const useBatch = () => useMutation({ mutationFn: (slugs: string[]) => api.batch(slugs) });
export const useCancel = () => useMutation({ mutationFn: (id: string) => api.cancel(id) });
