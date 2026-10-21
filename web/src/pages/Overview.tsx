import { Link, useNavigate } from '../lib/router';
import { ArrowRight, AlertTriangle, BarChart3, BookOpen, Cable, CheckCircle2, GitBranch, Hash } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useRange } from '../lib/range';
import { fmtMs, fromMs, durationMs, relTime } from '../lib/format';
import { DataTable, type Col } from '../components/DataTable';
import { AreaChart, Donut, PALETTE, Spark } from '../components/Charts';
import { Badge, Help, Kpi, Kpis, PageHeader, Panel, StatusBadge } from '../components/ui';

/** Cloud's insight tile: mono label with help, big centred cyan number, optional trend underneath. */
function Tile({ label, help, value, unit, spark }: { label: string; help: string; value: string; unit?: string; spark?: React.ReactNode }) {
  return (
    <div className="kpi" style={{ display: 'flex', flexDirection: 'column', minHeight: 150 }}>
      <div className="kpi-label">{label}<Help text={help} /></div>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <div className="kpi-value" style={{ marginTop: 0, fontSize: 32 }}>{value}{unit && <small style={{ fontSize: 16 }}>{unit}</small>}</div>
      </div>
      {spark}
    </div>
  );
}

export function Overview() {
  const navigate = useNavigate();
  const { hours } = useRange();
  const insights = useApi<Json>(['insights', hours], `/history/insights?hours=${hours}`);
  const rooms = useApi<Json[]>(['rooms'], '/rooms');
  const active = useApi<Json>(['calls-active'], '/history/calls?hours=24&state=active&limit=1');
  const recent = useApi<Json>(['sessions-recent', hours], `/history/sessions?hours=${hours}&limit=8`);
  const collector = useApi<Json>(['collector'], '/history/collector');
  const i = insights.data;
  const online = (rooms.data ?? []).reduce((n, r) => n + (r.numParticipants ?? 0), 0);
  const from = Date.now() - hours * 3600000;
  const to = Date.now();

  // the three session series share one chart, so line them up by bucket
  const merged = i
    ? (() => {
        const m = new Map<number, Json>();
        const put = (rows: Json[], key: string) => rows.forEach((r) => m.set(r.t, { ...(m.get(r.t) ?? { t: r.t }), [key]: r.n }));
        put(i.series, 'total'); put(i.agentSeries, 'agents'); put(i.sipSeries, 'sip');
        return [...m.values()];
      })()
    : [];

  const cols: Col<Json>[] = [
    { key: 'room', header: 'Room', cell: (s) => <Link className="rowlink" to={`/sessions/${s.room_sid}`} onClick={(e) => e.stopPropagation()}>{s.room_name}</Link> },
    { key: 'start', header: 'Started', cell: (s) => fromMs(s.started_at) },
    { key: 'dur', header: 'Duration', cell: (s) => durationMs(s.started_at, s.ended_at) },
    { key: 'feat', header: 'Features', cell: (s) => <div className="badges">{!!s.has_agent && <Badge>Agents</Badge>}{!!s.has_sip && <Badge>SIP</Badge>}{!!s.has_egress && <Badge>Egress</Badge>}</div> },
    { key: 'st', header: 'Status', cell: (s) => <StatusBadge status={s.ended_at ? 'closed' : 'active'} /> },
  ];
  const lkOk = !rooms.isError && !!rooms.data;
  const noEvents = collector.data && collector.data.events === 0;
  const big = (value: number | string | undefined, label: string, color: string) => (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color, fontSize: 32, lineHeight: 1.1 }}>{value ?? '…'}</div>
      <div style={{ color, opacity: 0.85, fontSize: 14, marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Overview' }]} title="Overview" sub="Live state of your self-hosted LiveKit server" range />
      <Kpis>
        <Kpi label="Active rooms" value={rooms.data?.length ?? '…'} accent to="/rooms" />
        <Kpi label="Participants online" value={rooms.data ? online : '…'} to="/rooms" />
        <Kpi label="Active calls" value={active.data?.total ?? '…'} to="/telephony/calls?state=active" />
        <Kpi label="System status" value={<span style={{ fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{rooms.isLoading ? '…' : lkOk ? <><CheckCircle2 size={16} color="var(--ok)" />LiveKit reachable</> : <><AlertTriangle size={16} color="var(--bad)" />LiveKit unreachable</>}</span>}
          foot={collector.data ? (collector.data.lastEventAt ? `Last webhook ${relTime(collector.data.lastEventAt)}` : 'No webhooks received yet') : undefined} />
      </Kpis>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {[
          { to: '/telephony/trunks', icon: Cable, label: 'Manage SIP trunks' },
          { to: '/telephony/dispatch', icon: GitBranch, label: 'Configure dispatch rules' },
          { to: '/telephony/phone-numbers', icon: Hash, label: 'Review phone numbers' },
          { to: '/usage', icon: BarChart3, label: 'View project usage' },
        ].map((a) => (
          <Link key={a.to} to={a.to} className="kpi link" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}><a.icon size={16} color="var(--accent)" aria-hidden />{a.label}<ArrowRight size={13} style={{ marginLeft: 'auto', opacity: 0.6 }} /></Link>
        ))}
        <a href="https://docs.livekit.io" target="_blank" rel="noopener noreferrer" className="kpi link" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}><BookOpen size={16} color="var(--accent)" aria-hidden />Docs and API reference<ArrowRight size={13} style={{ marginLeft: 'auto', opacity: 0.6 }} /></a>
      </div>
      {noEvents && <div className="alert warn">No webhook events have been received. History pages stay empty until LiveKit is configured to send webhooks to this console (<span className="mono">./deploy.sh webhook</span>).</div>}

      <h2 style={{ fontSize: 14, margin: '8px 0 10px', color: 'var(--accent)' }}>Insights</h2>
      <Panel>
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '18px 14px 0', flexWrap: 'wrap', gap: 12 }}>
          {big(i?.sessions?.toLocaleString(), 'Total sessions', PALETTE.cyan)}
          {big(i?.sessionsWithAgents?.toLocaleString(), 'With agents', PALETTE.purple)}
          {big(i?.sessionsWithTelephony?.toLocaleString(), 'With telephony', PALETTE.orange)}
        </div>
        <AreaChart data={merged} bucketMs={i?.bucketMs ?? 3600000} from={from} to={to} height={210}
          series={[{ key: 'total', label: 'Total sessions', color: PALETTE.cyan }, { key: 'agents', label: 'With agents', color: PALETTE.purple }, { key: 'sip', label: 'With telephony', color: PALETTE.orange }]} />
      </Panel>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Tile label="Average session duration" help="Mean time a session stayed open" value={i ? (i.avgSessionMs >= 60000 ? String(Math.round(i.avgSessionMs / 60000)) : String(Math.round(i.avgSessionMs / 1000))) : '…'} unit={i ? (i.avgSessionMs >= 60000 ? (Math.round(i.avgSessionMs / 60000) === 1 ? ' min' : ' mins') : ' secs') : undefined} />
        <Tile label="Agent session minutes" help="Total minutes agents spent inside sessions" value={i?.agentSessionMinutes?.toLocaleString() ?? '…'} unit=" mins" spark={i && <Spark points={i.agentMinSeries} from={from} to={to} bucketMs={i.bucketMs} fill={false} />} />
        <Tile label="Participants" help="Distinct participants that joined" value={i?.participants?.toLocaleString() ?? '…'} spark={i && <Spark points={i.peopleSeries} from={from} to={to} bucketMs={i.bucketMs} />} />
      </div>
      <div className="grid-2">
        <Panel title="Top countries" actions={<Help text="By the calling code of SIP callers' phone numbers; LiveKit has no client geolocation for phone calls" />}>
          <DataTable rows={i?.countries as Json[]} search={false} pageSize={false} rowKey={(c) => c.name} loading={insights.isLoading} empty={{ title: 'No SIP participants in this range' }} cols={[
            { key: 'n', header: '#', cell: (c) => (i!.countries as Json[]).indexOf(c) + 1 }, { key: 'name', header: 'Name', cell: (c) => c.name }, { key: 'count', header: 'Count', cell: (c) => c.count.toLocaleString() },
          ]} />
        </Panel>
        <Panel title="Participants" actions={<Help text="By participant kind. LiveKit's client platform data is not available for agents and phone callers" />}>
          <Donut items={(i?.kinds ?? []).map((k: Json) => ({ name: ({ SIP: 'SIP', AGENT: 'Agent', STANDARD: 'WebRTC', EGRESS: 'Egress', INGRESS: 'Ingress' } as Record<string, string>)[k.name] ?? k.name, count: k.count }))} />
        </Panel>
      </div>
      <Panel title="Recent sessions" actions={<Link className="btn ghost sm" to="/sessions">View all <ArrowRight size={13} /></Link>}>
        <DataTable rows={recent.data?.rows} cols={cols} rowKey={(s) => s.room_sid} search={false} pageSize={false} loading={recent.isLoading} onRow={(s) => navigate(`/sessions/${s.room_sid}`)} empty={{ title: 'No sessions in this range' }} />
      </Panel>
    </>
  );
}
