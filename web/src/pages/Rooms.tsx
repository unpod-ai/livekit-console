import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, UserMinus, Bot } from 'lucide-react';
import { api, type Json } from '../lib/api';
import { useApi, useMutate } from '../lib/hooks';
import { useConfirm } from '../lib/confirm';
import { fromSeconds, kindLabel } from '../lib/format';
import { Drawer } from '../components/Drawer';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Field, PageHeader, Panel, StatusBadge } from '../components/ui';

export function Rooms() {
  const navigate = useNavigate();
  const rooms = useApi<Json[]>(['rooms'], '/rooms');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [timeout, setTimeoutS] = useState('300');
  const [max, setMax] = useState('0');
  const confirm = useConfirm();
  const create = useMutate(() => api('/rooms', { method: 'POST', body: { name, emptyTimeout: Number(timeout), maxParticipants: Number(max) } }), { invalidate: [['rooms']], success: 'Room created' });
  const del = useMutate((n: string) => api(`/rooms/${encodeURIComponent(n)}`, { method: 'DELETE' }), { invalidate: [['rooms']], success: 'Room deleted' });

  const cols: Col<Json>[] = [
    { key: 'name', header: 'Room name', cell: (r) => <b>{r.name}</b>, text: (r) => r.name, sort: (r) => r.name },
    { key: 'sid', header: 'Room SID', cell: (r) => <span className="mono">{r.sid}</span>, text: (r) => r.sid },
    { key: 'parts', header: 'Participants', cell: (r) => r.numParticipants ?? 0, sort: (r) => r.numParticipants ?? 0 },
    { key: 'pubs', header: 'Publishers', hidden: true, cell: (r) => r.numPublishers ?? 0 },
    { key: 'created', header: 'Created', cell: (r) => fromSeconds(r.creationTime), sort: (r) => Number(r.creationTime) },
    { key: 'session', header: 'Session', cell: (r) => <Link className="rowlink" to={`/sessions/${r.sid}`} onClick={(e) => e.stopPropagation()}>History</Link> },
    { key: 'timeout', header: 'Empty timeout', hidden: true, cell: (r) => `${r.emptyTimeout ?? 0}s` },
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Live rooms' }]} title="Live rooms" sub="Rooms that exist on the server right now" actions={<button className="btn" onClick={() => setCreating(true)}><Plus size={15} />Create room</button>} />
      <Panel>
        <DataTable rows={rooms.data} cols={cols} rowKey={(r) => r.sid} loading={rooms.isLoading} error={rooms.error} storageKey="rooms" onRow={(r) => navigate(`/rooms/${encodeURIComponent(r.name)}`)} empty={{ title: 'No active rooms', hint: 'Rooms are created when a participant joins, or create one here.' }}
          rowActions={(r) => <button className="btn ghost icon sm" aria-label={`Delete ${r.name}`} onClick={async () => (await confirm({ title: 'Delete room?', message: `${r.name} will be closed and all participants disconnected.`, confirmLabel: 'Delete room', danger: true })) && del.mutate(r.name)}><Trash2 size={14} color="var(--bad)" /></button>} />
      </Panel>
      <Drawer open={creating} title="Create room" onClose={() => setCreating(false)}
        footer={<><button className="btn secondary" onClick={() => setCreating(false)}>Cancel</button><button className="btn" disabled={!name || create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => { setCreating(false); setName(''); } })}>Create</button></>}>
        <Field label="Room name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid-2">
          <Field label="Empty timeout (seconds)" hint="Close the room this long after the last participant leaves."><input className="input" type="number" min={0} value={timeout} onChange={(e) => setTimeoutS(e.target.value)} /></Field>
          <Field label="Max participants" hint="0 means unlimited."><input className="input" type="number" min={0} value={max} onChange={(e) => setMax(e.target.value)} /></Field>
        </div>
      </Drawer>
    </>
  );
}

export function RoomDetail() {
  const { name = '' } = useParams();
  const enc = encodeURIComponent(name);
  const parts = useApi<Json[]>(['room-parts', name], `/rooms/${enc}/participants`);
  const disp = useApi<Json[]>(['room-disp', name], `/rooms/${enc}/dispatches`);
  const [agent, setAgent] = useState('');
  const [meta, setMeta] = useState('');
  const confirm = useConfirm();
  const kick = useMutate((id: string) => api(`/rooms/${enc}/participants/${encodeURIComponent(id)}`, { method: 'DELETE' }), { invalidate: [['room-parts', name]], success: 'Participant removed' });
  const dispatch = useMutate(() => api(`/rooms/${enc}/dispatches`, { method: 'POST', body: { agentName: agent, metadata: meta } }), { invalidate: [['room-disp', name]], success: 'Agent dispatched' });
  const undispatch = useMutate((id: string) => api(`/rooms/${enc}/dispatches/${id}`, { method: 'DELETE' }), { invalidate: [['room-disp', name]], success: 'Dispatch removed' });

  const cols: Col<Json>[] = [
    { key: 'id', header: 'Identity', cell: (p) => <span className="mono">{p.identity}</span>, text: (p) => p.identity, sort: (p) => p.identity },
    { key: 'name', header: 'Name', cell: (p) => p.name || '—', text: (p) => p.name ?? '' },
    { key: 'kind', header: 'Kind', cell: (p) => <Badge tone={p.kind === 'AGENT' ? 'info' : undefined}>{kindLabel(p.kind)}</Badge> },
    { key: 'state', header: 'State', cell: (p) => <StatusBadge status={p.state} /> },
    { key: 'tracks', header: 'Tracks', cell: (p) => (p.tracks ?? []).map((t: Json) => `${(t.type ?? '').toLowerCase()}${t.muted ? ' (muted)' : ''}`).join(', ') || '—' },
    { key: 'joined', header: 'Joined', cell: (p) => fromSeconds(p.joinedAt) },
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Live rooms', to: '/rooms' }, { label: name }]} title={name} sub="Live participants and agent dispatch" actions={<Link className="btn secondary" to={`/sessions?q=${encodeURIComponent(name)}`}>Session history</Link>} />
      {parts.error && <Alert kind="bad">{(parts.error as Error).message}</Alert>}
      <Panel title={`Participants (${parts.data?.length ?? 0})`}>
        <DataTable rows={parts.data} cols={cols} rowKey={(p) => p.sid} loading={parts.isLoading} pageSize={false} empty={{ title: 'Nobody is in this room' }}
          rowActions={(p) => <button className="btn ghost icon sm" aria-label={`Remove ${p.identity}`} onClick={async () => (await confirm({ title: 'Remove participant?', message: `${p.identity} will be disconnected from the room.`, confirmLabel: 'Remove', danger: true })) && kick.mutate(p.identity)}><UserMinus size={14} color="var(--bad)" /></button>} />
      </Panel>
      <Panel title="Agent dispatch" icon={<Bot size={15} />}>
        <div className="panel-body">
          <div className="grid-2">
            <Field label="Agent name"><input className="input" value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="my-agent-name" /></Field>
            <Field label="Metadata (optional)"><input className="input" value={meta} onChange={(e) => setMeta(e.target.value)} /></Field>
          </div>
          <button className="btn" disabled={!agent || dispatch.isPending} onClick={() => dispatch.mutate(undefined, { onSuccess: () => { setAgent(''); setMeta(''); } })}>Dispatch agent to this room</button>
        </div>
        <DataTable rows={disp.data} search={false} pageSize={false} rowKey={(d) => d.id} loading={disp.isLoading} empty={{ title: 'No agent dispatches for this room' }}
          cols={[{ key: 'id', header: 'Dispatch ID', cell: (d) => <span className="mono">{d.id}</span> }, { key: 'a', header: 'Agent', cell: (d) => d.agentName }, { key: 'm', header: 'Metadata', cell: (d) => d.metadata || '—' }, { key: 's', header: 'Jobs', cell: (d) => d.state?.jobs?.length ?? 0 }]}
          rowActions={(d) => <button className="btn ghost icon sm" aria-label="Delete dispatch" onClick={() => undispatch.mutate(d.id)}><Trash2 size={14} color="var(--bad)" /></button>} />
      </Panel>
      <Link className="btn secondary" to="/rooms">Back to rooms</Link>
    </>
  );
}
