import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Info } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useTab } from '../lib/useTab';
import { fromMs, fromMsPrecise, durationMs, fmtMs } from '../lib/format';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, KV, Kpi, Kpis, PageHeader, Panel, RangeSelect, ServerPager, StatusBadge, Tabs } from '../components/ui';

const LIMIT = 50;
export const DirectionBadge = ({ d }: { d: string | null }) =>
  d === 'inbound' ? <Badge tone="info"><ArrowDownLeft size={11} />Inbound</Badge> : d === 'outbound' ? <Badge><ArrowUpRight size={11} />Outbound</Badge> : <Badge>Unknown</Badge>;

export function Calls() {
  const navigate = useNavigate();
  const [hours, setHours] = useState(24);
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [state, setState] = useState('');
  const [offset, setOffset] = useState(0);
  const res = useApi<Json>(['calls', hours, q, direction, state, offset], `/history/calls?hours=${hours}&q=${encodeURIComponent(q)}&direction=${direction}&state=${state}&limit=${LIMIT}&offset=${offset}`);
  const reset = <T,>(f: (v: T) => void) => (v: T) => { f(v); setOffset(0); };
  const d = res.data;

  const cols: Col<Json>[] = [
    { key: 'id', header: 'Call ID', cell: (c) => <span className="mono">{c.callId ?? c.id}</span> },
    { key: 'from', header: 'From', cell: (c) => c.from ?? '—' },
    { key: 'to', header: 'To', cell: (c) => c.to ?? '—' },
    { key: 'dir', header: 'Direction', cell: (c) => <DirectionBadge d={c.direction} /> },
    { key: 'start', header: 'Started at', cell: (c) => <span className="nowrap">{fromMs(c.joinedAt)}</span> },
    { key: 'end', header: 'Ended at', hidden: true, cell: (c) => fromMs(c.leftAt) },
    { key: 'dur', header: 'Duration', cell: (c) => durationMs(c.joinedAt, c.leftAt) },
    { key: 'session', header: 'Session', cell: (c) => <Link to={`/sessions/${c.roomSid}`} onClick={(e) => e.stopPropagation()}>{c.roomName}</Link> },
    { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.state} /> },
  ];

  return (
    <>
      <PageHeader crumbs={[{ label: 'Telephony' }, { label: 'Calls' }]} title="Calls" sub="SIP calls reconstructed from SIP participants in your rooms" />
      <Kpis>
        <Kpi label="Total calls" value={d?.total?.toLocaleString() ?? '…'} />
        <Kpi label="Total call duration" value={d ? fmtMs(d.totalDurationMs) : '…'} />
        <Kpi label="Average call duration" value={d ? fmtMs(d.avgDurationMs) : '…'} />
        <Kpi label="Active calls" value={d?.active ?? '…'} accent />
      </Kpis>
      <Panel>
        <DataTable rows={d?.rows} cols={cols} rowKey={(c) => c.id} loading={res.isLoading} error={res.error} search={false} pageSize={false} storageKey="calls" onRow={(c) => navigate(`/telephony/calls/${c.id}`)}
          toolbar={<>
            <input className="input" style={{ width: 240 }} placeholder="Search number, call ID or room" aria-label="Search calls" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
            <select className="select" style={{ width: 'auto' }} aria-label="Direction" value={direction} onChange={(e) => reset(setDirection)(e.target.value)}><option value="">All directions</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select>
            <select className="select" style={{ width: 'auto' }} aria-label="Status" value={state} onChange={(e) => reset(setState)(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="completed">Completed</option></select>
            <RangeSelect value={hours} onChange={reset(setHours)} />
          </>}
          empty={{ title: 'No calls in this range', hint: 'Calls appear once a SIP participant joins a room and LiveKit webhooks reach this console.' }}
          footer={<ServerPager offset={offset} limit={LIMIT} total={d?.total ?? 0} onChange={setOffset} />} />
      </Panel>
      <Alert><Info size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Calls that are rejected before a room is created (carrier errors, no matching trunk or rule) never produce a webhook, so they cannot appear here. Check the livekit-sip logs for those.</Alert>
    </>
  );
}

export function CallDetail() {
  const { id = '' } = useParams();
  const [tab, setTab] = useTab('overview', ['overview', 'events'] as const);
  const { data, error } = useApi<Json>(['call', id], `/history/calls/${id}`);
  const c = data?.call;
  const attrs = Object.entries(c?.attributes ?? {});
  return (
    <>
      <PageHeader crumbs={[{ label: 'Telephony' }, { label: 'Calls', to: '/telephony/calls' }, { label: c?.direction ? c.direction.replace(/^./, (x: string) => x.toUpperCase()) : 'Call' }, { label: c?.callId ?? id }]} title={c?.callId ?? id} sub={c && <><DirectionBadge d={c.direction} /> <StatusBadge status={c.state} /></>} />
      {error && <Alert kind="bad">{(error as Error).message}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Call overview' }, { id: 'events', label: 'Events', count: data?.events.length }]} />
      {c && tab === 'overview' && (
        <>
          <Panel title="Call overview"><KV items={[['Call ID', <span className="mono">{c.callId ?? '—'}</span>], ['Started at', fromMs(c.joinedAt)], ['Ended at', fromMs(c.leftAt)], ['Duration', durationMs(c.joinedAt, c.leftAt)], ['Session', <Link to={`/sessions/${c.roomSid}`}>{c.roomName}</Link>], ['Status', <StatusBadge status={c.state} />]]} /></Panel>
          <div className="grid-2">
            <Panel title="SIP details"><KV items={[['Direction', <DirectionBadge d={c.direction} />], ['Trunk ID', <span className="mono">{c.trunkId ?? '—'}</span>], ['Dispatch rule', <span className="mono">{c.ruleId ?? '—'}</span>], ['Last call status', c.callStatus ?? '—']]} /></Panel>
            <Panel title="Call details"><KV items={[['From number', c.from ?? '—'], ['To number', c.to ?? '—'], ['Participant', <Link to={`/sessions/${c.roomSid}/participants/${c.id}`} className="mono">{c.identity}</Link>]]} /></Panel>
          </div>
          <Panel title={`SIP attributes (${attrs.length})`}>
            <DataTable rows={attrs} search={attrs.length > 8} pageSize={false} rowKey={([k]) => k} cols={[{ key: 'k', header: 'Key', cell: ([k]) => <span className="mono">{k}</span>, text: ([k]) => k }, { key: 'v', header: 'Value', cell: ([, v]) => <span className="mono">{String(v)}</span>, text: ([, v]) => String(v), wrap: true }]} />
          </Panel>
          <Alert><Info size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Codec, SIP response code, source host and PCAP capture are collected by the SIP service itself and are not available over the API. Enable <span className="mono">include_headers</span> on the trunk to copy SIP headers into the attributes above.</Alert>
        </>
      )}
      {c && tab === 'events' && (
        <Panel><DataTable rows={data!.events as Json[]} rowKey={(e) => e.id} pageSize={50} cols={[{ key: 't', header: 'Timestamp', cell: (e) => <span className="mono">{fromMsPrecise(e.ts)}</span> }, { key: 'e', header: 'Event', cell: (e) => <span className="mono">{e.type}</span> }]} empty={{ title: 'No events' }} /></Panel>
      )}
    </>
  );
}
