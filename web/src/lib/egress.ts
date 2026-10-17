import type { Json } from './api';

export type EgressFile = { name: string; location: string; size: number | null; durationMs: number | null };

const REQUEST_KEYS = ['roomComposite', 'participant', 'trackComposite', 'track', 'web'];

/** Where an egress writes to, read from the request that started it. Mirrors the server's history logic. */
export function egressDestination(e: Json): string {
  const req = REQUEST_KEYS.map((k) => e[k]).find(Boolean) ?? {};
  const out = req.fileOutputs?.[0] ?? req.file ?? req.segmentOutputs?.[0] ?? {};
  if (out.s3?.bucket) return `s3://${out.s3.bucket}`;
  if (out.gcp?.bucket) return `gs://${out.gcp.bucket}`;
  if (out.azure?.containerName) return `azure://${out.azure.containerName}`;
  if (out.aliOSS?.bucket) return `oss://${out.aliOSS.bucket}`;
  if (req.streamOutputs?.length || req.stream) return 'stream';
  return out.filepath || e.fileResults?.length ? 'local' : '—';
}

const nsToMs = (v?: string) => (v ? Math.round(Number(v) / 1e6) : null);

export function egressFiles(e: Json): EgressFile[] {
  const files = (e.fileResults ?? []).map((f: Json) => ({ name: f.filename ?? '', location: f.location ?? '', size: f.size ? Number(f.size) : null, durationMs: nsToMs(f.duration) }));
  const segs = (e.segmentResults ?? []).map((f: Json) => ({ name: f.playlistName ?? '', location: f.playlistLocation ?? '', size: f.size ? Number(f.size) : null, durationMs: nsToMs(f.duration) }));
  return [...files, ...segs].filter((f) => f.name || f.location);
}

export const isUrl = (s: string) => /^https?:\/\//i.test(s);
export const baseName = (s: string) => s.split('/').filter(Boolean).pop() ?? s;
