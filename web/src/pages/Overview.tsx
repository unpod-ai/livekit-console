import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, AlertTriangle, BookOpen, BarChart3, Cable, CheckCircle2, GitBranch, Hash } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtMs, fromMs, durationMs, relTime } from '../lib/format';
import { DataTable, type Col } from '../components/DataTable';
import { BarsChart } from '../components/Charts';
import { Badge, Kpi, Kpis, PageHeader, Panel, RangeSelect, StatusBadge } from '../components/ui';

export function Overview() {
  const navigate = useNavigate();
  const [hours, setHours] = useState(168);
  const insights = useApi<Json>(['insights', hours], `/history/insights?hours=${hours}`);
  const rooms = useApi<Json[]>(['rooms'], '/rooms');
  const active = useApi<Json>(['calls-active'], '/history/calls?hours=24&state=active&limit=1');
  const recent = useApi<Json>(['sessions-recent'], '/history/sessions?hours=168&limit=8');
  const collector = useApi<Json>(['collector'], '/history/collector');
  const i = insights.data;
  const online = (rooms.data ?? []).reduce((n, r) => n + (r.numParticipants ?? 0), 0);

  const cols: Col<Json>[] = [
    { key: 'room', header: 'Room', cell: (s) => <Link className="rowlink" to={`/sessions/${s.room_sid}`} onClick={(e) => e.stopPropagation()}>{s.room_name}</Link> },
    { key: 'start', header: 'Started', cell: (s) => fromMs(s.started_at) },
    { key: 'dur', header: 'Duration', cell: (s) => durationMs(s.started_at, s.ended_at) },
    { key: 'feat', header: 'Features', cell: (s) => <div className="badges">{!!s.has_agent && <Badge tone="info">Agents</Badge>}{!!s.has_sip && <Badge>SIP</Badge>}{!!s.has_egress && <Badge>Egress</Badge>}</div> },
    { key: 'st', header: 'Status', cell: (s) => <StatusBadge status={s.ended_at ? 'closed' : 'active'} /> },
  ];
  const lkOk = !rooms.isError && !!rooms.data;
  const noEvents = collector.data && collector.data.events === 0;

  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Overview' }]} title="Overview" sub="Live state of your self-hosted LiveKit server" />
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
      {noEvents && (
        <div className="alert warn">No webhook events have been received. History pages stay empty until LiveKit is configured to send webhooks to this console (<span className="mono">./deploy.sh webhook</span>).</div>
      )}
      <Panel title="Insights" actions={<RangeSelect value={hours} onChange={setHours} />}>
        <div className="kpis">
          <Kpi label="Sessions served" value={i?.sessions?.toLocaleString() ?? '…'} to="/sessions" />
          <Kpi label="With agents" value={i?.sessionsWithAgents?.toLocaleString() ?? '…'} to="/sessions?feature=agents" />
          <Kpi label="With telephony" value={i?.sessionsWithTelephony?.toLocaleString() ?? '…'} to="/sessions?feature=sip" />
          <Kpi label="Avg session duration" value={i ? fmtMs(i.avgSessionMs) : '…'} />
          <Kpi label="Agent session minutes" value={i?.agentSessionMinutes?.toLocaleString() ?? '…'} />
          <Kpi label="Participants" value={i?.participants?.toLocaleString() ?? '…'} />
        </div>
        <BarsChart data={(i?.series ?? []).map((p: Json) => ({ t: p.t, sessions: p.n }))} series={[{ key: 'sessions', label: 'Sessions', color: 'var(--accent)' }]} bucketMs={i?.bucketMs ?? 3600000} from={Date.now() - hours * 3600000} to={Date.now()} />
      </Panel>
      <Panel title="Recent sessions" actions={<Link className="btn ghost sm" to="/sessions">View all <ArrowRight size={13} /></Link>}>
        <DataTable rows={recent.data?.rows} cols={cols} rowKey={(s) => s.room_sid} search={false} pageSize={false} loading={recent.isLoading} onRow={(s) => navigate(`/sessions/${s.room_sid}`)} empty={{ title: 'No sessions yet' }} />
      </Panel>
    </>
  );
}
