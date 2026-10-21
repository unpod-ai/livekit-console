import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useRange } from '../lib/range';
import { durationMs, fromMs } from '../lib/format';
import { AreaChart, BarsChart, PALETTE } from '../components/Charts';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Empty, Help, Kpi, Kpis, PageHeader, Panel, Tabs } from '../components/ui';
import { AgentInventory, workerAvailable, type AgentInventoryData } from '../components/AgentInventory';
import { Performance } from './Performance';
import { AgentLatency } from '../components/AgentLatency';
import { AgentUsage } from '../components/AgentUsage';

const STATE_TONE: Record<string, 'ok' | 'warn' | 'info' | undefined> = { listening: 'ok', speaking: 'info', thinking: 'warn', initializing: 'warn' };
const ms = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);

/** Agent activity first; worker history is available separately. */
export function AgentDetail() {
  const { name: ref = '' } = useParams();
  const navigate = useNavigate();
  const { hours } = useRange();
  const tabs = ['overview', 'worker', 'sessions', 'usage', 'performance'] as const;
  type Tab = typeof tabs[number];
  const [params, setParams] = useSearchParams();
  const tab: Tab = tabs.includes(params.get('tab') as Tab) ? params.get('tab') as Tab : 'overview';
  const setTab = (value: Tab) => setParams(old => { const next = new URLSearchParams(old); if (value === 'overview') next.delete('tab'); else next.set('tab', value); return next; }, { replace: true });
  const requestedDays = Number(params.get('inventoryDays') ?? 365);
  const days = [30, 90, 365].includes(requestedDays) ? requestedDays : 365;
  const inventory = useApi<AgentInventoryData>(['agent-inventory', ref, days], `/inventory/agents/${encodeURIComponent(ref)}?days=${days}`);
  const identity = inventory.data?.agent;
  const name = identity?.name ?? ref;
  const enc = encodeURIComponent(identity?.id ?? ref);
  const ov = useApi<Json>(['agent-overview', identity?.id, hours], `/history/agents/${enc}/overview?hours=${hours}`, { enabled: !!identity });
  const live = useApi<Json[]>(['agents-live'], '/agents/live');
  const detail = useApi<{ sessions: Json[] }>(['agent', identity?.id], `/history/agents/${enc}`, { live: false, enabled: !!identity });
  const workers = inventory.data?.workers ?? [];
  const former = inventory.data?.former ?? [];
  const worker = workers.find(workerAvailable) ?? workers[0];
  const retired = former[0];
  const names = new Set(identity ? [identity.name, ...identity.aliases] : []);
  const jobs = (live.data ?? []).filter(l => names.has(l.agentName));
  const o = ov.data;
  const from = Date.now() - hours * 3600000;
  const to = Date.now();
  const bucketMs = o?.bucketMs ?? 3600000;
  const statusEl = worker && workerAvailable(worker)
    ? <Badge tone="ok" dot>Available</Badge>
    : jobs.length ? <Badge tone="info" dot>Serving calls</Badge>
    : retired && !worker ? <Badge>Inactive</Badge>
    : <Badge>{worker?.ok ? 'Stale' : worker ? 'Unavailable' : 'Unknown'}</Badge>;

  const liveCols: Col<Json>[] = [
    { key: 'state', header: 'State', cell: (l) => (l.state ? <Badge tone={STATE_TONE[l.state]}>{l.state}</Badge> : '—') },
    { key: 'room', header: 'Room', cell: (l) => <Link className="rowlink" to={`/rooms/${encodeURIComponent(l.roomName)}`}>{l.roomName}</Link> },
    { key: 'session', header: 'Session', cell: (l) => <Link className="rowlink mono" to={`/sessions/${l.roomSid}`}>{l.roomSid}</Link> },
    { key: 'joined', header: 'Joined', cell: (l) => fromMs(l.joinedAt) },
    { key: 'dur', header: 'Running for', cell: (l) => durationMs(l.joinedAt, null) },
  ];

  return (
    <>
      <PageHeader crumbs={[{ label: 'Console' }, { label: 'Agents', to: '/agents' }, { label: name }, { label: { overview: 'Overview', worker: 'Workers', sessions: 'Sessions', usage: 'Usage', performance: 'Latency' }[tab] }]} title={name} range
        actions={<div style={{ textAlign: 'right', lineHeight: 1.2 }}><div className="mono muted" style={{ fontSize: 9.5, letterSpacing: 0.5 }}>CURRENT STATUS</div>{statusEl}</div>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'worker', label: 'Workers' }, { id: 'sessions', label: 'Sessions', count: detail.data?.sessions.length }, { id: 'usage', label: 'Usage' }, { id: 'performance', label: 'Latency' }]} />
      {inventory.error && <Alert kind="bad">{inventory.error.message}</Alert>}
      {inventory.isLoading && <Alert>Resolving agent inventory…</Alert>}
      {tab === 'performance' && identity && <><details className="context-help"><summary>Measurement scope</summary><p>Performance uses reported source name {name}. Linked names ({identity.aliases.filter(n=>n!==name).join(', ')||'none'}) are not automatically pooled.</p></details><Performance key={name} initialAgent={name}/></>}
      {tab === 'usage' && identity && <AgentUsage key={name} name={name} hours={hours} />}

      {tab === 'overview' && identity && (
        <>
          <Kpis>
            <Kpi label="Sessions served" value={o?.sessions?.reduce((n:number,row:Json)=>n+(row.n??0),0)??'…'}/>
            <Kpi label="In calls now" value={jobs.length}/>
            <Kpi label="Available workers" value={workers.filter(workerAvailable).length} help="Recent successful endpoint checks; not native registration."/>
          </Kpis>
          {!worker&&retired&&<Alert>No current workers. Last healthy {fromMs(retired.lastOkAt)}. <button className="btn ghost sm" onClick={()=>setTab('worker')}>View workers</button></Alert>}
          {!worker&&!retired&&<Alert>No worker observations exist for this agent. Availability and registration are unknown.</Alert>}
          {ov.error && <Alert kind="bad">{ov.error.message}</Alert>}
          <AgentLatency name={name} hours={hours} onMetric={metric=>setParams(old=>{
            const next=new URLSearchParams(old);next.set('tab','performance');next.set('perfView','latency');next.set('perfMetric',metric);next.set('perfAgents',JSON.stringify([name]));
            for(const key of ['perfPage','perfBucket','perfSample','perfContributors','perfFrom','perfTo'])next.delete(key);return next;
          })}/>
          <Panel title="Sessions served" actions={<Help text="Sessions this agent joined, per time bucket" />}>
            {ov.isLoading?<p className="muted" style={{padding:20}}>Loading session activity…</p>:o?.sessions?.some((row:Json)=>(row.n??0)>0)?<><BarsChart data={o?.sessions ?? []} series={[{ key: 'n', label: 'Sessions', color: PALETTE.cyan }]} bucketMs={bucketMs} from={from} to={to} height={190} />
            <div className="legend" style={{ paddingTop: 0 }}><span><i style={{ background: PALETTE.cyan }} />Sessions</span></div></>:<Empty title="No session activity">No sessions were recorded for this agent in this range.</Empty>}
          </Panel>


          {o?.joinLatency?.some((row:Json)=>[row.p50,row.p90,row.p95].some(value=>typeof value==='number'))&&<Panel title="Connection latency" actions={<span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Badge>Agent join</Badge><Help text="How long after the session started the agent joined the room" /></span>}>
            <AreaChart gaps fill="none" format={ms} height={160} bucketMs={bucketMs} from={from} to={to} data={o?.joinLatency ?? []} emptyText="No agent joins recorded in this range"
              series={[{ key: 'p50', label: 'p50', color: PALETTE.gray }, { key: 'p90', label: 'p90', color: PALETTE.cyan }, { key: 'p95', label: 'p95', color: PALETTE.purple }]} />
          </Panel>}
        </>
      )}

      {tab === 'worker' && inventory.data && <AgentInventory data={inventory.data} days={days} onDays={value => setParams(old => { const next = new URLSearchParams(old); next.set('inventoryDays', String(value)); return next; }, { replace: true })} />}

      {tab === 'sessions' && identity && (
        <>
          {jobs.length>0&&<Panel title={`Running now (${jobs.length})`} icon={<Radio size={15} />}>
            <DataTable rows={jobs} search={false} pageSize={false} rowKey={(l) => l.identity} cols={liveCols} empty={{ title: 'Not in any call right now' }} />
          </Panel>}
          <Panel title="Recent sessions" actions={<Link className="btn ghost sm" to={`/sessions?agent=${enc}`}>View all</Link>}>
            <DataTable rows={detail.data?.sessions ?? []} search={false} pageSize={false} rowKey={(s) => `${s.room_sid}-${s.joined_at}`} loading={detail.isLoading} error={detail.error} onRow={(s) => navigate(`/sessions/${s.room_sid}`)} empty={{ title: 'No sessions recorded for this agent' }} cols={[
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
