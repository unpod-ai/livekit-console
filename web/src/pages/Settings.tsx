import { useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { api, type Json } from '../lib/api';
import { useApi, useMutate } from '../lib/hooks';
import { useMe, type Capabilities } from '../lib/me';
import { useConfirm } from '../lib/confirm';
import { useTab } from '../lib/useTab';
import { fmtBytes, fromMs, relTime } from '../lib/format';
import { Drawer } from '../components/Drawer';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, CopyButton, Field, KV, PageHeader, Panel, Tabs } from '../components/ui';

type Member = { id: number | 'env'; username: string; role: 'admin' | 'viewer'; source: 'env' | 'db'; createdAt: number | null; lastLoginAt: number | null; capabilities: Capabilities };

function AddMember({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ username: '', password: '', role: 'viewer', capabilities: { transcripts: false, recordings: false, logs: false } });
  const add = useMutate(() => api('/users', { method: 'POST', body: f }), { invalidate: [['users']], success: 'Member added' });
  const ok = f.username.length >= 3 && f.password.length >= 10;
  return (
    <Drawer open title="Add team member" subtitle="Each person signs in with their own account." onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={!ok || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: onClose })}>Add member</button></>}>
      <Field label="Username" hint="3-64 characters: letters, digits, . _ @ -"><input aria-label="Username" className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></Field>
      <Field label="Password" hint="At least 10 characters. Share it with them securely; they can't change it themselves yet."><input aria-label="Password" className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
      <Field label="Role" hint={f.role === 'admin' ? 'Manage operations and team accounts. Content permissions are separate.' : 'Read-only operations. Content permissions are separate.'}>
        <select aria-label="Role" className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, capabilities: { transcripts: e.target.value === 'admin', recordings: e.target.value === 'admin', logs: e.target.value === 'admin' } })}><option value="viewer">Viewer (read-only)</option><option value="admin">Admin</option></select>
      </Field>
      <ContentPermissions value={f.capabilities} onChange={capabilities => setF({ ...f, capabilities })} />
    </Drawer>
  );
}

const permissionLabels = { transcripts: 'Transcripts and agent analytics', recordings: 'Recording playback', logs: 'Structured logs' };
function ContentPermissions({ value, onChange }: { value: Capabilities; onChange: (value: Capabilities) => void }) {
  return <fieldset className="phase6-form"><legend>Content permissions</legend>{(['transcripts', 'recordings', 'logs'] as const).map(key => <label className="check" key={key}><input type="checkbox" checked={value[key] === true} onChange={e => onChange({ ...value, [key]: e.target.checked })} />{permissionLabels[key]}</label>)}</fieldset>;
}
function EditContentAccess({ member, close }: { member: Member; close: () => void }) {
  const [capabilities, setCapabilities] = useState(member.capabilities);
  const save = useMutate(() => api(`/users/${member.id}`, { method: 'PATCH', body: { capabilities } }), { invalidate: [['users'], ['me']], success: 'Content access updated' });
  return <Panel title={`Content access for ${member.username}`}><form className="panel-body phase6-form" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: close }); }}>
    <ContentPermissions value={capabilities} onChange={setCapabilities} />
    <div className="phase6-actions"><button className="btn" disabled={save.isPending}>Save access</button><button className="btn secondary" type="button" onClick={close}>Cancel</button></div>
    {save.error && <Alert kind="bad">{save.error.message}</Alert>}
  </form></Panel>;
}

function ResetPassword({ member, onClose }: { member: Member; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const reset = useMutate(() => api(`/users/${member.id}`, { method: 'PATCH', body: { password: pw } }), { success: 'Password updated' });
  return (
    <Drawer open title={`Reset password for ${member.username}`} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={pw.length < 10 || reset.isPending} onClick={() => reset.mutate(undefined, { onSuccess: onClose })}>Update password</button></>}>
      <Field label="New password" hint="At least 10 characters."><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
    </Drawer>
  );
}

function Team() {
  const me = useMe();
  const list = useApi<Member[]>(['users'], '/users', { live: false, enabled: me.data?.role === 'admin' });
  const [editing, setEditing] = useState<Member | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<Member | null>(null);
  const confirm = useConfirm();
  const setRole = useMutate((v: { id: number; role: string }) => api(`/users/${v.id}`, { method: 'PATCH', body: { role: v.role } }), { invalidate: [['users']], success: 'Role updated' });
  const remove = useMutate((id: number) => api(`/users/${id}`, { method: 'DELETE' }), { invalidate: [['users']], success: 'Member removed' });

  if (me.data?.role !== 'admin') return <Alert>Only administrators can manage the team directory.</Alert>;
  const cols: Col<Member>[] = [
    { key: 'user', header: 'Member', cell: (m) => <span>{m.username}{m.username === me.data?.user && <> <Badge tone="info">You</Badge></>}</span>, text: (m) => m.username, sort: (m) => m.username },
    { key: 'role', header: 'Role', cell: (m) => m.source === 'env'
        ? <Badge>Admin · bootstrap (from .env)</Badge>
        : <select className="select" style={{ width: 'auto', height: 26 }} aria-label={`Role for ${m.username}`} value={m.role} disabled={m.username === me.data?.user} onChange={(e) => setRole.mutate({ id: m.id as number, role: e.target.value })}><option value="admin">Admin</option><option value="viewer">Viewer (read-only)</option></select> },
    { key: 'content', header: 'Content permissions', cell: m => (['transcripts', 'recordings', 'logs'] as const).filter(key => m.capabilities[key]).map(key => permissionLabels[key]).join(' · ') || 'None granted' },
    { key: 'last', header: 'Last sign-in', cell: (m) => (m.lastLoginAt ? relTime(m.lastLoginAt) : m.source === 'env' ? '—' : 'Never'), sort: (m) => m.lastLoginAt ?? 0 },
    { key: 'created', header: 'Added', hidden: true, cell: (m) => fromMs(m.createdAt) },
  ];
  return (
    <>
      <Panel title="Team members" actions={<button className="btn" onClick={() => setAdding(true)}><Plus size={15} />Add member</button>}>
        <DataTable rows={list.data} cols={cols} rowKey={(m) => String(m.id)} loading={list.isLoading} error={list.error} pageSize={false} storageKey="members"
          rowActions={(m) => m.source === 'env' ? null : (
            <>
              <button className="btn secondary sm" aria-label={`Edit content access for ${m.username}`} onClick={() => setEditing(m)}>Edit content access</button>
              <button className="btn ghost icon sm" aria-label={`Reset password for ${m.username}`} title="Reset password" onClick={() => setResetting(m)}><KeyRound size={14} /></button>
              {m.username !== me.data?.user && <button className="btn ghost icon sm" aria-label={`Remove ${m.username}`} onClick={async () => (await confirm({ title: 'Remove member?', message: `${m.username} will be signed out and lose access immediately.`, confirmLabel: 'Remove', danger: true })) && remove.mutate(m.id as number)}><Trash2 size={14} color="var(--bad)" /></button>}
            </>
          )} />
      </Panel>
      <Alert>The admin defined in the console's <span className="mono">.env</span> always works as a fallback, so a mistake here can never lock everyone out. Role and content permission changes apply on the member's next request. Administrator status does not override content permissions.</Alert>
      {editing && <EditContentAccess key={editing.id} member={editing} close={() => setEditing(null)} />}
      {adding && <AddMember onClose={() => setAdding(false)} />}
      {resetting && <ResetPassword member={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}

export function Settings() {
  const admin = useMe().data?.role === 'admin';
  const [tab, setTab] = useTab('general', ['general', 'team', 'webhooks', 'keys'] as const);
  const cfg = useApi<{ wsUrl: string; sipUri: string | null }>(['config'], '/config', { live: false });
  const col = useApi<Json>(['collector'], '/history/collector');
  const c = col.data;
  const hook = `${location.origin}/webhook`;
  const copyable = (v?: string | null) => (v ? <span className="mono">{v} <CopyButton text={v} label="Copy" /></span> : '—');
  return (
    <>
      <PageHeader crumbs={[{ label: 'Settings' }]} title="Settings" refresh={false} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'general', label: 'General' }, ...(admin ? [{ id: 'team' as const, label: 'Team members' }] : []), { id: 'webhooks', label: 'Webhooks & history' }, { id: 'keys', label: 'API keys' }]} />
      {tab === 'general' && (
        <>
          <Panel title="Server"><KV items={[['Console URL', copyable(location.origin)], ['LiveKit server URL', copyable(cfg.data?.wsUrl)], ['SIP URI', cfg.data?.sipUri ? copyable(cfg.data.sipUri) : <span className="muted">Not configured (set SIP_URI in the console .env)</span>]]} /></Panel>
          <Panel title="History database"><KV items={[['Sessions', c?.sessions ?? '…'], ['Participants', c?.participants ?? '…'], ['Events', c?.events ?? '…'], ['Egress records', c?.egress ?? '…'], ['First event', c ? fromMs(c.firstEventAt) : '…'], ['Last event', c ? `${fromMs(c.lastEventAt)} (${relTime(c.lastEventAt)})` : '…'], ['Database size', c ? fmtBytes(c.dbBytes) : '…']]} /></Panel>
        </>
      )}
      {tab === 'team' && (admin ? <Team /> : <Alert>Only administrators can manage team members.</Alert>)}
      {tab === 'webhooks' && (
        <>
          <Panel title="Webhook endpoint" actions={<CopyButton text={hook} />}><div className="panel-body"><div className="secret"><span>{hook}</span></div></div></Panel>
          <Alert kind="info">LiveKit must be able to reach the console to deliver webhooks. When both run on the same VM, point it at the local address, for example <span className="mono">http://127.0.0.1:8090/webhook</span>. <span className="mono">./deploy.sh webhook</span> adds this for you.</Alert>
          <Panel title="livekit.yaml"><pre className="mono" style={{ margin: 0, padding: 14 }}>{`webhook:
  api_key: <the key name from your keys: section>
  urls:
    - http://127.0.0.1:8090/webhook`}</pre></Panel>
          <Alert>{c?.events ? `Receiving webhooks: ${c.events.toLocaleString()} events stored, last ${relTime(c.lastEventAt)}.` : 'No webhook events have been received yet.'}</Alert>
        </>
      )}
      {tab === 'keys' && <Alert>API keys for a self-hosted server live in its <span className="mono">livekit.yaml</span> (<span className="mono">keys:</span>) and are not manageable over the API. This console uses one key, set in its own <span className="mono">.env</span>; rotate it by changing both and redeploying.</Alert>}
    </>
  );
}
