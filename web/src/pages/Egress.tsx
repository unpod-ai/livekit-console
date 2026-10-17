import { useMemo, useState } from 'react';
import { Plus, Square } from 'lucide-react';
import { lk, type Json } from '../lib/api';
import { useApi, useLkList, useMutate } from '../lib/hooks';
import { useConfirm } from '../lib/confirm';
import { durationMs, fmtBytes, fmtMs, fromMs } from '../lib/format';
import { egressDestination, egressFiles, isUrl, type EgressFile } from '../lib/egress';
import { Recording } from '../components/Recording';
import { Drawer } from '../components/Drawer';
import { JsonEditor, parseJson } from '../components/JsonEditor';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, CopyButton, Field, KV, PageHeader, Panel, StatusBadge } from '../components/ui';

type Row = { id: string; room: string; status: string; started: number | null; ended: number | null; type: string; dest: string; files: EgressFile[]; error?: string; raw?: Json };

const lkType = (e: Json) => (e.roomComposite ? 'Room composite' : e.participant ? 'Participant' : e.trackComposite ? 'Track composite' : e.track ? 'Track' : e.web ? 'Web' : 'Unknown');
const nsToMs = (v?: string) => (Number(v) ? Math.round(Number(v) / 1e6) : null);

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
  const live = useLkList('egress', 'ListEgress', { live: true });
  const hist = useApi<Json[]>(['egress-history'], '/history/egress?hours=720');
  const [starting, setStarting] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const confirm = useConfirm();
  const stop = useMutate((id: string) => lk('egress', 'StopEgress', { egressId: id }), { invalidate: [['lk', 'egress'], ['egress-history']], success: 'Egress stopping' });

  // LiveKit's own list is authoritative for what it still retains; the collector adds older history.
  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    (hist.data ?? []).forEach((h) => m.set(h.egress_id, { id: h.egress_id, room: h.room_name ?? '', status: h.status, started: h.started_at, ended: h.ended_at, type: h.type, dest: h.destination ?? '—', files: h.files ?? [] }));
    (live.data ?? []).forEach((e) => m.set(e.egressId, { id: e.egressId, room: e.roomName ?? '', status: e.status, started: nsToMs(e.startedAt), ended: nsToMs(e.endedAt), type: lkType(e), dest: egressDestination(e), files: egressFiles(e), error: e.error || undefined, raw: e }));
    return [...m.values()].sort((a, b) => (b.started ?? 0) - (a.started ?? 0));
  }, [live.data, hist.data]);

  const cols: Col<Row>[] = [
    { key: 'id', header: 'Egress ID', cell: (e) => <span className="mono">{e.id}</span>, text: (e) => e.id },
    { key: 'start', header: 'Started at', cell: (e) => fromMs(e.started), sort: (e) => e.started ?? 0 },
    { key: 'dur', header: 'Duration', cell: (e) => durationMs(e.started, e.ended) },
    { key: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} />, text: (e) => e.status },
    { key: 'type', header: 'Type', cell: (e) => e.type, text: (e) => e.type },
    { key: 'room', header: 'Source (room)', cell: (e) => e.room || '—', text: (e) => e.room },
    { key: 'dest', header: 'Destination', cell: (e) => <span className="mono">{e.dest}</span>, text: (e) => e.dest },
    { key: 'rec', header: 'Recording', cell: (e) => <Recording file={e.files[0]} />, text: (e) => e.files.map((f) => `${f.name} ${f.location}`).join(' ') },
    { key: 'size', header: 'Size', hidden: true, cell: (e) => (e.files[0]?.size ? fmtBytes(e.files[0].size) : '—') },
  ];
  const active = (s: string) => /ACTIVE|STARTING/.test(s);
  return (
    <>
      <PageHeader crumbs={[{ label: 'Media' }, { label: 'Egress' }]} title="Egress" sub="Recordings and streams" actions={<button className="btn" onClick={() => setStarting(true)}><Plus size={15} />Start egress</button>} />
      <Panel>
        <DataTable rows={rows} cols={cols} rowKey={(e) => e.id} loading={live.isLoading} error={live.error} storageKey="egress" onRow={setDetail} empty={{ title: 'No egress', hint: 'Start a recording, or egress appears here when a room is recorded.' }}
          rowActions={(e) => active(e.status) ? <button className="btn danger sm" onClick={async () => (await confirm({ title: 'Stop egress?', message: `${e.id} will finish and upload what it has recorded.`, confirmLabel: 'Stop', danger: true })) && stop.mutate(e.id)}><Square size={12} />Stop</button> : null} />
      </Panel>
      {starting && <StartDrawer onClose={() => setStarting(false)} />}
      <Drawer open={!!detail} wide title={detail?.id ?? ''} subtitle={detail ? `${detail.type} · ${detail.room || 'no room'}` : ''} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <Panel><KV items={[['Status', <StatusBadge status={detail.status} />], ['Type', detail.type], ['Source (room)', detail.room || '—'], ['Destination', <span className="mono">{detail.dest}</span>], ['Started', fromMs(detail.started)], ['Duration', durationMs(detail.started, detail.ended)]]} /></Panel>
            {detail.error && <Alert kind="bad">{detail.error}</Alert>}
            <Panel title={`Recording files (${detail.files.length})`}>
              {detail.files.length === 0
                ? <div className="panel-body muted">{/ACTIVE|STARTING/.test(detail.status) ? 'The file location appears when the egress finishes.' : 'No output files were reported for this egress.'}</div>
                : detail.files.map((f, i) => (
                  <div key={i} className="panel-body" style={{ borderTop: i ? '1px solid var(--border)' : 0 }}>
                    <div className="mono" style={{ overflowWrap: 'anywhere' }}>{f.location || f.name}</div>
                    <div className="muted" style={{ marginTop: 4, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      {f.size != null && <span>{fmtBytes(f.size)}</span>}
                      {f.durationMs != null && <span>{fmtMs(f.durationMs)}</span>}
                      <CopyButton text={f.location || f.name} label="Copy location" />
                      {isUrl(f.location) && <a href={f.location} target="_blank" rel="noopener noreferrer">Open</a>}
                    </div>
                  </div>
                ))}
            </Panel>
            {detail.files.some((f) => /^https?:\/\/[^/]+\.s3[.-]/i.test(f.location) || f.name.includes('private')) && (
              <Alert kind="info">Recordings in a private bucket cannot be opened with this plain link. Download them with your storage tooling, or generate a signed URL.</Alert>
            )}
            {detail.raw && (
              <Panel title="Details" actions={<CopyButton text={JSON.stringify(detail.raw, null, 2)} label="Copy JSON" />}>
                <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, padding: 14 }}>{JSON.stringify(detail.raw, null, 2)}</pre>
              </Panel>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
