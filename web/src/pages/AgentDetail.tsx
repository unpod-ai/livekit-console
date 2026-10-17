import { Link, useNavigate, useParams } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useRange } from '../lib/range';
import { useTab } from '../lib/useTab';
import { durationMs, fromMs } from '../lib/format';
import { AreaChart, BarsChart, PALETTE, Spark } from '../components/Charts';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Help, KV, Kpi, Kpis, PageHeader, Panel, Tabs } from '../components/ui';
import { jobType, sdkLabel, WorkersPanel, type FormerWorker, type Worker } from './Agents';

const STATE_TONE: Record<string, 'ok' | 'warn' | 'info' | undefined> = { listening: 'ok', speaking: 'info', thinking: 'warn', initializing: 'warn' };
const ms = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k ms` : `${Math.round(n)} ms`);

/** An agent's overview, laid out like Cloud's: status, info cards, sessions served, deployment health. */
export function AgentDetail() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const { hours } = useRange();
  const [tab, setTab] = useTab('overview', ['overview', 'worker', 'sessions'] as const);
  const enc = encodeURIComponent(name);
  const ov = useApi<Json>(['agent-overview', name, hours], `/history/agents/${enc}/overview?hours=${hours}`);
  const wk = useApi<{ configured: boolean; workers: Worker[]; former: FormerWorker[] }>(['agent-workers', hours], `/history/agent-workers?hours=${hours}`);
  const live = useApi<Json[]>(['agents-live'], '/agents/live');
  const detail = useApi<{ sessions: Json[] }>(['agent', name], `/history/agents/${enc}`, { live: false });

  const worker = wk.data?.workers.find((w) => w.agentName === name);
  const jobs = (live.data ?? []).filter((l) => l.agentName === name);
  const o = ov.data;
  const from = Date.now() - hours * 3600000;
  const to = Date.now();
  const bucketMs = o?.bucketMs ?? 3600000;
  const statusEl = worker
    ? <span className="mono" style={{ color: worker.ok ? 'var(--ok)' : 'var(--bad)', fontWeight: 600, fontSize: 11 }}>■ {worker.ok ? 'RUNNING' : 'DOWN'}</span>
    : jobs.length ? <span className="mono" style={{ color: 'var(--ok)', fontWeight: 600, fontSize: 11 }}>■ IN A CALL</span>
    : <span className="mono muted" style={{ fontSize: 11 }}>■ UNKNOWN</span>;

  const liveCols: Col<Json>[] = [
    { key: 'state', header: 'State', cell: (l) => (l.state ? <Badge tone={STATE_TONE[l.state]}>{l.state}</Badge> : '—') },
    { key: 'room', header: 'Room', cell: (l) => <Link className="rowlink" to={`/rooms/${encodeURIComponent(l.roomName)}`}>{l.roomName}</Link> },
    { key: 'session', header: 'Session', cell: (l) => <Link className="rowlink mono" to={`/sessions/${l.roomSid}`}>{l.roomSid}</Link> },
    { key: 'joined', header: 'Joined', cell: (l) => fromMs(l.joinedAt) },
    { key: 'dur', header: 'Running for', cell: (l) => durationMs(l.joinedAt, null) },
  ];

  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Agents', to: '/agents' }, { label: name }, { label: { overview: 'Overview', worker: 'Worker', sessions: 'Sessions' }[tab] }]} title={name} range
        actions={<div style={{ textAlign: 'right', lineHeight: 1.2 }}><div className="mono muted" style={{ fontSize: 9.5, letterSpacing: 0.5 }}>CURRENT STATUS</div>{statusEl}</div>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'worker', label: 'Worker' }, { id: 'sessions', label: 'Sessions', count: detail.data?.sessions.length }]} />

      {tab === 'overview' && (
        <>
          <Kpis>
            <Kpi label="Agent name" value={<span style={{ fontSize: 15, color: 'var(--text)' }}>{name}</span>} />
            <Kpi label="Worker" help="Reported by the worker's own status server" value={<span style={{ fontSize: 15, color: 'var(--text)' }}>{worker ? `${jobType(worker.workerType)} · ${sdkLabel(worker)}` : '—'}</span>} />
            <Kpi label="Concurrent sessions" value={<span style={{ fontSize: 22 }}>{worker?.activeJobs ?? jobs.length}</span>} />
            <Kpi label="Worker endpoint" value={<span className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>{worker?.url ?? 'Not configured'}</span>} />
          </Kpis>
          {wk.data && !worker && <Alert kind="warn">No worker endpoint is configured for this agent, so uptime and load are unknown. Add its status URL to <span className="mono">AGENT_WORKER_URLS</span>.</Alert>}

          <Panel title="Sessions served" actions={<Help text="Sessions this agent joined, per time bucket" />}>
            <BarsChart data={o?.sessions ?? []} series={[{ key: 'n', label: 'Sessions', color: PALETTE.cyan }]} bucketMs={bucketMs} from={from} to={to} height={190} />
            <div className="legend" style={{ paddingTop: 0 }}><span><i style={{ background: PALETTE.cyan }} />Sessions</span><span><i style={{ background: PALETTE.red }} />Dispatch errors (not available on a self-hosted server)</span></div>
          </Panel>

          <h2 style={{ fontSize: 14, margin: '8px 0 10px' }}>Deployment health</h2>
          <Panel title="Connection latency" actions={<span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Badge>Agent join</Badge><Help text="How long after the session started the agent joined the room" /></span>}>
            <AreaChart gaps fill="none" format={ms} height={210} bucketMs={bucketMs} from={from} to={to} data={o?.joinLatency ?? []} emptyText="No agent joins recorded in this range"
              series={[{ key: 'p50', label: 'p50', color: PALETTE.gray }, { key: 'p90', label: 'p90', color: PALETTE.cyan }, { key: 'p95', label: 'p95', color: PALETTE.purple }]} />
          </Panel>
          <div className="grid-2">
            <div className="kpi" style={{ minHeight: 150, display: 'flex', flexDirection: 'column' }}>
              <div className="kpi-label">Agent uptime<Help text="Share of status checks in the range where the worker answered" /></div>
              <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}><div className="kpi-value" style={{ marginTop: 0, fontSize: 32 }}>{o?.uptimePct == null ? '—' : `${o.uptimePct}%`}</div></div>
              {o && o.uptime.length > 0 && <Spark points={o.uptime} from={from} to={to} bucketMs={bucketMs} />}
            </div>
            <div className="kpi" style={{ minHeight: 150, display: 'flex', flexDirection: 'column' }}>
              <div className="kpi-label">Average load<Help text="The worker's reported load, averaged over the range" /></div>
              <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}><div className="kpi-value" style={{ marginTop: 0, fontSize: 32 }}>{o?.avgLoadPct == null ? '—' : `${o.avgLoadPct}%`}</div></div>
              {o && o.load.length > 0 && <Spark points={o.load} from={from} to={to} bucketMs={bucketMs} />}
            </div>
          </div>
        </>
      )}

      {tab === 'worker' && (
        <>
          <Panel title="Worker status" actions={worker ? <Badge tone={worker.ok ? 'ok' : 'bad'} dot>{worker.ok ? 'Running' : 'Dead'}</Badge> : undefined}>
            {worker ? (
              <KV items={[
                ['Worker ID', worker.workerId ? <span className="mono">{worker.workerId}</span> : <span className="muted" title="The worker's status server doesn't report its ID; it appears in the worker's startup log (AW_…)">Not reported by the worker</span>],
                ['Endpoint', <span className="mono">{worker.url}</span>],
                ['Agent name', name],
                ['Job type', <span title="What one job is scoped to: JT_ROOM = one job per room (the agent handles the whole room); JT_PUBLISHER = one per publishing participant">{jobType(worker.workerType)}</span>],
                ['SDK', <span className="mono">{sdkLabel(worker)}</span>],
                ['Load', worker.load == null ? '—' : `${(worker.load * 100).toFixed(1)}%`],
                ['Active jobs', worker.activeJobs ?? '—'],
                ['Status latency', worker.latencyMs == null ? '—' : `${worker.latencyMs} ms`],
                ['Last ping', fromMs(worker.checkedAt)],
                ['Last healthy', worker.ok ? 'now' : fromMs(worker.lastOkAt)],
                ['First seen', fromMs(worker.firstSeenAt)],
                ['Uptime (range)', worker.uptimePct == null ? '—' : `${worker.uptimePct}% of ${worker.samples} checks`],
                ['Average load (range)', worker.avgLoadPct == null ? '—' : `${worker.avgLoadPct}%`],
                ['Last error', worker.error ?? '—'],
              ]} />
            ) : <div className="muted" style={{ padding: 16 }}>No worker endpoint is configured for this agent.</div>}
          </Panel>
          {/* the status panel above already covers a single worker; the table is for several, or for dead ones */}
          {[...(wk.data?.workers ?? []), ...(wk.data?.former ?? [])].filter((w) => w.agentName === name).length > 1 && (
            <WorkersPanel workers={wk.data?.workers ?? []} former={wk.data?.former ?? []} agent={name} />
          )}
        </>
      )}

      {tab === 'sessions' && (
        <>
          <Panel title={`Running now (${jobs.length})`} icon={<Radio size={15} />}>
            <DataTable rows={jobs} search={false} pageSize={false} rowKey={(l) => l.identity} cols={liveCols} empty={{ title: 'Not in any call right now' }} />
          </Panel>
          <Panel title="Recent sessions" actions={<Link className="btn ghost sm" to={`/sessions?agent=${enc}`}>View all</Link>}>
            <DataTable rows={detail.data?.sessions ?? []} search={false} pageSize={false} rowKey={(s) => `${s.room_sid}-${s.joined_at}`} loading={detail.isLoading} onRow={(s) => navigate(`/sessions/${s.room_sid}`)} empty={{ title: 'No sessions recorded for this agent' }} cols={[
              { key: 'room', header: 'Room', cell: (s) => <Link className="rowlink" to={`/sessions/${s.room_sid}`} onClick={(e) => e.stopPropagation()}>{s.room_name}</Link> },
              { key: 'j', header: 'Joined', cell: (s) => fromMs(s.joined_at) },
              { key: 'd', header: 'Duration', cell: (s) => durationMs(s.joined_at, s.left_at) },
            ]} />
          </Panel>
        </>
      )}
    </>
  );
}
