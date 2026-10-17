import { useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { Info, Radio } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useInitialQuery, useTab } from '../lib/useTab';
import { fromMs, fromMsPrecise, durationMs, kindLabel } from '../lib/format';
import { DataTable, type Col } from '../components/DataTable';
import { Spark, StepChart } from '../components/Charts';
import { Recording } from '../components/Recording';
import { Alert, Badge, KV, Kpi, Kpis, PageHeader, Panel, RangeSelect, ServerPager, StatusBadge, Tabs } from '../components/ui';
import { DirectionBadge } from './Calls';

const LIMIT = 50;
const stop = (e: React.MouseEvent) => e.stopPropagation();
const enc = encodeURIComponent;

export function Sessions() {
  const navigate = useNavigate();
  const [hours, setHours] = useState(24);
  const [q, setQ] = useState(useInitialQuery());
  const [status, setStatus] = useState('');
  const [params] = useSearchParams();
  const [feature, setFeature] = useState(params.get('feature') ?? '');
  const [offset, setOffset] = useState(0);
  const res = useApi<{ total: number; rows: Json[]; uniqueParticipants: number; totalRooms: number; bucketMs: number; series: { t: number; n: number }[]; peopleSeries: { t: number; n: number }[] }>(['sessions', hours, q, status, feature, offset], `/history/sessions?hours=${hours}&q=${enc(q)}&status=${status}&feature=${feature}&limit=${LIMIT}&offset=${offset}`);
  const reset = <T,>(f: (v: T) => void) => (v: T) => { f(v); setOffset(0); };

  const cols: Col<Json>[] = [
    { key: 'sid', header: 'Session ID', cell: (s) => <Link className="rowlink mono" to={`/sessions/${s.room_sid}`} onClick={stop}>{s.room_sid}</Link> },
    { key: 'room', header: 'Room name', cell: (s) => <Link className="rowlink" to={`/sessions/${s.room_sid}`} onClick={stop}>{s.room_name}</Link> },
    { key: 'start', header: 'Started at', cell: (s) => <span className="nowrap">{fromMs(s.started_at)}{s.partial === 1 ? ' *' : ''}{s.partial === 2 && <> <Badge tone="warn">Reconstructed</Badge></>}</span> },
    { key: 'end', header: 'Ended at', hidden: true, cell: (s) => fromMs(s.ended_at) },
    { key: 'dur', header: 'Duration', cell: (s) => durationMs(s.started_at, s.ended_at) },
    { key: 'parts', header: 'Participants', cell: (s) => s.participants },
    { key: 'feat', header: 'Features', cell: (s) => (
      <div className="badges" onClick={stop}>
        {!!s.has_agent && <Badge tone="info">Agents</Badge>}
        {!!s.has_sip && <Link className="badge" to={`/telephony/calls?q=${enc(s.room_name)}`} title="View this session's calls">SIP</Link>}
        {!!s.has_egress && <Link className="badge" to={`/egress?q=${enc(s.room_name)}`} title="View this session's egress">Egress</Link>}
      </div>
    ) },
    { key: 'status', header: 'Status', cell: (s) => <StatusBadge status={s.ended_at ? 'closed' : 'active'} /> },
  ];

  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Sessions' }]} title="Sessions" sub="Room sessions recorded from LiveKit webhooks since the collector started" />
      <Kpis>
        <Kpi label="Unique participants" value={res.data?.uniqueParticipants ?? '…'} spark={res.data && <Spark points={res.data.peopleSeries} from={Date.now() - hours * 3600000} to={Date.now()} bucketMs={res.data.bucketMs} />} />
        <Kpi label="Total rooms" value={res.data?.totalRooms ?? '…'} spark={res.data && <Spark points={res.data.series} from={Date.now() - hours * 3600000} to={Date.now()} bucketMs={res.data.bucketMs} color="#818cf8" />} />
        <Kpi label="Sessions" value={res.data?.total ?? '…'} help="Sessions matching the current filters" />
      </Kpis>
      <Panel>
        <DataTable rows={res.data?.rows} cols={cols} rowKey={(s) => s.room_sid} loading={res.isLoading} error={res.error} search={false} pageSize={false} storageKey="sessions"
          onRow={(s) => navigate(`/sessions/${s.room_sid}`)}
          toolbar={<>
            <input className="input" style={{ width: 240 }} placeholder="Search room name or session ID" aria-label="Search sessions" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
            <select className="select" style={{ width: 'auto' }} aria-label="Status" value={status} onChange={(e) => reset(setStatus)(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="closed">Closed</option></select>
            <select className="select" style={{ width: 'auto' }} aria-label="Feature" value={feature} onChange={(e) => reset(setFeature)(e.target.value)}><option value="">All features</option><option value="agents">Agents</option><option value="sip">SIP</option><option value="egress">Egress</option></select>
            <RangeSelect value={hours} onChange={reset(setHours)} />
          </>}
          empty={{ title: 'No sessions in this range', hint: 'Sessions appear once LiveKit webhooks reach this console.' }}
          footer={<><ServerPager offset={offset} limit={LIMIT} total={res.data?.total ?? 0} onChange={setOffset} /><div className="pager" style={{ justifyContent: 'flex-start', borderTop: 0, paddingTop: 0 }}>* started before the collector was running, so the start time is the first event seen. “Reconstructed” sessions were rebuilt from LiveKit's retained egress records (name, ID and times only; no participants).</div></>} />
      </Panel>
    </>
  );
}

/** An egress participant's identity is the egress ID, so it links straight to that egress. */
const isEgressIdentity = (id: string) => /^EG_[A-Za-z0-9]+$/.test(id);

export function SessionDetail() {
  const { sid = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useTab('analytics', ['analytics', 'events', 'insights'] as const);
  const { data, error } = useApi<Json>(['session', sid], `/history/sessions/${sid}`);
  const s = data?.session;
  const end = s?.ended_at ?? Date.now();

  const pcols: Col<Json>[] = [
    { key: 'identity', header: 'Participant identity', cell: (p) => <Link className="rowlink mono" to={`/sessions/${sid}/participants/${p.sid}`} onClick={stop}>{p.identity}</Link>, text: (p) => p.identity, sort: (p) => p.identity },
    { key: 'name', header: 'Name', cell: (p) => p.name || '—', text: (p) => p.name ?? '' },
    { key: 'joined', header: 'Joined at', cell: (p) => fromMsPrecise(p.joined_at), sort: (p) => p.joined_at },
    { key: 'left', header: 'Left at', cell: (p) => fromMsPrecise(p.left_at), sort: (p) => p.left_at ?? 0 },
    { key: 'dur', header: 'Time in room', cell: (p) => durationMs(p.joined_at, p.left_at) },
    { key: 'kind', header: 'Kind', cell: (p) => <Badge tone={p.kind === 'AGENT' ? 'info' : undefined}>{kindLabel(p.kind)}</Badge>, text: (p) => p.kind },
    { key: 'features', header: 'Used features', cell: (p) => (
      <div className="badges" onClick={stop}>
        {p.kind === 'SIP' && <Link className="badge" to={`/telephony/calls/${p.sid}`} title="Open this call">SIP call</Link>}
        {p.kind === 'EGRESS' && isEgressIdentity(p.identity) && <Link className="badge" to={`/egress/${p.identity}`} title="Open this egress">Egress</Link>}
        {p.kind === 'AGENT' && <Badge tone="info">Agent</Badge>}
      </div>
    ) },
  ];
  const ecols: Col<Json>[] = [
    { key: 'time', header: 'Timestamp', cell: (e) => <span className="mono nowrap">{fromMsPrecise(e.ts)}</span>, sort: (e) => e.ts },
    { key: 'who', header: 'Participant identity', cell: (e) => <span className="mono">{e.identity ?? '—'}</span>, text: (e) => e.identity ?? '' },
    { key: 'event', header: 'Event', cell: (e) => <span className="mono">{e.type}</span>, text: (e) => e.type },
  ];

  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Sessions', to: '/sessions' }, { label: sid }]} title={s?.room_name ?? sid}
        sub={s && <StatusBadge status={s.ended_at ? 'closed' : 'active'} />}
        actions={s && !s.ended_at ? <Link className="btn secondary" to={`/rooms/${enc(s.room_name)}`}><Radio size={14} />Open live room</Link> : undefined} />
      {error && <Alert kind="bad">{(error as Error).message}{' '}This session may predate the collector; only sessions seen since webhooks were enabled are recorded.</Alert>}
      {s?.partial === 2 && <Alert kind="warn">This session was reconstructed from LiveKit's egress record because it started before webhooks were enabled. Its name, ID, times and recording are known; participants and calls were not recorded.</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'analytics', label: 'Session analytics' }, { id: 'events', label: 'Session events', count: data?.events.length }, { id: 'insights', label: 'Agent insights' }]} />
      {s && tab === 'analytics' && (
        <>
          <Panel><KV items={[['Room name', s.room_name], ['Room session ID', <span className="mono">{s.room_sid}</span>], ['Unique participants', new Set((data!.participants as Json[]).map((p) => p.identity)).size], ['Start time', fromMs(s.started_at)], ['End time', fromMs(s.ended_at)], ['Duration', durationMs(s.started_at, s.ended_at)]]} /></Panel>
          {(data!.timeline as unknown[]).length > 0 && <Panel title="Session timeline"><StepChart points={data!.timeline} t0={s.started_at} t1={end} /></Panel>}
          <Panel title={`Participants (${data!.participants.length})`}>
            <DataTable rows={data!.participants as Json[]} cols={pcols} rowKey={(p) => p.sid} storageKey="session-parts" pageSize={false} onRow={(p) => navigate(`/sessions/${sid}/participants/${p.sid}`)} empty={{ title: 'No participants recorded' }} />
          </Panel>
          {(data!.calls as Json[]).length > 0 && (
            <Panel title={`Calls (${(data!.calls as Json[]).length})`}>
              <DataTable rows={data!.calls as Json[]} search={false} pageSize={false} rowKey={(c) => c.id} onRow={(c) => navigate(`/telephony/calls/${c.id}`)}
                cols={[
                  { key: 'id', header: 'Call ID', cell: (c) => <Link className="rowlink mono" to={`/telephony/calls/${c.id}`} onClick={stop}>{c.callId ?? c.id}</Link> },
                  { key: 'dir', header: 'Direction', cell: (c) => <DirectionBadge d={c.direction} /> },
                  { key: 'from', header: 'From', cell: (c) => c.from ?? '—' }, { key: 'to', header: 'To', cell: (c) => c.to ?? '—' },
                  { key: 'dur', header: 'Duration', cell: (c) => durationMs(c.joinedAt, c.leftAt) }, { key: 'st', header: 'Status', cell: (c) => <StatusBadge status={c.state} /> },
                ]} />
            </Panel>
          )}
          {(data!.egress as Json[]).length > 0 && (
            <Panel title={`Egresses (${(data!.egress as Json[]).length})`}>
              <DataTable rows={data!.egress as Json[]} search={false} pageSize={false} rowKey={(e) => e.egress_id} onRow={(e) => navigate(`/egress/${e.egress_id}`)}
                cols={[
                  { key: 'id', header: 'Egress ID', cell: (e) => <Link className="rowlink mono" to={`/egress/${e.egress_id}`} onClick={stop}>{e.egress_id}</Link> },
                  { key: 's', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> }, { key: 't', header: 'Started', cell: (e) => fromMs(e.started_at) },
                  { key: 'd', header: 'Duration', cell: (e) => durationMs(e.started_at, e.ended_at) },
                  { key: 'dest', header: 'Destination', cell: (e) => <span className="mono">{e.destination}</span> },
                  { key: 'rec', header: 'Recording', cell: (e) => <span onClick={stop}><Recording file={e.files?.[0]} /></span> },
                ]} />
            </Panel>
          )}
          <Alert><Info size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Bandwidth, latency, packet loss and FPS graphs come from LiveKit Cloud's analytics pipeline. The open-source server does not expose them per session.</Alert>
        </>
      )}
      {s && tab === 'events' && (
        <Panel><DataTable rows={data!.events as Json[]} cols={ecols} rowKey={(e) => e.id} pageSize={50} storageKey="session-events" empty={{ title: 'No events' }} /></Panel>
      )}
      {tab === 'insights' && <Alert>Agent insights (transcripts, turn timing, observability) are a LiveKit Cloud feature. Your agent worker can export its own traces; nothing is recorded by the server itself.</Alert>}
    </>
  );
}

export function ParticipantDetail() {
  const { sid = '', psid = '' } = useParams();
  const [tab, setTab] = useTab('overview', ['overview', 'events'] as const);
  const { data, error } = useApi<Json>(['participant', sid, psid], `/history/sessions/${sid}/participants/${psid}`);
  const p = data?.participant;
  const attrs = Object.entries(p?.attributes ?? {});
  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Sessions', to: '/sessions' }, { label: sid, to: `/sessions/${sid}` }, { label: psid }]} title={p?.identity ?? psid} sub={p && <Badge>{kindLabel(p.kind)}</Badge>}
        actions={<>
          {p?.kind === 'SIP' && <Link className="btn secondary" to={`/telephony/calls/${p.sid}`}>View call</Link>}
          {p?.kind === 'EGRESS' && isEgressIdentity(p.identity) && <Link className="btn secondary" to={`/egress/${p.identity}`}>View egress</Link>}
          <Link className="btn secondary" to={`/sessions/${sid}`}>View session</Link>
        </>} />
      {error && <Alert kind="bad">{(error as Error).message}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Participant analytics' }, { id: 'events', label: 'Participant events', count: data?.events.length }]} />
      {p && tab === 'overview' && (
        <>
          <Panel><KV items={[['Participant identity', <span className="mono">{p.identity}</span>], ['Participant name', p.name || '—'], ['Participant session ID', <span className="mono">{p.sid}</span>], ['Session', <Link to={`/sessions/${sid}`} className="mono">{sid}</Link>], ['Joined at', fromMs(p.joined_at)], ['Left at', fromMs(p.left_at)], ['Duration', durationMs(p.joined_at, p.left_at)]]} /></Panel>
          <Panel title="Participant sessions">
            <DataTable rows={data!.sessions as Json[]} search={false} pageSize={false} rowKey={(x) => x.sid} cols={[
              { key: 'sid', header: 'Participant session ID', cell: (x) => x.sid === psid ? <span className="mono">{x.sid} (this page)</span> : <Link className="rowlink mono" to={`/sessions/${sid}/participants/${x.sid}`}>{x.sid}</Link> },
              { key: 'dur', header: 'Duration', cell: (x) => durationMs(x.joined_at, x.left_at) }, { key: 'j', header: 'Joined at', cell: (x) => fromMsPrecise(x.joined_at) }, { key: 'l', header: 'Last active at', cell: (x) => fromMsPrecise(x.left_at) },
            ]} />
          </Panel>
          <Panel title={`Published tracks (${data!.tracks.length})`}>
            <DataTable rows={data!.tracks as Json[]} search={false} pageSize={false} rowKey={(t) => t.sid} empty={{ title: 'No track events recorded', hint: 'Track events are recorded from webhooks.' }} cols={[
              { key: 'sid', header: 'Track ID', cell: (t) => <span className="mono">{t.sid}</span> }, { key: 'name', header: 'Name', cell: (t) => t.name || '—' },
              { key: 'type', header: 'Type', cell: (t) => <Badge>{(t.type ?? '').toString().toLowerCase()}</Badge> }, { key: 'src', header: 'Source', cell: (t) => (t.source ?? '—').toString().toLowerCase() }, { key: 'mime', header: 'MIME', cell: (t) => t.mimeType ?? '—' },
            ]} />
          </Panel>
          <Panel title={`Attributes (${attrs.length})`}>
            <DataTable rows={attrs} search={attrs.length > 8} pageSize={false} rowKey={([k]) => k} empty={{ title: 'No attributes' }} cols={[
              { key: 'k', header: 'Key', cell: ([k]) => <span className="mono">{k}</span>, text: ([k]) => k }, { key: 'v', header: 'Value', cell: ([, v]) => <span className="mono">{String(v)}</span>, text: ([, v]) => String(v), wrap: true },
            ]} />
          </Panel>
        </>
      )}
      {p && tab === 'events' && (
        <Panel><DataTable rows={data!.events as Json[]} rowKey={(e) => e.id} pageSize={50} empty={{ title: 'No events' }} cols={[
          { key: 't', header: 'Timestamp', cell: (e) => <span className="mono">{fromMsPrecise(e.ts)}</span>, sort: (e) => e.ts }, { key: 'e', header: 'Event', cell: (e) => <span className="mono">{e.type}</span>, text: (e) => e.type },
        ]} /></Panel>
      )}
    </>
  );
}
