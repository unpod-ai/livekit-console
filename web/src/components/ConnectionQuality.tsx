import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { useMe } from '../lib/me';
import { useRange } from '../lib/range';
import { fromMsPrecise } from '../lib/format';
import { type Json } from '../lib/api';
import { AreaChart, PALETTE } from './Charts';
import { DataTable } from './DataTable';
import { Alert, Panel, ServerPager } from './ui';

// Preserve shareable diagnostic filters when changing detail tabs.
export function useDiagnosticTab<T extends string>(fallback: T, valid: readonly T[]): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as T;
  return [valid.includes(raw) ? raw : fallback, tab => setParams(old => {
    const next = new URLSearchParams(old);
    if (tab === fallback) next.delete('tab'); else next.set('tab', tab);
    return next;
  })];
}

export type DiagnosticData = { rows: Json[]; total: number; limit: number; offset: number; from: number; to: number; lifecycle: Json[]; collectionEnabled: boolean; retentionDays: number };

// Relative bounds are evaluated on every fetch, including automatic refresh.
export function useDiagnostics(kind: 'quality' | 'services' | 'sip', scope: Record<string, string> = {}) {
  const me = useMe(), admin = me.data?.role === 'admin';
  const { hours } = useRange();
  const [params, setParams] = useSearchParams();
  const prefix = kind === 'quality' ? 'quality' : kind === 'sip' ? 'sip' : 'service';
  const offsetKey = `${prefix}Offset`, rangeKey = `${prefix}Hours`;
  const explicitRange = params.has('from') || params.has('to');
  const sameRange = explicitRange || params.get(rangeKey) === String(hours);
  const offset = sameRange && /^\d+$/.test(params.get(offsetKey) ?? '') ? Math.min(1000000, Number(params.get(offsetKey))) : 0;
  const query = new URLSearchParams({ limit: '200', offset: String(offset) });
  for (const [key, value] of Object.entries(scope)) if (value) query.set(key, value);
  const from = params.get('from'), to = params.get('to');
  const result = useApi<DiagnosticData>(['diagnostics', kind, query.toString(), hours, from, to], () => {
    const next = new URLSearchParams(query), now = Date.now();
    next.set('from', from ?? String(Math.max(0, (to ? Number(to) : now) - hours * 3600000)));
    next.set('to', to ?? String(now));
    return `/diagnostics/${kind}?${next}`;
  }, { enabled: admin });
  function filter(key: string, value: string) {
    setParams(old => {
      const next = new URLSearchParams(old);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== offsetKey) next.delete(offsetKey);
      if (['participantSid', 'trackSid', 'reporterId', 'direction'].includes(key)) next.delete('qualityStream');
      next.set(rangeKey, String(hours));
      return next;
    });
  }
  return { ...result, admin, checking: me.isPending, params, filter, offsetKey };
}

export function DiagnosticCoverage({ data }: { data?: DiagnosticData }) {
  if (!data) return null;
  return <>
    <Alert>Monitoring coverage: submitted observations only · Retention {data.retentionDays} days · {fromMsPrecise(data.from)} – {fromMsPrecise(data.to)}. No observations does not establish service health or absence of failures.</Alert>
    {!data.collectionEnabled && <Alert kind="warn">Diagnostics collection is configured off. Retained observations remain available until expiry.</Alert>}
    {data.total > data.rows.length && <Alert kind="warn">Partial page: {data.offset + 1}–{data.offset + data.rows.length} of {data.total} observations, newest first. Charts and stream/instance choices cover this page only. Use pagination or narrow the time range; these are not complete range plots.</Alert>}
  </>;
}

export function DiagnosticPager({ data, onChange }: { data?: DiagnosticData; onChange: (offset: number) => void }) {
  return data ? <ServerPager offset={data.offset} limit={data.limit} total={data.total} onChange={onChange} /> : null;
}

export function DiagnosticMetricChart({ rows, keys, title, unit }: { rows: Json[]; keys: string[]; title: string; unit: string }) {
  const samples = [...rows].sort((a, b) => a.at - b.at);
  const measured = samples.some(row => keys.some(key => typeof row.metrics?.[key] === 'number'));
  const start = samples[0]?.at ?? 0, end = samples[samples.length - 1]?.at ?? start;
  const bucketMs = Math.max(1, Math.ceil((end - start) / Math.max(1, Math.min(100, samples.length) - 1)));
  // Keep the last actual observation in a display bucket; never sum rates or fill missing metrics.
  const buckets = new Map<number, Record<string, number | null>>();
  for (const row of samples) {
    const t = Math.floor(row.at / bucketMs) * bucketMs;
    buckets.set(t, Object.fromEntries([['t', t], ...keys.map(key => [key, typeof row.metrics?.[key] === 'number' ? row.metrics[key] : null])]));
  }
  const values = [...buckets.values()];
  const measuredBuckets = values.filter(row => keys.some(key => row[key] != null));
  return <Panel title={`${title} (${unit})`}>
    {measuredBuckets.length === 1 ? <div style={{ padding: 20 }}>Only one measured display point: {keys.map(key => `${key}: ${measuredBuckets[0][key] == null ? 'Not reported' : `${measuredBuckets[0][key]} ${unit}`}`).join(' · ')}. More observations are needed for a trend.</div> : measured ? <><AreaChart data={values} series={keys.map((key, i) => ({ key, label: key, color: [PALETTE.cyan, PALETTE.purple, PALETTE.orange][i % 3] }))} bucketMs={bucketMs} fill="none" gaps format={n => `${Number(n.toPrecision(4))} ${unit}`} /><div className="muted" style={{ padding: 12 }}>Page observations · last sample per display bucket · missing values are gaps. Exact measurements are listed below.</div></> : <div className="empty">No measured {title.toLowerCase()} on this page.</div>}
  </Panel>;
}

const streamKey = (r: Json) => JSON.stringify([r.participantSid, r.reporterId, r.trackSid ?? '', r.direction, r.statsId ?? '']);
export function ConnectionQuality({ sid, participantSid }: { sid: string; participantSid?: string }) {
  const [params] = useSearchParams();
  const trackSid = params.get('trackSid') ?? '', reporterId = params.get('reporterId') ?? '', direction = params.get('direction') ?? '';
  const result = useDiagnostics('quality', { roomSid: sid, participantSid: participantSid ?? params.get('participantSid') ?? '', trackSid, reporterId, direction });
  const { data, filter } = result;
  const streams = new Map((data?.rows ?? []).map(r => [streamKey(r), r]));
  const requested = params.get('qualityStream') ?? '';
  const measuredTrack = (data?.rows ?? []).find(r => r.trackSid &&
    ['bitrateBps', 'packetsLost', 'packetsReceived', 'packetLossPct', 'jitterMs', 'rttMs', 'fps'].some(key => typeof r.metrics?.[key] === 'number'));
  const selected = requested || (measuredTrack ? streamKey(measuredTrack) : streams.keys().next().value) || '';
  const rows = (data?.rows ?? []).filter(r => streamKey(r) === selected);
  if (result.checking) return <Alert>Checking access…</Alert>;
  if (!result.admin) return <Alert>Connection quality requires an administrator account.</Alert>;
  return <>
    <Alert>Native RTC measurements and connection events submitted by reporters. SDK quality is an indicator, not a packet-loss measurement. One exact participant/reporter/track/direction/stats ID stream is plotted at a time.</Alert>
    <DiagnosticCoverage data={data} />
    {result.error && <Alert kind="bad">{(result.error as Error).message}</Alert>}
    <Panel title="Connection quality">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 14 }}>
        {(!participantSid ? ['participantSid', 'trackSid', 'reporterId', 'direction'] : ['trackSid', 'reporterId', 'direction']).map(key => <label key={key} style={{ flex: '1 1 180px', minWidth: 0 }}>{key}<input className="input" maxLength={150} value={params.get(key) ?? ''} onChange={e => filter(key, e.target.value)} /></label>)}
        <label style={{ flex: '1 1 300px', minWidth: 0 }}>Exact stream<select className="select" value={selected} onChange={e => filter('qualityStream', e.target.value)}>
          {!selected && <option value="">No streams on this page</option>}
          {requested && !streams.has(requested) && <option value={requested}>Selected stream has no observations on this page</option>}
          {[...streams].map(([key, r]) => <option key={key} value={key}>{r.participantSid} · {r.reporterId} · {r.trackSid ?? 'connection (no track)'} · {r.direction} · {r.statsId ?? 'no stats ID'}</option>)}
        </select></label>
      </div>
      <DiagnosticPager data={data} onChange={n => filter(result.offsetKey, String(n))} />
    </Panel>
    <div className="grid-2">
      <DiagnosticMetricChart rows={rows} keys={['bitrateBps']} title="Bandwidth" unit="bps" />
      <DiagnosticMetricChart rows={rows} keys={['packetLossPct']} title="Packet loss" unit="%" />
      <DiagnosticMetricChart rows={rows} keys={['packetsLost', 'packetsReceived']} title="Packet counters" unit="packets" />
      <DiagnosticMetricChart rows={rows} keys={['jitterMs', 'rttMs']} title="Jitter / RTT" unit="ms" />
      <DiagnosticMetricChart rows={rows} keys={['fps']} title="Frame rate" unit="fps" />
      <DiagnosticMetricChart rows={rows} keys={['reconnects']} title="Reconnects" unit="count" />
    </div>
    <Panel title="Selected stream observations (newest first)"><DataTable rows={rows} loading={result.isLoading} search={false} pageSize={false} rowKey={r => r.id} empty={{ title: 'No observations for this stream on this page' }} cols={[
      { key: 'at', header: 'Time', cell: r => fromMsPrecise(r.at) },
      { key: 'event', header: 'Connection event', cell: r => r.event ?? 'Not reported' },
      { key: 'quality', header: 'SDK quality indicator', cell: r => r.quality ?? 'Not reported' },
      { key: 'reason', header: 'Reason', cell: r => r.reason ?? 'Not reported', wrap: true },
      { key: 'metrics', header: 'Measured metrics', wrap: true, cell: r => Object.entries(r.metrics ?? {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'No measurements' },
    ]} /></Panel>
    <Panel title="Room lifecycle events (all participants)"><DataTable rows={data?.lifecycle} loading={result.isLoading} search={false} pageSize={50} rowKey={r => String(r.id)} empty={{ title: 'No room lifecycle events in this range' }} cols={[
      { key: 'ts', header: 'Time', cell: r => fromMsPrecise(r.ts) }, { key: 'event', header: 'Event', cell: r => r.type }, { key: 'identity', header: 'Participant identity', cell: r => r.identity ?? 'Room' },
      { key: 'participant', header: 'Participant SID', cell: r => typeof r.participantSid === 'string' && r.participantSid.startsWith('PA_') ? <Link className="mono" to={`/sessions/${encodeURIComponent(sid)}/participants/${encodeURIComponent(r.participantSid)}`}>{r.participantSid}</Link> : r.participantSid ?? 'Not reported' },
      { key: 'reason', header: 'Disconnect reason', cell: r => r.reason ?? 'Not reported', wrap: true },
    ]} /><div className="muted" style={{ padding: 12 }}>Room-wide webhook history, including other participants. The API returns at most 500 lifecycle events, oldest first; this list may be capped.</div></Panel>
  </>;
}
