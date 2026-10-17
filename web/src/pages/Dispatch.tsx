import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { lk, type Json } from '../lib/api';
import { joinList, splitList, useLkList, useMutate } from '../lib/hooks';
import { useConfirm } from '../lib/confirm';
import { Drawer } from '../components/Drawer';
import { JsonEditor, parseJson } from '../components/JsonEditor';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Field, PageHeader, Panel, Tabs } from '../components/ui';

type Form = {
  name: string; type: 'individual' | 'direct' | 'callee'; roomPrefix: string; roomName: string; pin: string; randomize: boolean;
  agentName: string; agentMetadata: string; trunkIds: string[]; inboundNumbers: string; hidePhoneNumber: boolean; metadata: string;
};
const EMPTY: Form = { name: '', type: 'individual', roomPrefix: '', roomName: '', pin: '', randomize: false, agentName: '', agentMetadata: '', trunkIds: [], inboundNumbers: '', hidePhoneNumber: false, metadata: '' };

export const ruleKind = (r: Json): { type: Form['type'] | null; target: string; pin?: string } => {
  const x = r.rule ?? {};
  if (x.dispatchRuleIndividual) return { type: 'individual', target: `${x.dispatchRuleIndividual.roomPrefix ?? ''}<caller-number>`, pin: x.dispatchRuleIndividual.pin };
  if (x.dispatchRuleDirect) return { type: 'direct', target: x.dispatchRuleDirect.roomName ?? '', pin: x.dispatchRuleDirect.pin };
  if (x.dispatchRuleCallee) return { type: 'callee', target: `${x.dispatchRuleCallee.roomPrefix ?? ''}<callee-number>`, pin: x.dispatchRuleCallee.pin };
  return { type: null, target: '—' };
};

function fromInfo(r: Json): Form {
  const x = r.rule ?? {};
  const agent = r.roomConfig?.agents?.[0] ?? {};
  const t = ruleKind(r).type ?? 'individual';
  const inner = x.dispatchRuleIndividual ?? x.dispatchRuleDirect ?? x.dispatchRuleCallee ?? {};
  return {
    name: r.name ?? '', type: t, roomPrefix: inner.roomPrefix ?? '', roomName: inner.roomName ?? '', pin: inner.pin ?? '', randomize: !!inner.randomize,
    agentName: agent.agentName ?? '', agentMetadata: agent.metadata ?? '', trunkIds: r.trunkIds ?? [], inboundNumbers: joinList(r.inboundNumbers),
    hidePhoneNumber: !!r.hidePhoneNumber, metadata: r.metadata ?? '',
  };
}

function toInfo(f: Form, base: Json): Json {
  const pin = f.pin || undefined;
  const rule =
    f.type === 'direct' ? { dispatchRuleDirect: { roomName: f.roomName, pin } }
    : f.type === 'callee' ? { dispatchRuleCallee: { roomPrefix: f.roomPrefix, pin, randomize: f.randomize || undefined } }
    : { dispatchRuleIndividual: { roomPrefix: f.roomPrefix, pin } };
  const info: Json = { ...base, name: f.name, rule, trunkIds: f.trunkIds, inboundNumbers: splitList(f.inboundNumbers), hidePhoneNumber: f.hidePhoneNumber || undefined, metadata: f.metadata || undefined };
  const { sipDispatchRuleId: _id, ...rest } = info;
  const roomConfig = { ...(base.roomConfig ?? {}) };
  if (f.agentName) roomConfig.agents = [{ agentName: f.agentName, metadata: f.agentMetadata || undefined }];
  else delete roomConfig.agents;
  return { ...rest, roomConfig: Object.keys(roomConfig).length ? roomConfig : undefined };
}

function RuleDrawer({ rule, onClose }: { rule: Json | 'new'; onClose: () => void }) {
  const editing = rule !== 'new';
  const base: Json = editing ? rule : {};
  const [form, setForm] = useState<Form>(editing ? fromInfo(rule) : EMPTY);
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const [json, setJson] = useState('');
  const trunksIn = useLkList('sip', 'ListSIPInboundTrunk');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutate(
    async () => {
      const info = tab === 'json' ? parseJson(json).value : toInfo(form, base);
      if (tab === 'json' && !info) throw new Error('Fix the JSON first');
      return editing
        ? lk('sip', 'UpdateSIPDispatchRule', { sipDispatchRuleId: rule.sipDispatchRuleId, replace: info })
        : lk('sip', 'CreateSIPDispatchRule', { dispatchRule: info });
    },
    { invalidate: [['lk', 'sip', 'ListSIPDispatchRule']], success: editing ? 'Dispatch rule updated' : 'Dispatch rule created' },
  );

  const switchTab = (t: 'form' | 'json') => {
    if (t === 'json') setJson(JSON.stringify(toInfo(form, base), null, 2));
    else {
      const p = parseJson(json);
      if (p.value) setForm(fromInfo(p.value));
    }
    setTab(t);
  };
  const valid = tab === 'json' ? !parseJson(json).error : !!form.name && (form.type === 'direct' ? !!form.roomName : true);

  return (
    <Drawer open wide title={editing ? 'Edit dispatch rule' : 'Create a new dispatch rule'} subtitle="Route inbound SIP calls to a room (and an agent) based on the trunk or number they arrive on." onClose={onClose}
      footer={<>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create'}</button>
      </>}>
      <Tabs value={tab} onChange={switchTab} tabs={[{ id: 'form', label: 'Dispatch rule details' }, { id: 'json', label: 'JSON editor' }]} />
      {tab === 'json' ? <JsonEditor value={json} onChange={setJson} /> : (
        <>
          <Field label="Rule name"><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="My rule" /></Field>
          <Field label="Rule type" hint={{ individual: 'Creates a new room for each caller.', direct: 'Puts every caller into one existing room (optionally behind a PIN).', callee: 'Creates a new room for each number that was called.' }[form.type]}>
            <select className="select" value={form.type} onChange={(e) => set('type', e.target.value as Form['type'])}>
              <option value="individual">Individual</option><option value="direct">Direct</option><option value="callee">Callee</option>
            </select>
          </Field>
          {form.type === 'direct'
            ? <Field label="Room name"><input className="input" value={form.roomName} onChange={(e) => set('roomName', e.target.value)} /></Field>
            : <Field label="Room prefix" hint="The caller or callee number is appended to this."><input className="input" value={form.roomPrefix} onChange={(e) => set('roomPrefix', e.target.value)} placeholder="pre-" /></Field>}
          <div className="grid-2">
            <Field label="PIN (optional)"><input className="input" value={form.pin} onChange={(e) => set('pin', e.target.value)} autoComplete="off" /></Field>
            {form.type === 'callee' && <Field label="Options"><label className="check"><input type="checkbox" checked={form.randomize} onChange={(e) => set('randomize', e.target.checked)} /> Randomize room name</label></Field>}
          </div>

          <div className="section-title">Agent dispatch</div>
          <div className="section-sub">Dispatch an agent to every room this rule creates, so inbound calls are answered.</div>
          <Field label="Agent name"><input className="input" value={form.agentName} onChange={(e) => set('agentName', e.target.value)} placeholder="my-agent-name" /></Field>
          {form.agentName && <Field label="Dispatch metadata" hint="JSON passed to the agent job, e.g. user id or phone number."><textarea className="textarea" value={form.agentMetadata} onChange={(e) => set('agentMetadata', e.target.value)} /></Field>}

          <div className="section-title">Inbound routing</div>
          <div className="section-sub">Match by number and/or trunk. If neither is set, the rule applies to all inbound calls.</div>
          <Field label="Match phone numbers" hint="Comma-separated, e.g. +14155550100"><input className="input" value={form.inboundNumbers} onChange={(e) => set('inboundNumbers', e.target.value)} /></Field>
          <Field label="Match trunks">
            <div style={{ border: '1px solid var(--border-strong)', borderRadius: 6, maxHeight: 180, overflow: 'auto', padding: 6 }}>
              {(trunksIn.data ?? []).length === 0 && <span className="muted" style={{ padding: 6, display: 'block' }}>No inbound trunks</span>}
              {(trunksIn.data ?? []).map((t) => (
                <label key={t.sipTrunkId} className="check" style={{ padding: '4px 6px' }}>
                  <input type="checkbox" checked={form.trunkIds.includes(t.sipTrunkId)} onChange={(e) => set('trunkIds', e.target.checked ? [...form.trunkIds, t.sipTrunkId] : form.trunkIds.filter((x) => x !== t.sipTrunkId))} />
                  {t.name} <span className="muted mono">{t.sipTrunkId}</span>
                </label>
              ))}
            </div>
          </Field>
          <div className="section-title">Options</div>
          <Field label="Rule metadata"><input className="input" value={form.metadata} onChange={(e) => set('metadata', e.target.value)} /></Field>
          <label className="check"><input type="checkbox" checked={form.hidePhoneNumber} onChange={(e) => set('hidePhoneNumber', e.target.checked)} /> Hide the caller's phone number from the room</label>
          {save.error && <Alert kind="bad">{(save.error as Error).message}</Alert>}
        </>
      )}
    </Drawer>
  );
}

export function Dispatch() {
  const rules = useLkList('sip', 'ListSIPDispatchRule', { live: true });
  const trunks = useLkList('sip', 'ListSIPInboundTrunk');
  const [open, setOpen] = useState<Json | 'new' | null>(null);
  const confirm = useConfirm();
  const del = useMutate((id: string) => lk('sip', 'DeleteSIPDispatchRule', { sipDispatchRuleId: id }), { invalidate: [['lk', 'sip', 'ListSIPDispatchRule']], success: 'Dispatch rule deleted' });
  const trunkName = (id: string) => trunks.data?.find((t) => t.sipTrunkId === id)?.name ?? id;

  const cols: Col<Json>[] = [
    { key: 'id', header: 'Rule ID', cell: (r) => <span className="mono">{r.sipDispatchRuleId}</span>, text: (r) => r.sipDispatchRuleId, sort: (r) => r.sipDispatchRuleId },
    { key: 'name', header: 'Rule name', cell: (r) => r.name || '—', text: (r) => r.name ?? '', sort: (r) => r.name ?? '' },
    { key: 'type', header: 'Rule type', cell: (r) => <Badge>{(ruleKind(r).type ?? 'unknown').replace(/^./, (c) => c.toUpperCase())}</Badge>, text: (r) => ruleKind(r).type ?? '' },
    { key: 'room', header: 'Destination room', cell: (r) => <span className="mono">{ruleKind(r).target}</span>, text: (r) => ruleKind(r).target },
    { key: 'agents', header: 'Agents', cell: (r) => (r.roomConfig?.agents ?? []).map((a: Json) => <Badge key={a.agentName} tone="info">{a.agentName}</Badge>), text: (r) => (r.roomConfig?.agents ?? []).map((a: Json) => a.agentName).join(' ') },
    { key: 'routing', header: 'Inbound routing', cell: (r) => { const n = [...(r.inboundNumbers ?? []), ...(r.trunkIds ?? []).map(trunkName)]; return n.length ? <span title={n.join(', ')}>{n.slice(0, 2).join(', ')}{n.length > 2 ? ` +${n.length - 2}` : ''}</span> : <span className="muted">All inbound calls</span>; }, text: (r) => [...(r.inboundNumbers ?? []), ...(r.trunkIds ?? []).map(trunkName)].join(' ') },
    { key: 'pin', header: 'PIN', hidden: true, cell: (r) => (ruleKind(r).pin ? 'Yes' : '—') },
  ];

  return (
    <>
      <PageHeader crumbs={[{ label: 'Telephony' }, { label: 'Dispatch rules' }]} title="Dispatch rules" sub={`${rules.data?.length ?? 0} rules route inbound SIP calls to rooms and agents`}
        actions={<button className="btn" onClick={() => setOpen('new')}><Plus size={15} />Create new dispatch rule</button>} />
      <Panel>
        <DataTable rows={rules.data} cols={cols} rowKey={(r) => r.sipDispatchRuleId} loading={rules.isLoading} error={rules.error} storageKey="dispatch" onRow={setOpen}
          empty={{ title: 'No dispatch rules', hint: 'Create a rule so inbound calls land in a room.' }}
          rowActions={(r) => (
            <>
              <button className="btn ghost icon sm" aria-label={`Edit ${r.name}`} onClick={() => setOpen(r)}><Pencil size={14} /></button>
              <button className="btn ghost icon sm" aria-label={`Delete ${r.name}`} onClick={async () => (await confirm({ title: 'Delete dispatch rule?', message: `${r.name || r.sipDispatchRuleId} will stop routing calls immediately.`, confirmLabel: 'Delete', danger: true })) && del.mutate(r.sipDispatchRuleId)}><Trash2 size={14} color="var(--bad)" /></button>
            </>
          )} />
      </Panel>
      {open && <RuleDrawer key={open === 'new' ? 'new' : open.sipDispatchRuleId} rule={open} onClose={() => setOpen(null)} />}
    </>
  );
}
