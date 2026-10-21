import { useSearchParams } from 'react-router-dom';
import { useRange } from '../lib/range';
import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtMs } from '../lib/format';
import { BarsChart } from '../components/Charts';
import { Alert, Kpi, Kpis, PageHeader, Panel, Tabs } from '../components/ui';

const categories = ['agents','participants','telephony','rooms','egress','transfer'] as const;
type Category = typeof categories[number];
const C = { a: 'var(--chart-cyan)', b: 'var(--purple)', c: 'var(--chart-green)', d: 'var(--chart-amber)' };

export function Usage() {
  const { hours } = useRange();
  const [params, setParams] = useSearchParams();
  const category: Category = categories.includes(params.get('usageCategory') as Category) ? params.get('usageCategory') as Category : 'agents';
  const { data, error } = useApi<Json>(['usage', hours], `/history/usage?hours=${hours}`);
  const t = data?.totals;
  const s: Json[] = data?.series ?? [];
  const bucket = data?.bucketMs ?? 3600000;
  const egress = Object.entries<Json>(t?.egressByType ?? {});
  const n = (v?: number) => (v == null ? '…' : v.toLocaleString());
  return (
    <>
      <PageHeader crumbs={[{ label: 'Console' }, { label: 'Usage' }]} title="Usage" sub="Session, participant and infrastructure usage" refresh={false} range />
      <Tabs value={category} onChange={value=>setParams(old=>{const next=new URLSearchParams(old);next.set('usageCategory',value);return next;})} tabs={categories.map(id=>({id,label:({agents:'Agents',participants:'Participants',telephony:'Telephony',rooms:'Rooms',egress:'Egress',transfer:'Data transfer'})[id]}))}/>
      <details className="metrics-help"><summary>About usage attribution</summary><p>Computed from webhook history and attributed to the time each session or participant started. Uses the header time range. Agent minutes describe session duration; token and speech counters are available in each agent’s Usage view. Repository traffic in Tools has its own independent range.</p></details>
      {error&&<Alert kind="bad">{error.message}</Alert>}
      {!data&&!error&&<Alert>Loading usage…</Alert>}
      {data&&<div>
        {category==='agents'&&<Panel title="Agents">
          <Kpis><Kpi label="Agent session minutes" value={n(t?.agentSessionMinutes)} /></Kpis>
          <BarsChart data={s} series={[{ key: 'agentMin', label: 'Agent minutes', color: C.a }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
        </Panel>}
        {category==='participants'&&<Panel title="Participants">
          <Kpis><Kpi label="WebRTC participant minutes" value={n(t?.webrtcParticipantMinutes)} /><Kpi label="SIP participant minutes" value={n(t?.sipParticipantMinutes)} /></Kpis>
          <BarsChart data={s} series={[{ key: 'webrtcMin', label: 'WebRTC', color: C.b }, { key: 'sipInMin', label: 'SIP inbound', color: C.c }, { key: 'sipOutMin', label: 'SIP outbound', color: C.d }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
        </Panel>}
        {category==='telephony'&&<Panel title="Telephony">
          <Kpis>
            <Kpi label="Inbound minutes" value={n(t?.sipInboundMinutes)} foot={`${n(t?.sipInboundCalls)} calls`} />
            <Kpi label="Outbound minutes" value={n(t?.sipOutboundMinutes)} foot={`${n(t?.sipOutboundCalls)} calls`} />
            <Kpi label="Total SIP sessions" value={n((t?.sipInboundCalls ?? 0) + (t?.sipOutboundCalls ?? 0))} />
          </Kpis>
          <BarsChart data={s} series={[{ key: 'sipInMin', label: 'Inbound', color: C.c }, { key: 'sipOutMin', label: 'Outbound', color: C.d }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
        </Panel>}
        {category==='rooms'&&<Panel title="Rooms">
          <Kpis><Kpi label="Room sessions" value={n(t?.roomSessions)} /><Kpi label="Average room size" value={t?.avgRoomSize ?? '…'} /><Kpi label="Average room duration" value={t ? fmtMs(t.avgRoomDurationMs) : '…'} /></Kpis>
          <BarsChart data={s} series={[{ key: 'sessions', label: 'Sessions', color: C.a }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
        </Panel>}
        {category==='egress'&&<Panel title="Egress">
          <Kpis>
            <Kpi label="Total egress count" value={n(egress.reduce((x, [, v]) => x + v.count, 0))} />
            <Kpi label="Egress minutes" value={n(Math.round(egress.reduce((x, [, v]) => x + v.minutes, 0)))} />
          </Kpis>
          <BarsChart data={s} series={[{ key: 'egressMin', label: 'Egress minutes', color: C.b }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
          {egress.length > 0 && <div className="legend">{egress.map(([k, v]) => <span key={k}>{k}: {v.count} ({Math.round(v.minutes)} min)</span>)}</div>}
        </Panel>}
        {category==='transfer'&&<Panel title="Data transfer"><div style={{ padding: 14 }}><Alert>Upstream and downstream data transfer are measured by LiveKit Cloud's analytics. A self-hosted server does not report per-session bandwidth; use the Prometheus <span className="mono">/metrics</span> endpoint (or node-exporter) for network totals.</Alert></div></Panel>}
      </div>}
    </>
  );
}
