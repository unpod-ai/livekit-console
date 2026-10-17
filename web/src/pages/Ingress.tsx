import { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { lk, type Json } from '../lib/api';
import { useLkList, useMutate } from '../lib/hooks';
import { useConfirm } from '../lib/confirm';
import { Drawer } from '../components/Drawer';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, CopyButton, Field, PageHeader, Panel, StatusBadge } from '../components/ui';

const INPUTS = { RTMP_INPUT: 'RTMP', WHIP_INPUT: 'WHIP', URL_INPUT: 'URL pull' } as const;
type Input = keyof typeof INPUTS;

function Secret({ value }: { value: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="mono" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {show ? value : '••••••••••'}
      <button className="btn ghost icon sm" aria-label={show ? 'Hide' : 'Reveal'} onClick={(e) => { e.stopPropagation(); setShow(!show); }}>{show ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      <CopyButton text={value} />
    </span>
  );
}

function CreateDrawer({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState<Input>('RTMP_INPUT');
  const [f, setF] = useState({ name: '', roomName: '', participantIdentity: '', participantName: '', url: '', enableTranscoding: true });
  const [created, setCreated] = useState<Json>();
  const create = useMutate(() => lk('ingress', 'CreateIngress', { inputType: input, ...f, url: input === 'URL_INPUT' ? f.url : undefined }), { invalidate: [['lk', 'ingress']], success: 'Ingress created' });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const valid = !!f.name && !!f.roomName && !!f.participantIdentity && (input !== 'URL_INPUT' || !!f.url);
  return (
    <Drawer open title="Create ingress" subtitle="Bring an external stream into a room." onClose={onClose}
      footer={created ? <button className="btn" onClick={onClose}>Done</button> : <><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={!valid || create.isPending} onClick={() => create.mutate(undefined, { onSuccess: setCreated })}>Create</button></>}>
      {created ? (
        <>
          <Alert kind="info">Copy the connection details now. The stream key is also visible in the ingress list.</Alert>
          {created.url && <Field label="URL"><div className="secret"><span>{created.url}</span><CopyButton text={created.url} /></div></Field>}
          {created.streamKey && <Field label="Stream key"><div className="secret"><span>{created.streamKey}</span><CopyButton text={created.streamKey} /></div></Field>}
        </>
      ) : (
        <>
          <Field label="Input type">
            <div className="seg">{(Object.keys(INPUTS) as Input[]).map((k) => <button key={k} type="button" className={input === k ? 'on' : ''} onClick={() => setInput(k)}>{INPUTS[k]}</button>)}</div>
          </Field>
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Room name"><input className="input" value={f.roomName} onChange={(e) => set('roomName', e.target.value)} /></Field>
          <div className="grid-2">
            <Field label="Participant identity"><input className="input" value={f.participantIdentity} onChange={(e) => set('participantIdentity', e.target.value)} /></Field>
            <Field label="Participant name"><input className="input" value={f.participantName} onChange={(e) => set('participantName', e.target.value)} /></Field>
          </div>
          {input === 'URL_INPUT' && <Field label="Source URL"><input className="input" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" /></Field>}
          {input !== 'WHIP_INPUT' && <label className="check"><input type="checkbox" checked={f.enableTranscoding} onChange={(e) => set('enableTranscoding', e.target.checked)} /> Enable transcoding</label>}
        </>
      )}
    </Drawer>
  );
}

export function Ingress() {
  const list = useLkList('ingress', 'ListIngress', { live: true });
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();
  const del = useMutate((id: string) => lk('ingress', 'DeleteIngress', { ingressId: id }), { invalidate: [['lk', 'ingress']], success: 'Ingress deleted' });
  const cols: Col<Json>[] = [
    { key: 'id', header: 'Ingress ID', cell: (i) => <span className="mono">{i.ingressId}</span>, text: (i) => i.ingressId },
    { key: 'name', header: 'Name', cell: (i) => i.name || '—', text: (i) => i.name ?? '' },
    { key: 'type', header: 'Type', cell: (i) => <Badge>{INPUTS[i.inputType as Input] ?? i.inputType}</Badge> },
    { key: 'room', header: 'Room', cell: (i) => i.roomName, text: (i) => i.roomName ?? '' },
    { key: 'status', header: 'Status', cell: (i) => <StatusBadge status={i.state?.status ?? 'inactive'} /> },
    { key: 'url', header: 'URL', cell: (i) => <span className="mono">{i.url || '—'}</span> },
    { key: 'key', header: 'Stream key', cell: (i) => (i.streamKey ? <Secret value={i.streamKey} /> : '—') },
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: 'Media' }, { label: 'Ingress' }]} title="Ingress" sub="RTMP, WHIP and URL inputs" actions={<button className="btn" onClick={() => setCreating(true)}><Plus size={15} />Create ingress</button>} />
      <Panel>
        <DataTable rows={list.data} cols={cols} rowKey={(i) => i.ingressId} loading={list.isLoading} error={list.error} storageKey="ingress" empty={{ title: 'No ingress', hint: 'Create one to push RTMP/WHIP video into a room.' }}
          rowActions={(i) => <button className="btn ghost icon sm" aria-label={`Delete ${i.name}`} onClick={async () => (await confirm({ title: 'Delete ingress?', message: `${i.name || i.ingressId} will stop accepting streams.`, confirmLabel: 'Delete', danger: true })) && del.mutate(i.ingressId)}><Trash2 size={14} color="var(--bad)" /></button>} />
      </Panel>
      {creating && <CreateDrawer onClose={() => setCreating(false)} />}
    </>
  );
}
