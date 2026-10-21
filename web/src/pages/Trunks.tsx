import { Dropdown } from '../components/Dropdown';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { lk, type Json } from '../lib/api';
import { joinList, splitList, useLkList, useMutate } from '../lib/hooks';
import { Link } from 'react-router-dom';
import { useConfirm } from '../lib/confirm';
import { useInitialQuery } from '../lib/useTab';
import { Drawer } from '../components/Drawer';
import { JsonEditor, parseJson } from '../components/JsonEditor';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Field, Kpi, Kpis, PageHeader, Panel, Tabs } from '../components/ui';
import { SipUriKpi } from '../components/SipUri';

type Dir = 'inbound' | 'outbound';
type Form = {
  name: string; numbers: string; metadata: string; allowedAddresses: string; allowedNumbers: string; address: string; transport: string;
  destinationCountry: string; authUsername: string; authPassword: string; mediaEncryption: string; includeHeaders: string; krispEnabled: boolean;
};
const EMPTY: Form = { name: '', numbers: '', metadata: '', allowedAddresses: '', allowedNumbers: '', address: '', transport: 'SIP_TRANSPORT_AUTO', destinationCountry: '', authUsername: '', authPassword: '', mediaEncryption: 'SIP_MEDIA_ENCRYPT_DISABLE', includeHeaders: 'SIP_NO_HEADERS', krispEnabled: false };
const METHODS = { inbound: { list: 'ListSIPInboundTrunk', create: 'CreateSIPInboundTrunk', update: 'UpdateSIPInboundTrunk' }, outbound: { list: 'ListSIPOutboundTrunk', create: 'CreateSIPOutboundTrunk', update: 'UpdateSIPOutboundTrunk' } };

const fromInfo = (t: Json): Form => ({
  name: t.name ?? '', numbers: joinList(t.numbers), metadata: t.metadata ?? '', allowedAddresses: joinList(t.allowedAddresses), allowedNumbers: joinList(t.allowedNumbers),
  address: t.address ?? '', transport: t.transport ?? 'SIP_TRANSPORT_AUTO', destinationCountry: t.destinationCountry ?? '', authUsername: t.authUsername ?? '', authPassword: t.authPassword ?? '',
  mediaEncryption: t.mediaEncryption ?? 'SIP_MEDIA_ENCRYPT_DISABLE', includeHeaders: t.includeHeaders ?? 'SIP_NO_HEADERS', krispEnabled: !!t.krispEnabled,
});

function toInfo(f: Form, dir: Dir, base: Json): Json {
  const { sipTrunkId: _id, ...rest } = base;
  const common = { ...rest, name: f.name, numbers: splitList(f.numbers), metadata: f.metadata || undefined, authUsername: f.authUsername || undefined, authPassword: f.authPassword || undefined, mediaEncryption: f.mediaEncryption, includeHeaders: f.includeHeaders };
  return dir === 'inbound'
    ? { ...common, allowedAddresses: splitList(f.allowedAddresses), allowedNumbers: splitList(f.allowedNumbers), krispEnabled: f.krispEnabled || undefined }
    : { ...common, address: f.address, transport: f.transport, destinationCountry: f.destinationCountry || undefined };
}

function TrunkDrawer({ dir: initialDir, trunk, onClose }: { dir: Dir; trunk: Json | 'new'; onClose: () => void }) {
  const editing = trunk !== 'new';
  const base: Json = editing ? trunk : {};
  const [dir, setDir] = useState<Dir>(initialDir);
  const [form, setForm] = useState<Form>(editing ? fromInfo(trunk) : EMPTY);
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const [json, setJson] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const m = METHODS[dir];

  const save = useMutate(
    async () => {
      const info = tab === 'json' ? parseJson(json).value : toInfo(form, dir, base);
      if (!info) throw new Error('Fix the JSON first');
      return editing ? lk('sip', m.update, { sipTrunkId: trunk.sipTrunkId, replace: info }) : lk('sip', m.create, { trunk: info });
    },
    { invalidate: [['lk', 'sip', 'ListSIPInboundTrunk'], ['lk', 'sip', 'ListSIPOutboundTrunk']], success: editing ? 'Trunk updated' : 'Trunk created' },
  );
  const switchTab = (t: 'form' | 'json') => {
    if (t === 'json') setJson(JSON.stringify(toInfo(form, dir, base), null, 2));
    else { const p = parseJson(json); if (p.value) setForm(fromInfo(p.value)); }
    setTab(t);
  };
  const valid = tab === 'json' ? !parseJson(json).error : !!form.name && (dir === 'inbound' || !!form.address);

  return (
    <Drawer open wide title={editing ? 'Edit trunk' : 'Create a new trunk'} subtitle="Configure a SIP trunk for inbound calls (carrier into LiveKit) or outbound calls (LiveKit out to a carrier)." onClose={onClose}
      footer={<>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create'}</button>
      </>}>
      <Tabs value={tab} onChange={switchTab} tabs={[{ id: 'form', label: 'Trunk details' }, { id: 'json', label: 'JSON editor' }]} />
      {tab === 'json' ? <JsonEditor value={json} onChange={setJson} /> : (
        <>
          <Field label="Trunk name"><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="My trunk" /></Field>
          <Field label="Trunk direction">
            <div className="seg" role="group">
              <button type="button" className={dir === 'inbound' ? 'on' : ''} disabled={editing} onClick={() => setDir('inbound')}>Inbound</button>
              <button type="button" className={dir === 'outbound' ? 'on' : ''} disabled={editing} onClick={() => setDir('outbound')}>Outbound</button>
            </div>
          </Field>
          {dir === 'outbound' && (
            <>
              <Field label="Address" hint="Hostname or IP of the carrier's SIP endpoint."><input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="sip.provider.com" /></Field>
              <Field label="Transport">
                <select className="select" value={form.transport} onChange={(e) => set('transport', e.target.value)}>
                  <option value="SIP_TRANSPORT_AUTO">Auto</option><option value="SIP_TRANSPORT_UDP">UDP</option><option value="SIP_TRANSPORT_TCP">TCP</option><option value="SIP_TRANSPORT_TLS">TLS</option>
                </select>
              </Field>
            </>
          )}
          <Field label="Numbers" hint={dir === 'inbound' ? 'Provider numbers this trunk accepts calls for. Empty accepts any.' : 'Numbers calls can be placed from.'}>
            <input className="input" value={form.numbers} onChange={(e) => set('numbers', e.target.value)} placeholder="+15105550123, +15105550124" />
          </Field>
          {dir === 'inbound' && (
            <>
              <Field label="Allowed addresses" hint="Only these IPs/CIDRs may call. Empty or 0.0.0.0/0 allows all."><input className="input" value={form.allowedAddresses} onChange={(e) => set('allowedAddresses', e.target.value)} placeholder="192.0.2.0/24, 192.0.2.100" /></Field>
              <Field label="Allowed caller numbers"><input className="input" value={form.allowedNumbers} onChange={(e) => set('allowedNumbers', e.target.value)} /></Field>
            </>
          )}
          <div className="section-title">Authentication</div>
          <div className="grid-2">
            <Field label="Username"><input className="input" value={form.authUsername} onChange={(e) => set('authUsername', e.target.value)} autoComplete="off" /></Field>
            <Field label="Password"><input className="input" type="password" value={form.authPassword} onChange={(e) => set('authPassword', e.target.value)} autoComplete="new-password" /></Field>
          </div>
          <div className="section-title">Optional settings</div>
          <div className="grid-2">
            <Field label="Media encryption (SRTP)">
              <select className="select" value={form.mediaEncryption} onChange={(e) => set('mediaEncryption', e.target.value)}>
                <option value="SIP_MEDIA_ENCRYPT_DISABLE">Disabled</option><option value="SIP_MEDIA_ENCRYPT_ALLOW">Allowed</option><option value="SIP_MEDIA_ENCRYPT_REQUIRE">Required</option>
              </select>
            </Field>
            <Field label="Include headers" hint="Copy SIP headers into participant attributes.">
              <select className="select" value={form.includeHeaders} onChange={(e) => set('includeHeaders', e.target.value)}>
                <option value="SIP_NO_HEADERS">No headers</option><option value="SIP_X_HEADERS">X-* headers</option><option value="SIP_ALL_HEADERS">All headers</option>
              </select>
            </Field>
          </div>
          {dir === 'outbound' && <Field label="Destination country" hint="Two-letter code, used for carrier-specific dialing."><input className="input" value={form.destinationCountry} onChange={(e) => set('destinationCountry', e.target.value)} maxLength={2} placeholder="IN" /></Field>}
          {dir === 'inbound' && <label className="check"><input type="checkbox" checked={form.krispEnabled} onChange={(e) => set('krispEnabled', e.target.checked)} /> Enable Krisp noise cancellation</label>}
          <Field label="Metadata"><input className="input" value={form.metadata} onChange={(e) => set('metadata', e.target.value)} /></Field>
          {save.error && <Alert kind="bad">{(save.error as Error).message}</Alert>}
        </>
      )}
    </Drawer>
  );
}

export function Trunks() {
  const inbound = useLkList('sip', METHODS.inbound.list, { live: true });
  const outbound = useLkList('sip', METHODS.outbound.list, { live: true });
  const rules = useLkList('sip', 'ListSIPDispatchRule');
  const initialQuery = useInitialQuery();
  const [tab, setTab] = useState<Dir>('inbound');
  const [open, setOpen] = useState<{ dir: Dir; trunk: Json | 'new' } | null>(null);
  const confirm = useConfirm();
  const del = useMutate((id: string) => lk('sip', 'DeleteSIPTrunk', { sipTrunkId: id }), { invalidate: [['lk', 'sip', 'ListSIPInboundTrunk'], ['lk', 'sip', 'ListSIPOutboundTrunk']], success: 'Trunk deleted' });
  const q = tab === 'inbound' ? inbound : outbound;

  const cols: Col<Json>[] = [
    { key: 'id', hidden: true, header: 'Trunk ID', cell: (t) => <span className="mono">{t.sipTrunkId}</span>, text: (t) => t.sipTrunkId, sort: (t) => t.sipTrunkId },
    { key: 'name', header: 'Trunk name', cell: (t) => t.name || '—', text: (t) => t.name ?? '', sort: (t) => t.name ?? '' },
    { key: 'numbers', header: 'Numbers', cell: (t) => joinList(t.numbers) || <span className="muted">Any</span>, text: (t) => joinList(t.numbers) },
    ...(tab === 'outbound'
      ? [{ key: 'address', header: 'SIP URI', cell: (t: Json) => <span className="mono">{t.address}</span>, text: (t: Json) => t.address ?? '' }]
      : [{ key: 'addrs', header: 'Allowed addresses', cell: (t: Json) => joinList(t.allowedAddresses) || <span className="muted">All</span>, text: (t: Json) => joinList(t.allowedAddresses), hidden: true }]),
    { key: 'links', header: 'Related', cell: (t) => { const n = (rules.data ?? []).filter((r) => (r.trunkIds ?? []).includes(t.sipTrunkId)).length; return <span className="badges" onClick={(e) => e.stopPropagation()}>{tab === 'inbound' && <Link className="badge" to={`/telephony/dispatch?q=${t.sipTrunkId}`}>{n} rule{n === 1 ? '' : 's'}</Link>}<Link className="badge" to={`/telephony/calls?q=${t.sipTrunkId}`}>Calls</Link></span>; } },
    { key: 'enc', header: 'Media encryption', hidden: true, cell: (t) => <Badge>{(t.mediaEncryption ?? 'SIP_MEDIA_ENCRYPT_DISABLE').replace('SIP_MEDIA_ENCRYPT_', '').toLowerCase()}</Badge> },
    { key: 'auth', header: 'Auth', hidden: true, cell: (t) => (t.authUsername ? <Badge tone="ok">Configured</Badge> : '—') },
  ];

  return (
    <>
      <PageHeader crumbs={[{ label: 'Telephony' }, { label: 'SIP trunks' }]} title="SIP trunks" sub={`${inbound.data?.length ?? 0} inbound · ${outbound.data?.length ?? 0} outbound`}
        actions={<button className="btn" onClick={() => setOpen({ dir: tab, trunk: 'new' })}><Plus size={15} />Create new trunk</button>} />
      <Kpis>
        <Kpi label="Total inbound trunks" value={inbound.data?.length ?? '…'} />
        <Kpi label="Total outbound trunks" value={outbound.data?.length ?? '…'} />
        <SipUriKpi />
      </Kpis>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'inbound', label: 'Inbound', count: inbound.data?.length }, { id: 'outbound', label: 'Outbound', count: outbound.data?.length }]} />
      <Panel>
        <DataTable rows={q.data} cols={cols} rowKey={(t) => t.sipTrunkId} loading={q.isLoading} error={q.error} storageKey={`trunks-polished-${tab}`} initialQuery={initialQuery} onRow={(t) => setOpen({ dir: tab, trunk: t })}
          empty={{ title: `No ${tab} trunks`, hint: 'Create a trunk to connect a carrier.' }}
          rowActions={(t)=><Dropdown action title={`Actions for ${t.name || t.sipTrunkId}`} label="Actions" value="" items={[{id:'edit',label:`Edit ${t.name||t.sipTrunkId}`},{id:'delete',label:`Delete ${t.name||t.sipTrunkId}`,danger:true}]} onSelect={async action=>{if(action==='edit')setOpen({dir:tab,trunk:t});else if(await confirm({title:'Delete trunk?',message:`${t.name || t.sipTrunkId} will stop carrying calls immediately.`,confirmLabel:'Delete',danger:true}))del.mutate(t.sipTrunkId);}}/>} />
      </Panel>
      {open && <TrunkDrawer key={open.trunk === 'new' ? 'new' : open.trunk.sipTrunkId} dir={open.dir} trunk={open.trunk} onClose={() => setOpen(null)} />}
    </>
  );
}
