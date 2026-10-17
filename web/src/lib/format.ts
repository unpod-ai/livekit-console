// protobuf JSON encodes int64 as strings; timestamps are unix seconds (rooms/participants) or nanoseconds (egress).
export function fromSeconds(v?: string | number): string {
  const n = Number(v);
  return n ? new Date(n * 1000).toLocaleString() : '—';
}

export function fromNanos(v?: string | number): string {
  const n = Number(v);
  return n ? new Date(n / 1e6).toLocaleString() : '—';
}

export function durationNanos(start?: string | number, end?: string | number): string {
  const s = Number(start);
  if (!s) return '—';
  const e = Number(end) || Date.now() * 1e6;
  const secs = Math.max(0, Math.round((e - s) / 1e9));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export const statusLabel = (s?: string): string => (s ?? '').replace(/^(EGRESS|INGRESS|ENDPOINT)_/, '').toLowerCase() || '—';

// History data comes from the collector in unix milliseconds.
export const fromMs = (v?: number | null): string => (v ? new Date(v).toLocaleString() : '—');

export function durationMs(start?: number | null, end?: number | null): string {
  if (!start) return '—';
  const secs = Math.max(0, Math.round(((end ?? Date.now()) - start) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

// protobuf JSON gives enum names; the numeric forms are accepted too in case the SDK emits them.
const KINDS: Record<string, string> = { '0': 'Standard', '1': 'Ingress', '2': 'Egress', '3': 'SIP', '4': 'Agent' };
export const kindLabel = (k?: string | null): string => {
  const name = k ? (KINDS[k] ?? k.charAt(0) + k.slice(1).toLowerCase()) : 'Standard';
  return name.toUpperCase() === 'SIP' ? 'SIP' : name;
};

export const fmtNum = (n?: number | null): string => (n == null ? '—' : n.toLocaleString());

export function fmtMs(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export function fmtBytes(n?: number | null): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function relTime(ms?: number | null): string {
  if (!ms) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Precise local time with milliseconds, like the Cloud event tables. */
export function fromMsPrecise(v?: number | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })} ${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
