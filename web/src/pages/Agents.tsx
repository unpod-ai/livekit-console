import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi, useLkList } from '../lib/hooks';
import { useInitialQuery } from '../lib/useTab';
import { durationMs, fmtMs, fromMs, relTime } from '../lib/format';
import { Drawer } from '../components/Drawer';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, KV, Kpi, Kpis, PageHeader, Panel, RangeSelect } from '../components/ui';

type Worker = { url: string; ok: boolean; agentName: string | null; workerType: string | null; load: number | null; activeJobs: number | null; sdkVersion: string | null; projectType: string | null; latencyMs: number | null; checkedAt: number; error: string | null; uptimePct: number | null; avgLoadPct: number | null };
type Row = { name: string; sessions: number; jobs: number; minutes: number; avgMs: number; running: number; lastSeenAt: number | null; rules: Json[]; worker?: Worker };

const STATE_TONE: Record<string, 'ok' | 'warn' | 'info' | undefined> = { listening: 'ok', speaking: 'info', thinking: 'warn', initializing: 'warn' };
const pct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);

/**
 * Agent status comes from the workers themselves: every LiveKit agent worker runs a small status server that reports its
 * agent name, load, active jobs and SDK version. The console polls the configured endpoints (AGENT_WORKER_URLS), so a
 * running worker shows as RUNNING without any test jobs. Live jobs and past sessions come from LiveKit and webhooks.
 */
export function Agents() {
  const [hours, setHours] = useState(168);
  const initialQuery = useInitialQuery();
  const seen = useApi<Json[]>(['agents', hours], `/history/agents?hours=${hours}`);
  const live = useApi<Json[]>(['agents-live'], '/agents/live');
  const workers = useApi<{ configured: boolean; workers: Worker[] }>(['agent-workers', hours], `/history/agent-workers?hours=${hours}`);
  const rules = useLkList('sip', 'ListSIPDispatchRule');
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useApi<{ sessions: Json[] }>(['agent', selected], `/history/agents/${encodeURIComponent(selected ?? '')}`, { enabled: !!selected, live: false });

  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    const blank = (name: string): Row => ({ name, sessions: 0, jobs: 0, minutes: 0, avgMs: 0, running: 0, lastSeenAt: null, rules: [] as Json[] });
    (seen.data ?? []).forEach((a) => m.set(a.name, { ...blank(a.name), sessions: a.sessions, jobs: a.jobs, minutes: a.minutes, avgMs: a.avgMs, running: a.activeNow, lastSeenAt: a.lastSeenAt }));
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
    return [...m.values()].sort((a, b) => Number(!!b.worker?.ok) - Number(!!a.worker?.ok) || b.running - a.running || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) || a.name.localeCompare(b.name));
  }, [seen.data, rules.data, live.data, workers.data]);

  const configured = workers.data?.configured ?? true;
  const status = (a: Row) => a.worker
    ? (a.worker.ok ? <Badge tone="ok" dot pulse={(a.worker.activeJobs ?? 0) > 0}>Running</Badge> : <Badge tone="bad" dot>Down</Badge>)
    : a.running ? <Badge tone="ok" dot pulse>Running · in a call</Badge>
    : configured && (workers.data?.workers.length ?? 0) > 0 ? <Badge>No worker endpoint</Badge> : <Badge>Unknown</Badge>;

  const cols: Col<Row>[] = [
    { key: 'name', header: 'Agent name', cell: (a) => <Link className="rowlink" to={`/sessions?agent=${encodeURIComponent(a.name)}`} title="View this agent's sessions"><b>{a.name}</b></Link>, text: (a) => a.name, sort: (a) => a.name },
    { key: 'status', header: 'Status', cell: status, sort: (a) => (a.worker ? (a.worker.ok ? 2 : 0) : a.running ? 1 : -1) },
    { key: 'load', header: 'Load', cell: (a) => pct(a.worker?.load), sort: (a) => a.worker?.load ?? -1 },
    { key: 'jobs', header: 'Active jobs', cell: (a) => a.worker?.activeJobs ?? (a.running || '—'), sort: (a) => a.worker?.activeJobs ?? a.running },
    { key: 'sdk', header: 'SDK', cell: (a) => (a.worker?.sdkVersion ? <span className="mono">{a.worker.projectType ?? ''} {a.worker.sdkVersion}</span> : '—') },
    { key: 'uptime', header: 'Uptime', cell: (a) => (a.worker?.uptimePct == null ? '—' : `${a.worker.uptimePct}%`), sort: (a) => a.worker?.uptimePct ?? -1 },
    { key: 'sessions', header: 'Sessions', cell: (a) => a.sessions.toLocaleString(), sort: (a) => a.sessions },
    { key: 'minutes', header: 'Agent minutes', cell: (a) => a.minutes.toLocaleString(), sort: (a) => a.minutes },
    { key: 'last', header: 'Last seen in a call', hidden: true, cell: (a) => (a.lastSeenAt ? relTime(a.lastSeenAt) : '—'), sort: (a) => a.lastSeenAt ?? 0 },
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
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Agents' }]} title="Agents" sub="Worker status, agents running in calls, and agents seen in sessions" actions={<RangeSelect value={hours} onChange={setHours} />} />
      {!configured && (
        <Alert kind="warn">No agent worker endpoints are configured, so worker status is unknown. Each worker serves its status on port 8081 (<span className="mono">GET /worker</span>). Set <span className="mono">AGENT_WORKER_URLS</span> (comma-separated base URLs, e.g. <span className="mono">http://127.0.0.1:18081</span>) on the console.</Alert>
      )}
      <Kpis>
        <Kpi label="Agents" value={rows.length} />
        <Kpi label="Workers running" value={workers.data ? `${running}/${workers.data.workers.length}` : '…'} accent foot={configured ? 'From each worker\'s own status' : 'Not configured'} />
        <Kpi label="In calls now" value={live.data ? live.data.length : '…'} foot={live.isError ? 'Could not reach LiveKit' : 'Agents inside live rooms'} />
        <Kpi label="Agent sessions" value={total('sessions').toLocaleString()} />
        <Kpi label="Agent minutes" value={total('minutes').toLocaleString()} />
      </Kpis>
      <Panel title="Running now" icon={<Radio size={15} />}>
        <DataTable rows={live.data} cols={liveCols} rowKey={(l) => `${l.roomSid}-${l.identity}`} loading={live.isLoading} error={live.error} search={false} pageSize={false}
          empty={{ title: 'No agent is in a call right now', hint: 'Agents appear here while they are inside a room.' }} />
      </Panel>
      <Panel title="All agents">
        <DataTable rows={rows} cols={cols} rowKey={(a) => a.name} loading={seen.isLoading || rules.isLoading} error={seen.error} storageKey="agents" initialQuery={initialQuery} onRow={(a) => setSelected(a.name)}
          empty={{ title: 'No agents yet', hint: 'An agent shows up when its worker endpoint is configured, after it joins a session, or when a dispatch rule names it.' }} />
      </Panel>

      <Drawer open={!!selected} wide title={selected ?? ''} subtitle="Agent details" onClose={() => setSelected(null)}>
        {selected && (() => {
          const row = rows.find((r) => r.name === selected);
          const w = row?.worker;
          const jobs = (live.data ?? []).filter((l) => l.agentName === selected);
          return (
            <>
              <Panel title="Worker">
                {w ? (
                  <KV items={[
                    ['Status', w.ok ? <Badge tone="ok" dot>Running</Badge> : <Badge tone="bad" dot>Down</Badge>],
                    ['Agent name', <span className="mono">{w.agentName}</span>],
                    ['Worker type', w.workerType ?? '—'],
                    ['Load', pct(w.load)],
                    ['Active jobs', w.activeJobs ?? '—'],
                    ['SDK', w.sdkVersion ? `${w.projectType ?? ''} ${w.sdkVersion}`.trim() : '—'],
                    [`Uptime (${hours >= 168 ? `${hours / 24}d` : `${hours}h`})`, w.uptimePct == null ? '—' : `${w.uptimePct}%`],
                    ['Average load', w.avgLoadPct == null ? '—' : `${w.avgLoadPct}%`],
                    ['Endpoint', <span className="mono">{w.url}</span>],
                    ['Response time', w.latencyMs != null ? `${w.latencyMs} ms` : '—'],
                    ['Last checked', relTime(w.checkedAt)],
                    ...(w.error ? [['Error', w.error] as [string, string]] : []),
                  ]} />
                ) : <div className="panel-body muted">No worker endpoint is configured for this agent. Add its status URL to <span className="mono">AGENT_WORKER_URLS</span> to see its load, active jobs, SDK version and uptime.</div>}
              </Panel>
              <Panel title={`Running now (${jobs.length})`}>
                <DataTable rows={jobs} search={false} pageSize={false} rowKey={(l) => l.identity} empty={{ title: 'Not in any call right now' }} cols={[
                  { key: 'room', header: 'Room', cell: (l) => <Link className="rowlink" to={`/rooms/${encodeURIComponent(l.roomName)}`}>{l.roomName}</Link> },
                  { key: 'state', header: 'State', cell: (l) => (l.state ? <Badge tone={STATE_TONE[l.state]}>{l.state}</Badge> : '—') },
                  { key: 'dur', header: 'Running for', cell: (l) => durationMs(l.joinedAt, null) },
                ]} />
              </Panel>
              <Panel title="Recent sessions">
                <DataTable rows={detail.data?.sessions ?? []} search={false} pageSize={false} rowKey={(s) => `${s.room_sid}-${s.joined_at}`} loading={detail.isLoading} empty={{ title: 'No sessions recorded for this agent' }} cols={[
                  { key: 'room', header: 'Room', cell: (s) => <Link className="rowlink" to={`/sessions/${s.room_sid}`}>{s.room_name}</Link> },
                  { key: 'j', header: 'Joined', cell: (s) => fromMs(s.joined_at) },
                  { key: 'd', header: 'Duration', cell: (s) => durationMs(s.joined_at, s.left_at) },
                ]} />
              </Panel>
              {row && row.sessions > 0 && <p className="muted" style={{ margin: 0 }}>{row.sessions} sessions · {row.minutes} agent minutes · average {fmtMs(row.avgMs)} over the selected range.</p>}
            </>
          );
        })()}
      </Drawer>
    </>
  );
}
