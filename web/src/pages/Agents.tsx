import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi, useLkList } from '../lib/hooks';
import { useInitialQuery } from '../lib/useTab';
import { durationMs, fromMs, relTime } from '../lib/format';
import { BarsChart, PALETTE } from '../components/Charts';
import { useRange } from '../lib/range';
import { can, useMe } from '../lib/me';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Kpi, Kpis, PageHeader, Panel } from '../components/ui';

import { workerAvailable, type InventoryAgent, type Worker, type FormerWorker } from '../components/AgentInventory';
export { WorkersPanel, jobType, sdkLabel } from '../components/AgentInventory';
export type { Worker, FormerWorker, Outage } from '../components/AgentInventory';

type Row = { id?: string; aliases: string[]; totalSessions: number; firstSeenAt: number | null; name: string; sessions: number; jobs: number; minutes: number; avgMs: number; running: number; lastSeenAt: number | null; rules: Json[]; worker?: Worker; former?: FormerWorker };

const STATE_TONE: Record<string, 'ok' | 'warn' | 'info' | undefined> = { listening: 'ok', speaking: 'info', thinking: 'warn', initializing: 'warn' };
const pct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);

/** Canonical agent identities join retained history, live calls, rules and endpoint observations. */
export function Agents() {
  const navigate = useNavigate();
  const [params,setParams]=useSearchParams();
  const visibility=params.get('agentStatus')??'all';
  const grants=useMe();
  const { hours } = useRange();
  const initialQuery = useInitialQuery();
  const seen = useApi<Json[]>(['agents', hours], `/history/agents?hours=${hours}`);
  const live = useApi<Json[]>(['agents-live'], '/agents/live');
  const workers = useApi<{ configured: boolean; workers: Worker[]; former: FormerWorker[] }>(['agent-workers', hours], `/history/agent-workers?hours=${hours}`);
  const inventory = useApi<InventoryAgent[]>(['inventory-agents'], '/inventory/agents');
  const canonical = useMemo(() => new Map((inventory.data ?? []).flatMap(a => [a.name, ...a.aliases, a.id].map(name => [name, a] as const))), [inventory.data]);
  const rules = useLkList('sip', 'ListSIPDispatchRule');
  const insights = useApi<Json>(['insights', hours], `/history/insights?hours=${hours}`);
  const latency=useApi<{groups:{agentName:string;p50:number|null;count:number}[]}>(['agent-list-latency',hours],()=>{const to=Date.now();return `/agent-insights/analytics?${new URLSearchParams({from:String(to-hours*3600000),to:String(to),metric:'e2e_latency',agents:'[]',page:'1'})}`;},{enabled:can(grants.data,'transcripts')});

  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    const blank = (raw: string): Row => {
      const identity = canonical.get(raw);
      return { id: identity?.id, aliases: identity?.aliases ?? [], totalSessions: 0, firstSeenAt: identity?.firstSeenAt ?? null, name: identity?.name ?? raw, sessions: 0, jobs: 0, minutes: 0, avgMs: 0, running: 0, lastSeenAt: identity?.lastSeenAt ?? null, rules: [] };
    };
    const get = (raw: string) => {
      const key = canonical.get(raw)?.id ?? raw;
      let row = m.get(key);
      if (!row) { row = blank(raw); m.set(key, row); }
      return row;
    };
    (inventory.data ?? []).forEach(a => get(a.id));
    (seen.data ?? []).forEach(a => {
      const row = get(a.id ?? a.name);
      const count = row.sessions + (a.sessions ?? 0);
      row.avgMs = count ? (row.avgMs * row.sessions + (a.avgMs ?? 0) * (a.sessions ?? 0)) / count : 0;
      row.sessions = count;
      row.jobs += a.jobs ?? 0;
      row.minutes += a.minutes ?? 0;
      row.running += a.activeNow ?? 0;
      row.totalSessions += a.totalSessions ?? 0;
      if (a.lastSeenAt) row.lastSeenAt = Math.max(row.lastSeenAt ?? 0, a.lastSeenAt);
      if (a.firstSeenAt) row.firstSeenAt = Math.min(row.firstSeenAt ?? a.firstSeenAt, a.firstSeenAt);
    });
    (rules.data ?? []).forEach((r) => (r.roomConfig?.agents ?? []).forEach((a: Json) => {
      const row = get(a.agentName);
      if (!row.rules.some(rule => rule.sipDispatchRuleId === r.sipDispatchRuleId)) row.rules.push(r);
    }));
    if (live.data) {
      m.forEach((row) => (row.running = 0));
      live.data.forEach(l => { get(l.agentName).running++; });
    }
    (workers.data?.workers ?? []).forEach((w) => {
      if (!w.agentName) return;
      const row = get(w.agentId ?? w.agentName);
      if (!row.worker || Number(workerAvailable(w)) > Number(workerAvailable(row.worker)) || (workerAvailable(w) === workerAvailable(row.worker) && (w.lastCheckedAt ?? w.checkedAt) > (row.worker.lastCheckedAt ?? row.worker.checkedAt))) row.worker = w;
    });
    // agents whose worker is gone (renamed or removed) still count and keep their history
    (workers.data?.former ?? []).forEach((f) => {
      if (!f.agentName) return;
      const row = get(f.agentId ?? f.agentName);
      row.former = f;
    });
    return [...m.values()].sort((a, b) => Number(!!b.worker && workerAvailable(b.worker)) - Number(!!a.worker && workerAvailable(a.worker)) || b.running - a.running || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) || a.name.localeCompare(b.name));
  }, [seen.data, rules.data, live.data, workers.data, inventory.data, canonical]);

  // Inactive: nothing running it and no worker answering. It stays listed with its history.
  const configured = workers.data?.configured ?? true;
  const status = (a: Row) => a.worker
    ? (workerAvailable(a.worker) ? <Badge tone="ok" dot>Available</Badge> : <Badge tone="warn" dot>{a.worker.ok ? 'Stale' : 'Unavailable'}</Badge>)
    : a.running ? <Badge tone="ok" dot pulse>Serving a call</Badge>
    : a.former ? <Badge dot>{'Inactive'}</Badge>
    : a.totalSessions > 0 ? <Badge dot>Inactive</Badge>
    : configured && (workers.data?.workers.length ?? 0) > 0 ? <Badge>No worker endpoint</Badge> : <Badge>Unknown</Badge>;

  const cols: Col<Row>[] = [
    { key: 'name', header: 'Agent name', wrap: true, cell: (a) => <Link className="rowlink" to={`/agents/${encodeURIComponent(a.id ?? a.name)}`} onClick={(e) => e.stopPropagation()}><b>{a.name}</b>{a.aliases.filter(n => n !== a.name).length > 0 && <span className="sr-only">Linked names: {a.aliases.filter(n => n !== a.name).join(', ')}</span>}</Link>, text: (a) => [a.name, a.id, ...a.aliases].join(' '), sort: (a) => a.name },
    { key: 'consoleId', hidden: true, header: 'Console agent ID (not native)', cell: a => <span className="mono">{a.id ?? 'Pending observation'}</span>, text: a => a.id ?? '' },
    { key: 'status', header: 'Status', cell: status, sort: (a) => (a.worker ? (workerAvailable(a.worker) ? 2 : 0) : a.running ? 1 : -1) },
    { key: 'load', hidden: true, header: 'Worker load', cell: (a) => pct(a.worker?.load), sort: (a) => a.worker?.load ?? -1 },
    { key: 'jobs', hidden: true, header: 'Worker jobs (last check)', cell: a => a.worker && workerAvailable(a.worker) ? a.worker.activeJobs ?? 'Unknown' : 'Unknown', sort: a => a.worker && workerAvailable(a.worker) ? a.worker.activeJobs ?? -1 : -1 },
    { key: 'sdk', hidden: true, header: 'SDK', cell: (a) => { const w = a.worker ?? a.former; return w?.sdkVersion ? <span className="mono">{w.projectType ?? ''} {w.sdkVersion}</span> : '—'; } },
    { key: 'uptime', hidden: true, header: 'Worker sampled availability', cell: (a) => { const u = (a.worker ?? a.former)?.uptimePct; return u == null ? '—' : `${Number(u.toFixed(1))}%`; }, sort: (a) => (a.worker ?? a.former)?.uptimePct ?? -1 },
    { key: 'response', header: 'Response latency', cell: a=>{const group=latency.data?.groups.find(g=>g.agentName===a.name);return <span title="Median reported turn latency for the current source name; linked-name percentiles are not pooled">{group?.p50==null?'—':group.p50>=1000?`${Number((group.p50/1000).toFixed(2))} s`:`${Math.round(group.p50)} ms`}</span>;} },
    { key: 'sessions', header: 'Sessions', cell: (a) => a.sessions.toLocaleString(), sort: (a) => a.sessions },
    { key: 'minutes', hidden: true, header: 'Agent minutes', cell: (a) => a.minutes.toLocaleString(), sort: (a) => a.minutes },
    { key: 'first', header: 'First seen', hidden: true, cell: (a) => (a.firstSeenAt ? fromMs(a.firstSeenAt) : '—'), sort: (a) => a.firstSeenAt ?? 0 },
    { key: 'total', header: 'All-time sessions', hidden: true, cell: (a) => a.totalSessions.toLocaleString(), sort: (a) => a.totalSessions },
    { key: 'last', header: 'Last seen', hidden: false, cell: (a) => (a.lastSeenAt ? relTime(a.lastSeenAt) : '—'), sort: (a) => a.lastSeenAt ?? 0 },
    { key: 'rules', header: 'Dispatch rules', hidden: true, cell: (a) => (a.rules.length ? <div className="badges">{a.rules.slice(0, 3).map((r) => <Link key={r.sipDispatchRuleId} className="badge" to={`/telephony/dispatch?q=${r.sipDispatchRuleId}`}>{r.name || r.sipDispatchRuleId}</Link>)}{a.rules.length > 3 && <Badge>+{a.rules.length - 3}</Badge>}</div> : <span className="muted">None</span>), text: (a) => a.rules.map((r) => r.name).join(' ') },
  ];
  const liveCols: Col<Json>[] = [
    { key: 'agent', header: 'Agent', cell: (l) => <Link className="rowlink" to={`/sessions?agent=${encodeURIComponent(canonical.get(l.agentName)?.id ?? l.agentName)}`}><b title={`Reported name: ${l.agentName}`}>{canonical.get(l.agentName)?.name ?? l.agentName}</b></Link>, text: (l) => l.agentName },
    { key: 'state', header: 'State', cell: (l) => (l.state ? <Badge tone={STATE_TONE[l.state]}>{l.state}</Badge> : '—') },
    { key: 'room', header: 'Room', cell: (l) => <Link className="rowlink" to={`/rooms/${encodeURIComponent(l.roomName)}`}>{l.roomName}</Link>, text: (l) => l.roomName },
    { key: 'session', header: 'Session', cell: (l) => <Link className="rowlink mono" to={`/sessions/${l.roomSid}`}>{l.roomSid}</Link> },
    { key: 'joined', header: 'Joined', cell: (l) => fromMs(l.joinedAt) },
    { key: 'dur', header: 'Running for', cell: (l) => durationMs(l.joinedAt, null) },
  ];

  const running = (workers.data?.workers ?? []).filter(workerAvailable).length;
  const total = (k: 'sessions' | 'minutes') => rows.reduce((n, r) => n + r[k], 0);

  return (
    <>
      <PageHeader crumbs={[{ label: 'Console' }, { label: 'Agents' }]} title="Agents" range />
      {!configured && <details className="context-help"><summary>Worker status is not configured</summary><Alert>Configure AGENT_WORKER_URLS to monitor worker endpoints. Session history remains available.</Alert></details>}
      <Kpis>
        <Kpi label="Agents" value={rows.length} />
        <Kpi label="Available workers" value={workers.data ? running : '…'} help="Worker endpoints responding to a recent health check; this does not establish native registration." />
        <Kpi label="Sessions" value={total('sessions').toLocaleString()} />
      </Kpis>
      {((live.data?.length??0)>0||live.isLoading||live.error)&&<Panel title="Running now" icon={<Radio size={15} />}>
        <DataTable rows={live.data} cols={liveCols} rowKey={(l) => `${l.roomSid}-${l.identity}`} loading={live.isLoading} error={live.error} search={false} pageSize={false}
          empty={{ title: 'No agent is in a call right now', hint: 'Agents appear here while they are inside a room.' }} />
      </Panel>}
      <Panel title="All agents">
        <DataTable rows={rows.filter(a=>visibility==='current'?!!a.worker:visibility==='historical'?!a.worker&&!!(a.former||a.totalSessions):visibility==='serving'?!!a.running:true)} cols={cols} rowKey={(a) => a.id ?? a.name} loading={seen.isLoading || rules.isLoading || inventory.isLoading} error={seen.error ?? inventory.error} mobile storageKey="agents-polished" toolbar={<label className="compact-filter">Show<select className="select" aria-label="Agent status filter" value={visibility} onChange={e=>setParams(old=>{const next=new URLSearchParams(old);e.target.value==='all'?next.delete('agentStatus'):next.set('agentStatus',e.target.value);return next;})}><option value="all">All agents</option><option value="current">Current agents</option><option value="historical">Historical agents</option><option value="serving">In calls</option></select></label>} initialQuery={initialQuery} onRow={(a) => navigate(`/agents/${encodeURIComponent(a.id ?? a.name)}`)}
          empty={{ title: 'No agents yet', hint: 'An agent shows up when its worker endpoint is configured, after it joins a session, or when a dispatch rule names it.' }} />
      </Panel>

      {insights.data?.agentSeries?.some((row:Json)=>(row.n??0)>0)&&<Panel title="Session activity">
        <BarsChart data={insights.data?.agentSeries ?? []} series={[{ key: 'n', label: 'Agent sessions', color: PALETTE.cyan }]} bucketMs={insights.data?.bucketMs ?? 3600000} from={Date.now() - hours * 3600000} to={Date.now()} height={170} />
      </Panel>}
    </>
  );
}
