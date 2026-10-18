import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi, useLkList } from '../lib/hooks';
import { useInitialQuery } from '../lib/useTab';
import { durationMs, fromMs, relTime } from '../lib/format';
import { BarsChart, PALETTE } from '../components/Charts';
import { useRange } from '../lib/range';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Kpi, Kpis, PageHeader, Panel } from '../components/ui';

export type Worker = { url: string; ok: boolean; agentName: string | null; workerId: string | null; workerType: string | null; load: number | null; activeJobs: number | null; sdkVersion: string | null; projectType: string | null; latencyMs: number | null; checkedAt: number; error: string | null; uptimePct: number | null; avgLoadPct: number | null; outages: Outage[]; firstSeenAt: number | null; lastOkAt: number | null; lastCheckedAt: number | null; samples: number };
export type Outage = { from: number; to: number | null; checks: number };
export type FormerWorker = { reason: 'renamed' | 'removed' } & Pick<Worker, 'url' | 'agentName' | 'workerType' | 'sdkVersion' | 'projectType' | 'uptimePct' | 'avgLoadPct' | 'outages' | 'firstSeenAt' | 'lastOkAt' | 'lastCheckedAt' | 'samples'>;

const JOB_TYPES: Record<string, string> = { JT_ROOM: 'Room', JT_PUBLISHER: 'Publisher', JT_PARTICIPANT: 'Participant' };
/** The job type a worker registered for (what one job is scoped to), spelled out. */
export const jobType = (t?: string | null) => (t ? `${JOB_TYPES[t] ?? t} (${t})` : '—');
export const sdkLabel = (w: Pick<Worker, 'projectType' | 'sdkVersion'>) => (w.sdkVersion ? `livekit-agents ${w.projectType ?? ''} ${w.sdkVersion}`.replace('  ', ' ') : '—');

type WorkerRow = (Worker | (FormerWorker & { ok: false; latencyMs: null; load: null; activeJobs: null; error: null })) & { retired?: boolean };

/** Every worker the console has polled, including dead ones, with when each was last pinged and last healthy. */
export function WorkersPanel({ workers, former, agent }: { workers: Worker[]; former: FormerWorker[]; agent?: string }) {
  const rows: WorkerRow[] = [
    ...workers.map((w) => ({ ...w })),
    ...former.map((w) => ({ ...w, ok: false as const, latencyMs: null, load: null, activeJobs: null, error: null, retired: true })),
  ].filter((w) => !agent || w.agentName === agent);
  const dead = rows.filter((w) => !w.ok).length;
  const cols: Col<WorkerRow>[] = [
    { key: 'status', header: 'Status', cell: (w) => (w.ok ? <Badge tone="ok" dot>Running</Badge> : <Badge tone={w.retired && 'reason' in w && w.reason === 'renamed' ? undefined : 'bad'} dot>{!w.retired ? 'Dead' : 'reason' in w && w.reason === 'renamed' ? 'Retired · agent renamed' : 'Dead · removed'}</Badge>), sort: (w) => Number(w.ok), text: (w) => (w.ok ? 'running' : 'dead') },
    { key: 'agent', header: 'Agent', cell: (w) => (w.agentName ? <Link className="rowlink" to={`/agents/${encodeURIComponent(w.agentName)}`}><b>{w.agentName}</b></Link> : '—'), text: (w) => w.agentName ?? '', sort: (w) => w.agentName ?? '' },
    { key: 'id', header: 'Worker ID', cell: (w) => (('workerId' in w && w.workerId) ? <span className="mono">{w.workerId}</span> : <span className="muted">—</span>), text: (w) => ('workerId' in w && w.workerId) || '' },
    { key: 'url', header: 'Endpoint', cell: (w) => <span className="mono">{w.url}</span>, text: (w) => w.url },
    { key: 'ping', header: 'Last ping', cell: (w) => (w.lastCheckedAt ? <span title={fromMs(w.lastCheckedAt)}>{relTime(w.lastCheckedAt)}</span> : '—'), sort: (w) => w.lastCheckedAt ?? 0 },
    { key: 'ok', header: 'Last healthy', cell: (w) => (w.lastOkAt ? <span title={fromMs(w.lastOkAt)}>{w.ok ? 'now' : relTime(w.lastOkAt)}</span> : 'Never'), sort: (w) => w.lastOkAt ?? 0 },
    { key: 'type', header: 'Job type', cell: (w) => jobType(w.workerType), text: (w) => w.workerType ?? '' },
    { key: 'sdk', header: 'SDK', cell: sdkLabelCell, text: (w) => w.sdkVersion ?? '' },
    { key: 'lat', header: 'Latency', cell: (w) => (w.latencyMs == null ? '—' : `${w.latencyMs} ms`) },
    { key: 'up', header: 'Uptime', cell: (w) => (w.uptimePct == null ? '—' : `${w.uptimePct}%`), sort: (w) => w.uptimePct ?? -1 },
    { key: 'err', header: 'Last error', hidden: !agent, cell: (w) => (w.error ? <span className="muted">{w.error}</span> : '—'), text: (w) => w.error ?? '' },
    { key: 'first', header: 'First seen', hidden: true, cell: (w) => fromMs(w.firstSeenAt), sort: (w) => w.firstSeenAt ?? 0 },
  ];
  return (
    <Panel title={`${agent ? 'Workers' : 'All workers'} (${rows.length})`} actions={dead ? <Badge tone="bad" dot>{dead} dead</Badge> : undefined}>
      <DataTable rows={rows} cols={cols} rowKey={(w) => `${w.url}|${w.agentName ?? ''}`} search={false} pageSize={false} storageKey={agent ? undefined : 'workers'}
        empty={{ title: 'No workers polled yet', hint: 'Workers appear after the first status check of an endpoint in AGENT_WORKER_URLS.' }} />
    </Panel>
  );
}
const sdkLabelCell = (w: WorkerRow) => (w.sdkVersion ? <span className="mono">{sdkLabel(w)}</span> : '—');
type Row = { totalSessions: number; firstSeenAt: number | null; name: string; sessions: number; jobs: number; minutes: number; avgMs: number; running: number; lastSeenAt: number | null; rules: Json[]; worker?: Worker; former?: FormerWorker };

const STATE_TONE: Record<string, 'ok' | 'warn' | 'info' | undefined> = { listening: 'ok', speaking: 'info', thinking: 'warn', initializing: 'warn' };
const pct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);

/**
 * Agent status comes from the workers themselves: every LiveKit agent worker runs a small status server that reports its
 * agent name, load, active jobs and SDK version. The console polls the configured endpoints (AGENT_WORKER_URLS), so a
 * running worker shows as RUNNING without any test jobs. Live jobs and past sessions come from LiveKit and webhooks.
 */
export function Agents() {
  const navigate = useNavigate();
  const { hours } = useRange();
  const initialQuery = useInitialQuery();
  const seen = useApi<Json[]>(['agents', hours], `/history/agents?hours=${hours}`);
  const live = useApi<Json[]>(['agents-live'], '/agents/live');
  const workers = useApi<{ configured: boolean; workers: Worker[]; former: FormerWorker[] }>(['agent-workers', hours], `/history/agent-workers?hours=${hours}`);
  const rules = useLkList('sip', 'ListSIPDispatchRule');
  const insights = useApi<Json>(['insights', hours], `/history/insights?hours=${hours}`);

  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    const blank = (name: string): Row => ({ totalSessions: 0, firstSeenAt: null, name, sessions: 0, jobs: 0, minutes: 0, avgMs: 0, running: 0, lastSeenAt: null, rules: [] as Json[] });
    (seen.data ?? []).forEach((a) => m.set(a.name, { ...blank(a.name), sessions: a.sessions, jobs: a.jobs, minutes: a.minutes, avgMs: a.avgMs, running: a.activeNow, lastSeenAt: a.lastSeenAt, firstSeenAt: a.firstSeenAt, totalSessions: a.totalSessions }));
    (rules.data ?? []).forEach((r) => (r.roomConfig?.agents ?? []).forEach((a: Json) => {
      const row = m.get(a.agentName) ?? blank(a.agentName);
      row.rules.push(r);
      m.set(a.agentName, row);
    }));
    if (live.data) {
      m.forEach((row) => (row.running = 0));
      live.data.forEach((l) => { const row = m.get(l.agentName) ?? blank(l.agentName); row.running++; m.set(l.agentName, row); });
    }
    (workers.data?.workers ?? []).forEach((w) => {
      if (!w.agentName) return;
      const row = m.get(w.agentName) ?? blank(w.agentName);
      row.worker = w;
      m.set(w.agentName, row);
    });
    // agents whose worker is gone (renamed or removed) still count and keep their history
    (workers.data?.former ?? []).forEach((f) => {
      if (!f.agentName) return;
      const row = m.get(f.agentName) ?? blank(f.agentName);
      row.former = f;
      m.set(f.agentName, row);
    });
    return [...m.values()].sort((a, b) => Number(!!b.worker?.ok) - Number(!!a.worker?.ok) || b.running - a.running || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) || a.name.localeCompare(b.name));
  }, [seen.data, rules.data, live.data, workers.data]);

  // Inactive: nothing running it and no worker answering. It stays listed with its history.
  const inactive = (a: Row) => !a.worker?.ok && !a.running;
  const configured = workers.data?.configured ?? true;
  const status = (a: Row) => a.worker
    ? (a.worker.ok ? <Badge tone="ok" dot pulse={(a.worker.activeJobs ?? 0) > 0}>Running</Badge> : <Badge tone="bad" dot>Down</Badge>)
    : a.running ? <Badge tone="ok" dot pulse>Running · in a call</Badge>
    : a.former ? <Badge dot>{a.former.reason === 'renamed' ? 'Retired' : 'Worker removed'}</Badge>
    : a.totalSessions > 0 ? <Badge dot>Inactive</Badge>
    : configured && (workers.data?.workers.length ?? 0) > 0 ? <Badge>No worker endpoint</Badge> : <Badge>Unknown</Badge>;

  const cols: Col<Row>[] = [
    { key: 'name', header: 'Agent name', cell: (a) => <Link className="rowlink" to={`/agents/${encodeURIComponent(a.name)}`} onClick={(e) => e.stopPropagation()}><b>{a.name}</b></Link>, text: (a) => a.name, sort: (a) => a.name },
    { key: 'status', header: 'Status', cell: status, sort: (a) => (a.worker ? (a.worker.ok ? 2 : 0) : a.running ? 1 : -1) },
    { key: 'load', header: 'Load', cell: (a) => pct(a.worker?.load), sort: (a) => a.worker?.load ?? -1 },
    { key: 'jobs', header: 'Active jobs', cell: (a) => a.worker?.activeJobs ?? (a.running || '—'), sort: (a) => a.worker?.activeJobs ?? a.running },
    { key: 'sdk', header: 'SDK', cell: (a) => { const w = a.worker ?? a.former; return w?.sdkVersion ? <span className="mono">{w.projectType ?? ''} {w.sdkVersion}</span> : '—'; } },
    { key: 'uptime', header: 'Uptime', cell: (a) => { const u = (a.worker ?? a.former)?.uptimePct; return u == null ? '—' : `${u}%`; }, sort: (a) => (a.worker ?? a.former)?.uptimePct ?? -1 },
    { key: 'sessions', header: 'Sessions', cell: (a) => a.sessions.toLocaleString(), sort: (a) => a.sessions },
    { key: 'minutes', header: 'Agent minutes', cell: (a) => a.minutes.toLocaleString(), sort: (a) => a.minutes },
    { key: 'first', header: 'First seen', hidden: true, cell: (a) => (a.firstSeenAt ? fromMs(a.firstSeenAt) : '—'), sort: (a) => a.firstSeenAt ?? 0 },
    { key: 'total', header: 'All-time sessions', hidden: true, cell: (a) => a.totalSessions.toLocaleString(), sort: (a) => a.totalSessions },
    { key: 'last', header: 'Last seen in a call', hidden: false, cell: (a) => (a.lastSeenAt ? relTime(a.lastSeenAt) : '—'), sort: (a) => a.lastSeenAt ?? 0 },
    { key: 'rules', header: 'Dispatch rules', hidden: true, cell: (a) => (a.rules.length ? <div className="badges">{a.rules.slice(0, 3).map((r) => <Link key={r.sipDispatchRuleId} className="badge" to={`/telephony/dispatch?q=${r.sipDispatchRuleId}`}>{r.name || r.sipDispatchRuleId}</Link>)}{a.rules.length > 3 && <Badge>+{a.rules.length - 3}</Badge>}</div> : <span className="muted">None</span>), text: (a) => a.rules.map((r) => r.name).join(' ') },
  ];
  const liveCols: Col<Json>[] = [
    { key: 'agent', header: 'Agent', cell: (l) => <Link className="rowlink" to={`/sessions?agent=${encodeURIComponent(l.agentName)}`}><b>{l.agentName}</b></Link>, text: (l) => l.agentName },
    { key: 'state', header: 'State', cell: (l) => (l.state ? <Badge tone={STATE_TONE[l.state]}>{l.state}</Badge> : '—') },
    { key: 'room', header: 'Room', cell: (l) => <Link className="rowlink" to={`/rooms/${encodeURIComponent(l.roomName)}`}>{l.roomName}</Link>, text: (l) => l.roomName },
    { key: 'session', header: 'Session', cell: (l) => <Link className="rowlink mono" to={`/sessions/${l.roomSid}`}>{l.roomSid}</Link> },
    { key: 'joined', header: 'Joined', cell: (l) => fromMs(l.joinedAt) },
    { key: 'dur', header: 'Running for', cell: (l) => durationMs(l.joinedAt, null) },
  ];

  const running = (workers.data?.workers ?? []).filter((w) => w.ok).length;
  const total = (k: 'sessions' | 'minutes') => rows.reduce((n, r) => n + r[k], 0);

  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Agents' }]} title="Agents" sub="Worker status, agents running in calls, and agents seen in sessions" range />
      {!configured && (
        <Alert kind="warn">No agent worker endpoints are configured, so worker status is unknown. Each worker serves its status on port 8081 (<span className="mono">GET /worker</span>). Set <span className="mono">AGENT_WORKER_URLS</span> (comma-separated base URLs, e.g. <span className="mono">http://127.0.0.1:18081</span>) on the console.</Alert>
      )}
      <Kpis>
        <Kpi label="Agents" value={rows.length} foot={`${rows.filter(inactive).length} inactive`} />
        <Kpi label="Workers running" value={workers.data ? `${running}/${workers.data.workers.length + workers.data.former.length}` : '…'} accent foot={configured ? 'From each worker\'s own status' : 'Not configured'} />
        <Kpi label="In calls now" value={live.data ? live.data.length : '…'} foot={live.isError ? 'Could not reach LiveKit' : 'Agents inside live rooms'} />
        <Kpi label="Agent sessions" value={total('sessions').toLocaleString()} />
        <Kpi label="Agent minutes" value={total('minutes').toLocaleString()} />
      </Kpis>
      <Panel title="Running now" icon={<Radio size={15} />}>
        <DataTable rows={live.data} cols={liveCols} rowKey={(l) => `${l.roomSid}-${l.identity}`} loading={live.isLoading} error={live.error} search={false} pageSize={false}
          empty={{ title: 'No agent is in a call right now', hint: 'Agents appear here while they are inside a room.' }} />
      </Panel>
      <Panel title="All agents">
        <DataTable rows={rows} cols={cols} rowKey={(a) => a.name} loading={seen.isLoading || rules.isLoading} error={seen.error} storageKey="agents" initialQuery={initialQuery} onRow={(a) => navigate(`/agents/${encodeURIComponent(a.name)}`)}
          empty={{ title: 'No agents yet', hint: 'An agent shows up when its worker endpoint is configured, after it joins a session, or when a dispatch rule names it.' }} />
      </Panel>

      <Panel title="Session activity">
        <BarsChart data={insights.data?.agentSeries ?? []} series={[{ key: 'n', label: 'Agent sessions', color: PALETTE.cyan }]} bucketMs={insights.data?.bucketMs ?? 3600000} from={Date.now() - hours * 3600000} to={Date.now()} height={170} />
      </Panel>
    </>
  );
}
