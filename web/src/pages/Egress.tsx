import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Square } from 'lucide-react';
import { lk, type Json } from '../lib/api';
import { useApi, useLkList, useMutate } from '../lib/hooks';
import { useInitialQuery, useTab } from '../lib/useTab';
import { useConfirm } from '../lib/confirm';
import { durationMs, fmtBytes, fmtMs, fromMs, fromMsPrecise } from '../lib/format';
import { egressDestination, egressFiles, type EgressFile } from '../lib/egress';
import { Drawer } from '../components/Drawer';
import { JsonEditor, parseJson } from '../components/JsonEditor';
import { DataTable, type Col } from '../components/DataTable';
import { Recording } from '../components/Recording';
import { Alert, CopyButton, Field, KV, PageHeader, Panel, StatusBadge, Tabs } from '../components/ui';

type Row = { id: string; room: string; roomSid?: string; status: string; started: number | null; ended: number | null; type: string; dest: string; files: EgressFile[]; error?: string; raw?: Json };

const lkType = (e: Json) => (e.roomComposite ? 'Room composite' : e.participant ? 'Participant' : e.trackComposite ? 'Track composite' : e.track ? 'Track' : e.web ? 'Web' : 'Unknown');
const nsToMs = (v?: string) => (Number(v) ? Math.round(Number(v) / 1e6) : null);
const requestOf = (e: Json) => e.roomComposite ?? e.participant ?? e.trackComposite ?? e.track ?? e.web ?? {};
const active = (s: string) => /ACTIVE|STARTING/.test(s);
const sessionLink = (r: { roomSid?: string; room: string }) => (r.roomSid ? `/sessions/${r.roomSid}` : `/sessions?q=${encodeURIComponent(r.room)}`);

const TEMPLATES: Record<string, { method: string; label: string; body: Json }> = {
  roomComposite: { method: 'StartRoomCompositeEgress', label: 'Room composite (record a whole room)', body: { roomName: 'room-name', layout: 'speaker', audioOnly: true, fileOutputs: [{ filepath: '{room_name}-{time}.mp4' }] } },
  participant: { method: 'StartParticipantEgress', label: 'Participant (record one participant)', body: { roomName: 'room-name', identity: 'participant-identity', fileOutputs: [{ filepath: '{room_name}-{publisher_identity}-{time}.mp4' }] } },
  trackComposite: { method: 'StartTrackCompositeEgress', label: 'Track composite (one audio + one video track)', body: { roomName: 'room-name', audioTrackId: 'TR_xxx', fileOutputs: [{ filepath: '{room_name}-{time}.mp4' }] } },
  track: { method: 'StartTrackEgress', label: 'Track (raw single track)', body: { roomName: 'room-name', trackId: 'TR_xxx', file: { filepath: '{track_id}-{time}' } } },
  web: { method: 'StartWebEgress', label: 'Web (record a web page)', body: { url: 'https://example.com', fileOutputs: [{ filepath: 'web-{time}.mp4' }] } },
};

function StartDrawer({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState('roomComposite');
  const [json, setJson] = useState(JSON.stringify(TEMPLATES.roomComposite.body, null, 2));
  const start = useMutate(async () => {
    const p = parseJson(json);
    if (p.error) throw new Error(p.error);
    return lk('egress', TEMPLATES[type].method, p.value);
  }, { invalidate: [['lk', 'egress'], ['egress-history']], success: 'Egress started' });
  return (
    <Drawer open wide title="Start egress" subtitle="Record or stream a room, participant, track or web page." onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={start.isPending || !!parseJson(json).error} onClick={() => start.mutate(undefined, { onSuccess: onClose })}>Start</button></>}>
      <Field label="Egress type">
        <select className="select" value={type} onChange={(e) => { setType(e.target.value); setJson(JSON.stringify(TEMPLATES[e.target.value].body, null, 2)); }}>
          {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
      </Field>
      <Alert>Where files go is decided by the egress service's own storage settings. To send them to your own bucket, add an <span className="mono">s3</span> (or <span className="mono">gcp</span>/<span className="mono">azure</span>) block next to <span className="mono">filepath</span>.</Alert>
      <Field label="Request (JSON)"><JsonEditor value={json} onChange={setJson} /></Field>
      {start.error && <Alert kind="bad">{(start.error as Error).message}</Alert>}
    </Drawer>
  );
}

export function Egress() {
  const navigate = useNavigate();
  const initialQuery = useInitialQuery();
  const live = useLkList('egress', 'ListEgress', { live: true });
  const hist = useApi<Json[]>(['egress-history'], '/history/egress?hours=720');
  const [starting, setStarting] = useState(false);
  const confirm = useConfirm();
  const stop = useMutate((id: string) => lk('egress', 'StopEgress', { egressId: id }), { invalidate: [['lk', 'egress'], ['egress-history']], success: 'Egress stopping' });

  // LiveKit's own list is authoritative for what it still retains; the collector adds older history.
  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    (hist.data ?? []).forEach((h) => m.set(h.egress_id, { id: h.egress_id, room: h.room_name ?? '', roomSid: h.room_sid ?? undefined, status: h.status, started: h.started_at, ended: h.ended_at, type: h.type, dest: h.destination ?? '—', files: h.files ?? [] }));
    (live.data ?? []).forEach((e) => m.set(e.egressId, { id: e.egressId, room: e.roomName ?? '', roomSid: e.roomId || undefined, status: e.status, started: nsToMs(e.startedAt), ended: nsToMs(e.endedAt), type: lkType(e), dest: egressDestination(e), files: egressFiles(e), error: e.error || undefined, raw: e }));
    return [...m.values()].sort((a, b) => (b.started ?? 0) - (a.started ?? 0));
  }, [live.data, hist.data]);

  const cols: Col<Row>[] = [
    { key: 'id', header: 'Egress ID', cell: (e) => <Link className="rowlink mono" to={`/egress/${e.id}`} onClick={(ev) => ev.stopPropagation()}>{e.id}</Link>, text: (e) => e.id },
    { key: 'start', header: 'Started at', cell: (e) => fromMs(e.started), sort: (e) => e.started ?? 0 },
    { key: 'dur', header: 'Duration', cell: (e) => durationMs(e.started, e.ended) },
    { key: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} />, text: (e) => e.status },
    { key: 'type', header: 'Type', cell: (e) => e.type, text: (e) => e.type },
    { key: 'room', header: 'Source (session)', cell: (e) => (e.room ? <Link className="rowlink" to={sessionLink(e)} onClick={(ev) => ev.stopPropagation()}>{e.room}</Link> : '—'), text: (e) => e.room },
    { key: 'dest', header: 'Destination', cell: (e) => <span className="mono">{e.dest}</span>, text: (e) => e.dest },
    { key: 'rec', header: 'Recording', cell: (e) => <span onClick={(ev) => ev.stopPropagation()}><Recording file={e.files[0]} sessionSid={e.roomSid} egressId={e.id} /></span>, text: (e) => e.files.map((f) => `${f.name} ${f.location}`).join(' ') },
    { key: 'size', header: 'Size', hidden: true, cell: (e) => (e.files[0]?.size ? fmtBytes(e.files[0].size) : '—') },
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: 'Media' }, { label: 'Egress' }]} title="Egress" sub="Recordings and streams" actions={<button className="btn" onClick={() => setStarting(true)}><Plus size={15} />Start egress</button>} />
      <Panel>
        <DataTable rows={rows} cols={cols} rowKey={(e) => e.id} loading={live.isLoading} error={live.error} storageKey="egress" initialQuery={initialQuery} onRow={(e) => navigate(`/egress/${e.id}`)} empty={{ title: 'No egress', hint: 'Start a recording, or egress appears here when a room is recorded.' }}
          rowActions={(e) => active(e.status) ? <button className="btn danger sm" onClick={async () => (await confirm({ title: 'Stop egress?', message: `${e.id} will finish and upload what it has recorded.`, confirmLabel: 'Stop', danger: true })) && stop.mutate(e.id)}><Square size={12} />Stop</button> : null} />
      </Panel>
      {starting && <StartDrawer onClose={() => setStarting(false)} />}
    </>
  );
}

export function EgressDetail() {
  const { id = '' } = useParams();
  const [tab, setTab] = useTab('overview', ['overview', 'events'] as const);
  // LiveKit keeps the full record for recent egresses; fall back to what the webhook collector stored.
  const fromLk = useLkList('egress', 'ListEgress', { body: { egressId: id }, live: true });
  const stored = useApi<Json>(['egress-stored', id], `/history/egress/${id}`, { live: false });
  const stop = useMutate(() => lk('egress', 'StopEgress', { egressId: id }), { invalidate: [['lk', 'egress'], ['egress-history']], success: 'Egress stopping' });
  const confirm = useConfirm();

  const lkRaw = fromLk.data?.[0];
  const st = stored.data?.egress;
  const row: Row | null = lkRaw
    ? { id, room: lkRaw.roomName ?? '', roomSid: lkRaw.roomId || st?.roomSid, status: lkRaw.status, started: nsToMs(lkRaw.startedAt), ended: nsToMs(lkRaw.endedAt), type: lkType(lkRaw), dest: egressDestination(lkRaw), files: egressFiles(lkRaw), error: lkRaw.error || undefined, raw: lkRaw }
    : st ? { id, room: st.roomName ?? '', roomSid: st.roomSid ?? undefined, status: st.status, started: st.startedAt, ended: st.endedAt, type: st.type, dest: st.destination, files: st.files ?? [], error: st.error ?? undefined } : null;
  const request = lkRaw ? requestOf(lkRaw) : stored.data?.request;
  const loading = fromLk.isLoading || (stored.isLoading && !row);

  return (
    <>
      <PageHeader crumbs={[{ label: 'Media' }, { label: 'Egress', to: '/egress' }, { label: id }]} title={id} sub={row && <StatusBadge status={row.status} />}
        actions={row && active(row.status) ? <button className="btn danger" onClick={async () => (await confirm({ title: 'Stop egress?', message: `${id} will finish and upload what it has recorded.`, confirmLabel: 'Stop', danger: true })) && stop.mutate()}><Square size={13} />Stop egress</button> : undefined} />
      {!row && !loading && <Alert kind="bad">This egress is no longer retained by LiveKit and was not seen by the collector.</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Egress overview' }, { id: 'events', label: 'Events', count: stored.data?.events?.length }]} />
      {row && tab === 'overview' && (
        <>
          <Panel><KV items={[
            ['Egress ID', <span className="mono">{row.id}</span>], ['Started at', fromMs(row.started)], ['Ended at', fromMs(row.ended)], ['Duration', durationMs(row.started, row.ended)],
            ['Type', row.type], ['Status', <StatusBadge status={row.status} />],
            ['Source (session)', row.room ? <Link to={sessionLink(row)}>{row.room}</Link> : '—'], ['Destination', <span className="mono">{row.dest}</span>],
          ]} /></Panel>
          {row.error && <Alert kind="bad">{row.error}</Alert>}
          <Panel title={`Destinations (${row.files.length})`}>
            {row.files.length === 0
              ? <div className="panel-body muted">{active(row.status) ? 'The file location appears when the egress finishes.' : 'No output files were reported for this egress.'}</div>
              : row.files.map((f, i) => (
                <div key={i} className="panel-body" style={{ borderTop: i ? '1px solid var(--border)' : 0 }}>
                  <div className="kv" style={{ margin: -14 }}>
                    <div><div className="k">Target</div><div className="v mono">{f.name || '—'} {row.roomSid && /\.(ogg|opus|mp3|wav|mp4|m4a|webm)$/i.test(f.name) && <Link className="rowlink" to={`/sessions/${encodeURIComponent(row.roomSid)}?${new URLSearchParams({tab:'insights',recording:`${row.id}/${i}`})}`}>Play in console</Link>}</div></div>

                    <div><div className="k">Size / duration</div><div className="v">{f.size != null ? fmtBytes(f.size) : '—'} · {f.durationMs != null ? fmtMs(f.durationMs) : '—'}</div></div>
                  </div>
                </div>
              ))}
          </Panel>
          {row.files.some((f) => /\.s3[.-]/i.test(f.location) || f.name.includes('private')) && (
            <Alert kind="info">Recordings in a private bucket cannot be opened with this plain link. Use Play in console for authorized access through configured storage.</Alert>
          )}
          <Panel title="Request" actions={request && <CopyButton text={JSON.stringify(request, null, 2)} label="Copy request" />}>
            {request && Object.keys(request).length
              ? <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, padding: 14 }}>{JSON.stringify(request, null, 2)}</pre>
              : <div className="panel-body muted">The request is not available for this egress.</div>}
          </Panel>
        </>
      )}
      {tab === 'events' && (
        <Panel>
          <DataTable rows={(stored.data?.events ?? []) as Json[]} rowKey={(e) => e.id} pageSize={50} empty={{ title: 'No events recorded', hint: 'Only egress events received since webhooks were enabled are stored.' }}
            cols={[{ key: 't', header: 'Timestamp', cell: (e) => <span className="mono">{fromMsPrecise(e.ts)}</span>, sort: (e) => e.ts }, { key: 'e', header: 'Event', cell: (e) => <span className="mono">{e.type}</span>, text: (e) => e.type }]} />
        </Panel>
      )}
    </>
  );
}
