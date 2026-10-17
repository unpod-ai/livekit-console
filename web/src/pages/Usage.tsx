import { useState } from 'react';
import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtMs } from '../lib/format';
import { BarsChart } from '../components/Charts';
import { Alert, Kpi, Kpis, PageHeader, Panel, RangeSelect } from '../components/ui';

const C = { a: '#22d3ee', b: '#818cf8', c: '#34d399', d: '#fbbf24' };

export function Usage() {
  const [hours, setHours] = useState(168);
  const { data } = useApi<Json>(['usage', hours], `/history/usage?hours=${hours}`);
  const t = data?.totals;
  const s: Json[] = data?.series ?? [];
  const bucket = data?.bucketMs ?? 3600000;
  const egress = Object.entries<Json>(t?.egressByType ?? {});
  const n = (v?: number) => (v == null ? '…' : v.toLocaleString());
  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Usage' }]} title="Usage" sub="Computed from webhook history and attributed to the time each session or participant started" actions={<RangeSelect value={hours} onChange={setHours} />} refresh={false} />
      <div className="grid-2">
        <Panel title="Agents">
          <Kpis><Kpi label="Agent session minutes" value={n(t?.agentSessionMinutes)} /></Kpis>
          <BarsChart data={s} series={[{ key: 'agentMin', label: 'Agent minutes', color: C.a }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
        </Panel>
        <Panel title="Participants">
          <Kpis><Kpi label="WebRTC participant minutes" value={n(t?.webrtcParticipantMinutes)} /><Kpi label="SIP participant minutes" value={n(t?.sipParticipantMinutes)} /></Kpis>
          <BarsChart data={s} series={[{ key: 'webrtcMin', label: 'WebRTC', color: C.b }, { key: 'sipInMin', label: 'SIP inbound', color: C.c }, { key: 'sipOutMin', label: 'SIP outbound', color: C.d }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
        </Panel>
        <Panel title="Telephony">
          <Kpis>
            <Kpi label="Inbound minutes" value={n(t?.sipInboundMinutes)} foot={`${n(t?.sipInboundCalls)} calls`} />
            <Kpi label="Outbound minutes" value={n(t?.sipOutboundMinutes)} foot={`${n(t?.sipOutboundCalls)} calls`} />
            <Kpi label="Total SIP sessions" value={n((t?.sipInboundCalls ?? 0) + (t?.sipOutboundCalls ?? 0))} />
          </Kpis>
          <BarsChart data={s} series={[{ key: 'sipInMin', label: 'Inbound', color: C.c }, { key: 'sipOutMin', label: 'Outbound', color: C.d }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
        </Panel>
        <Panel title="Rooms">
          <Kpis><Kpi label="Room sessions" value={n(t?.roomSessions)} /><Kpi label="Average room size" value={t?.avgRoomSize ?? '…'} /><Kpi label="Average room duration" value={t ? fmtMs(t.avgRoomDurationMs) : '…'} /></Kpis>
          <BarsChart data={s} series={[{ key: 'sessions', label: 'Sessions', color: C.a }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
        </Panel>
        <Panel title="Egress">
          <Kpis>
            <Kpi label="Total egress count" value={n(egress.reduce((x, [, v]) => x + v.count, 0))} />
            <Kpi label="Egress minutes" value={n(Math.round(egress.reduce((x, [, v]) => x + v.minutes, 0)))} />
          </Kpis>
          <BarsChart data={s} series={[{ key: 'egressMin', label: 'Egress minutes', color: C.b }]} bucketMs={bucket} from={Date.now() - hours * 3600000} to={Date.now()} />
          {egress.length > 0 && <div className="legend">{egress.map(([k, v]) => <span key={k}>{k}: {v.count} ({Math.round(v.minutes)} min)</span>)}</div>}
        </Panel>
        <Panel title="Data transfer"><div style={{ padding: 14 }}><Alert>Upstream and downstream data transfer are measured by LiveKit Cloud's analytics. A self-hosted server does not report per-session bandwidth; use the Prometheus <span className="mono">/metrics</span> endpoint (or node-exporter) for network totals.</Alert></div></Panel>
      </div>
    </>
  );
}
