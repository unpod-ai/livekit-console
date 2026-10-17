import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, lk, type Json, type LkService } from './api';
import { useLive } from './live';
import { useToast } from './toast';

/** GET query that follows the global auto-refresh setting. */
export function useApi<T = any>(key: QueryKey, path: string, opts: { live?: boolean; enabled?: boolean } = {}) {
  const { interval } = useLive();
  return useQuery<T>({
    queryKey: key,
    queryFn: () => api<T>(path),
    refetchInterval: opts.live !== false && interval ? interval : false,
    enabled: opts.enabled,
  });
}

/** List call against LiveKit (Twirp lists reply `{ items: [...] }`, omitting the key when empty). */
export function useLkList(service: LkService, method: string, opts: { live?: boolean; body?: unknown } = {}) {
  const { interval } = useLive();
  return useQuery<Json[]>({
    queryKey: ['lk', service, method, opts.body ?? null],
    queryFn: async () => ((await lk(service, method, opts.body ?? {})).items ?? []) as Json[],
    refetchInterval: opts.live && interval ? interval : false,
  });
}

/** Mutation with toast feedback and cache invalidation. */
export function useMutate<V = void, R = unknown>(fn: (v: V) => Promise<R>, opts: { invalidate?: QueryKey[]; success?: string | ((r: R) => string) } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      (opts.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (opts.success) toast('ok', typeof opts.success === 'function' ? opts.success(r) : opts.success);
    },
    onError: (e) => toast('bad', e instanceof Error ? e.message : String(e)),
  });
}

export const splitList = (s: string): string[] => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
export const joinList = (a?: string[]): string => (a ?? []).join(', ');
