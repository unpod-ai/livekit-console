import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { useMe } from '../lib/me';
import { fromMsPrecise } from '../lib/format';
import { Alert, Badge, Panel } from './ui';
import { DataTable } from './DataTable';

type Row = { id: string; jobId: string; agentName: string; at: number; level: string; message: string;
  logger: string | null; turnId: string | null; traceId: string | null; spanId: string | null; expiresAt: number };
type Data = { enabled: boolean; retentionDays: number; rows: Row[]; total: number; expired: number; page: number; pageSize: number; jobs: { jobId: string; agentName: string }[] };
export function AgentLogs({ sid }: { sid: string }) {
  const me = useMe(), admin = me.data?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const job = params.get('logJob') ?? params.get('reportJob') ?? '';
  const level = params.get('logLevel') ?? '', q = params.get('logQ') ?? '', page = params.get('logPage') ?? '1';
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const query = new URLSearchParams({ page, ...(job ? { jobId: job } : {}), ...(level ? { level } : {}), ...(q ? { q } : {}) });
  const result = useApi<Data>(['agent-logs', sid, job, level, q, page], `/agent-insights/sessions/${encodeURIComponent(sid)}/logs?${query}`, { enabled: admin });
  function filter(key: string, value: string) {
    setParams(old => { const next = new URLSearchParams(old); next.set(key, value); if (key !== 'logPage') next.delete('logPage'); return next; });
  }
  if (me.isLoading) return <Alert>Checking access…</Alert>;
  if (!admin) return <Alert>Agent logs require an administrator account.</Alert>;
  if (result.error) return <Alert kind="bad">{(result.error as Error).message}</Alert>;
  const data = result.data;
  return <>
    <Alert>Structured logs submitted by the agent are linked by room and job. Collection follows the header refresh setting. Logs appear independently of final reports; only explicitly submitted application events are available.</Alert>
    {data && !data.enabled && <Alert kind="warn">New structured log collection is disabled. Any retained logs remain available until expiry.</Alert>}
    {data && data.expired > 0 && <Alert>{data.expired} log entries for this room/job have expired. Expired text cannot be searched or restored by retrying an upload.</Alert>}
    <Panel title="Agent logs">
      <form onSubmit={e => { e.preventDefault(); filter('logQ', search.trim()); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 14 }}>
        <label style={{ minWidth: 0, maxWidth: '100%', flex: '1 1 240px' }}>Job <select className="select" aria-label="Log job" value={job} onChange={e => filter('logJob', e.target.value)}><option value="">All jobs</option>
          {job && !data?.jobs.some(j => j.jobId === job) && <option value={job}>{job}</option>}
          {data?.jobs.map(j => <option key={`${j.jobId}/${j.agentName}`} value={j.jobId}>{j.agentName} · {j.jobId}</option>)}
        </select></label>
        <label style={{ minWidth: 0, maxWidth: '100%', flex: '1 1 140px' }}>Severity <select className="select" aria-label="Log severity" value={level} onChange={e => filter('logLevel', e.target.value)}><option value="">All levels</option>{['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'].map(l => <option key={l}>{l}</option>)}</select></label>
        <label style={{ minWidth: 0, maxWidth: '100%', flex: '1 1 200px' }}>Message <input className="input" aria-label="Search log messages" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <button className="btn secondary sm" type="submit" style={{ alignSelf: 'end' }}>Search logs</button>
      </form>
      <DataTable rows={data?.rows ?? []} loading={result.isLoading} search={false} pageSize={false} rowKey={r => `${r.jobId}/${r.id}`} empty={{ title: 'No retained logs match these filters' }} cols={[
        { key: 'at', header: 'Time', cell: r => <span className="mono nowrap">{fromMsPrecise(r.at)}</span> },
        { key: 'level', header: 'Severity', cell: r => <Badge tone={r.level === 'ERROR' || r.level === 'CRITICAL' ? 'bad' : r.level === 'WARNING' ? 'warn' : undefined}>{r.level}</Badge> },
        { key: 'message', header: 'Message', wrap: true, cell: r => <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.message}</span> },
        { key: 'context', header: 'Context', wrap: true, cell: r => <details><summary>{r.logger ?? r.agentName}</summary><div className="mono" style={{ overflowWrap: 'anywhere' }}>Job: {r.jobId}<br />Turn: {r.turnId ?? 'Not reported'}<br />Trace: {r.traceId ?? 'Not reported'}<br />Span: {r.spanId ?? 'Not reported'}</div></details> },
      ]} />
      {data && <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, padding: 12 }}>
        <span className="muted">{data.total} matching logs · Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
        <button className="btn secondary sm" disabled={data.page <= 1} onClick={() => filter('logPage', String(data.page - 1))}>Previous logs</button>
        <button className="btn secondary sm" disabled={data.page * data.pageSize >= data.total} onClick={() => filter('logPage', String(data.page + 1))}>Next logs</button>
      </div>}
    </Panel>
  </>;
}
