import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApi, useMutate } from '../lib/hooks';
import { useMe, can } from '../lib/me';
import { useConfirm } from '../lib/confirm';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Empty, KV, PageHeader, Panel } from '../components/ui';
import type { InventoryAgent } from '../components/AgentInventory';

export function deploymentTime(value?: number | string | null) {
  if (value == null || value === '') return 'Unknown';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown';
}

export type DeploymentTarget = { id: string; name: string; agentName: string; image?: string; imageId?: string; version?: string; environment?: string; host?: string; region?: string; replicas?: number; state?: string; health?: string; observedAt?: number | string; managed: boolean; actionsEnabled: boolean; secretRevision?: string; allowedImages?: { reference: string; imageId: string }[]; instances: { id: string; image?: string; imageId?: string; state?: string; health?: string; createdAt?: number | string; role: string }[] };
type Operation = { id: string; targetId: string; action: string; state: string; startedAt: number | string; updatedAt: number | string; steps: { at: number | string; state: string; message: string }[]; error?: string };
export type DeploymentsData = { configured: boolean; targets: DeploymentTarget[]; operations: Operation[] };
const enc = encodeURIComponent;

function Secrets({ target }: { target: DeploymentTarget }) {
  const meta = useApi<{ revision: string; keys: string[]; allowedKeys: string[] }>(['deployment-secrets', target.id], `/deployments/targets/${enc(target.id)}/secrets`, { live: false });
  const [values, setValues] = useState<Record<string, string>>({});
  const confirm = useConfirm();
  const save = useMutate((values: Record<string, string>) => api(`/deployments/targets/${enc(target.id)}/secrets`, { method: 'PUT', body: { values, confirm: target.id } }), { invalidate: [['deployment-secrets', target.id], ['deployments']], success: 'Secret revision saved. Deploy to apply it.' });
  return <Panel title="Secret revisions"><form className="panel-body phase6-form" onSubmit={async e => { e.preventDefault(); const update = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')); if (Object.keys(update).length && await confirm({ title: 'Save secret revision?', message: `Update selected allowed keys for ${target.name}. Values are write-only; applying them requires a new rollout.`, confirmLabel: 'Save secrets' })) { try { await save.mutateAsync(update); } catch { /* Mutation toast reports the error without retaining values. */ } finally { setValues({}); save.reset(); } } }}>
    <p>Current revision: {meta.data?.revision ?? 'Unknown'} · Configured keys: {meta.data?.keys.join(', ') || 'None'}. Values are never read back. Blank fields are unchanged.</p>
    {meta.error && <Alert kind="bad">{meta.error.message}</Alert>}
    {meta.data?.allowedKeys.map(key => <label key={key}>{key}<input className="input" type="password" autoComplete="new-password" value={values[key] ?? ''} onChange={e => setValues({ ...values, [key]: e.target.value })} /></label>)}
    <button className="btn" disabled={save.isPending || !Object.values(values).some(Boolean)}>Save secrets</button>
  </form></Panel>;
}

function TargetDetail({ target, operations }: { target: DeploymentTarget; operations: Operation[] }) {
  const me = useMe();
  const agents = useApi<InventoryAgent[]>(['inventory-agents'], '/inventory/agents', { live: false });
  const agentRef = agents.data?.find(a => a.name === target.agentName || a.aliases.includes(target.agentName))?.id ?? target.agentName;
  const confirm = useConfirm();
  const [image, setImage] = useState('');
  const [logKind, setLogKind] = useState<'runtime' | 'build'>('runtime');
  const [showLogs, setShowLogs] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const logs = useApi<{ lines: string[]; truncated: boolean }>(['deployment-logs', target.id, logKind], `/deployments/targets/${enc(target.id)}/logs?kind=${logKind}&lines=200`, { enabled: showLogs && can(me.data, 'logs'), live: false });
  const action = useMutate((name: string) => api<Operation>(`/deployments/targets/${enc(target.id)}/actions`, { method: 'POST', body: { action: name, ...(name === 'deploy' ? { image } : {}), confirm: target.id, requestId: crypto.randomUUID() } }), { invalidate: [['deployments']], success: 'Operation submitted' });
  const enabled = target.managed && target.actionsEnabled;
  const targetOps = operations.filter(o => o.targetId === target.id);
  const blocked = targetOps.some(o => !['completed', 'complete', 'succeeded', 'failed', 'timed_out', 'unknown', 'reconcile_required'].includes(o.state));
  const needsReconcile = targetOps.some(o => ['timed_out', 'unknown', 'reconcile_required'].includes(o.state));
  return <>
    <Panel title={target.name}><div className="panel-body">
      <KV items={[[ 'Agent', <Link to={`/agents/${enc(agentRef)}`}>{target.agentName}</Link> ], ['Environment', target.environment ?? 'Unknown'], ['Host / region', `${target.host ?? 'Unknown'} / ${target.region ?? 'Unknown'}`], ['Image', target.image ?? 'Unknown'], ['Immutable image', target.imageId ?? 'Unknown'], ['Version', target.version ?? 'Unknown'], ['Replicas', target.replicas ?? 'Unknown'], ['State / health', `${target.state ?? 'Unknown'} / ${target.health ?? 'Unknown'}`], ['Observed', deploymentTime(target.observedAt)], ['Secret revision', target.secretRevision ?? 'Unknown']]} />
      <Alert>Container health does not prove LiveKit registration. Registration: unknown. This host inventory is separate from sampled worker history.</Alert>
      {can(me.data, 'transcripts') && <Link className="btn secondary" to={`/agent-testing?agentName=${enc(target.agentName)}&deploymentId=${enc(target.id)}`}>Test this agent</Link>}
    </div></Panel>
    <Panel title="Instances"><div className="phase6-cards panel-body">{target.instances?.length ? target.instances.map(i => <article className="phase6-card" key={i.id}><Badge>{i.role}</Badge><p className="mono">{i.id}</p><p>{i.state ?? 'Unknown'} · {i.health ?? 'Unknown'}</p><p>Created: {deploymentTime(i.createdAt)}</p><p className="mono">{i.image ?? 'Unknown image'}</p><p className="mono">{i.imageId ?? 'Unknown immutable image'}</p></article>) : <Empty title="No instances observed" />}</div></Panel>
    {enabled ? <Panel title="Controlled actions"><div className="panel-body phase6-form">
      <label>Allowed image<select className="select" value={image} onChange={e => setImage(e.target.value)}><option value="">Select an inspectable image</option>{target.allowedImages?.map(i => <option key={i.reference} value={i.reference}>{i.reference} · {i.imageId}</option>)}</select></label>
      <div className="phase6-actions">{['build', 'deploy', 'drain', 'rollback', 'reconcile'].map(name => <button className={`btn ${name === 'drain' ? 'solid-danger' : 'secondary'}`} key={name} disabled={action.isPending || blocked || (needsReconcile && name !== 'reconcile') || (name === 'deploy' && !target.allowedImages?.some(i => i.reference === image))} onClick={async () => { if (await confirm({ title: `${name[0].toUpperCase() + name.slice(1)} ${target.name}?`, message: name === 'deploy' ? `Deploy ${image}. The helper health-checks the candidate before draining the old instance.` : name === 'drain' ? 'Signal the current worker and observe its exit. Active work may continue; the console never forces termination.' : `Submit the ${name} operation for this managed target.`, confirmLabel: `Confirm ${name}`, danger: name === 'drain' })) action.mutate(name); }}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>
      {blocked && <Alert>Another operation is in progress.</Alert>}{needsReconcile && <Alert kind="warn">An interrupted or timed-out operation requires explicit reconciliation.</Alert>}
      {action.error && <Alert kind="bad">{action.error.message}</Alert>}
      <button className="btn secondary" onClick={() => setShowSecrets(v => !v)}>{showSecrets ? 'Hide secret editor' : 'Update secrets'}</button>
    </div></Panel> : <Alert>This target is read-only. Managed actions are not enabled.</Alert>}
    {enabled && showSecrets && <Secrets target={target} />}
    <Panel title="Operation progress"><div className="panel-body" aria-live="polite">{targetOps.length ? targetOps.map(o => <article className="phase6-card" key={o.id}><strong>{o.action}</strong> <Badge>{o.state}</Badge><p className="mono">{o.id}</p><p>Started: {deploymentTime(o.startedAt)} · Updated: {deploymentTime(o.updatedAt)}</p>{o.steps.map((s, n) => <p key={n}>{deploymentTime(s.at)} · {s.state} · {s.message}</p>)}{o.error && <Alert kind="bad">{o.error}</Alert>}</article>) : <p>No operations recorded.</p>}</div></Panel>
    {can(me.data, 'logs') ? <Panel title="Bounded host logs"><div className="panel-body phase6-form"><label>Log source<select className="select" value={logKind} onChange={e => setLogKind(e.target.value as 'runtime' | 'build')}><option value="runtime">Runtime</option><option value="build">Build</option></select></label><button className="btn secondary" onClick={() => { setShowLogs(true); if (showLogs) void logs.refetch(); }}>Read logs</button>{logs.error && <Alert kind="bad">{logs.error.message}</Alert>}{logs.data && <><pre className="phase6-output">{logs.data.lines.join('\n') || 'No log lines returned.'}</pre>{logs.data.truncated && <p>Output truncated to the bounded log window.</p>}</>}</div></Panel> : <Alert>Logs access is required to read deployment logs.</Alert>}
  </>;
}

export function Deployments() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const inventory = useQuery({ queryKey: ['deployments'], queryFn: () => api<DeploymentsData>('/deployments/targets'), enabled: me.data?.role === 'admin', refetchInterval: 3000 });
  const targets = inventory.data?.targets ?? [];
  const selected = targets.find(t => t.id === params.get('target'));
  return <div className="phase6-page"><PageHeader title="Deployments" sub="Docker host inventory and controlled rollouts" />{me.data?.role !== 'admin' ? <Alert>Administrator access is required.</Alert> : <>
    {inventory.isPending && <Alert>Loading host inventory…</Alert>}{inventory.error && <Alert kind="bad">Deployment helper unavailable: {inventory.error.message}</Alert>}
    {inventory.data?.configured === false && <Alert>Deployment helper is not configured for this server.</Alert>}
    {!!targets.length && <label className="phase6-select">Deployment target<select className="select" value={selected?.id ?? ''} onChange={e => setParams(old => { const next = new URLSearchParams(old); next.set('target', e.target.value); return next; })}><option value="">All targets</option>{targets.map(t => <option key={t.id} value={t.id}>{t.name} · {t.agentName}</option>)}</select></label>}
    {selected ? <TargetDetail key={selected.id} target={selected} operations={inventory.data?.operations ?? []} /> : <div className="phase6-cards">{targets.map(t => <Panel key={t.id} title={<Link to={`/deployments?target=${enc(t.id)}`}>{t.name}</Link>}><div className="panel-body phase6-card"><Badge>{t.managed && t.actionsEnabled ? 'Managed' : 'Read-only'}</Badge><p>{t.agentName} · {t.environment ?? 'Unknown environment'}</p><p>{t.state ?? 'Unknown state'} · {t.health ?? 'Unknown health'}</p><p className="mono">{t.image ?? 'Unknown image'}</p><p>Version: {t.version ?? 'Unknown'} · Replicas: {t.replicas ?? 'Unknown'}</p></div></Panel>)}</div>}
  </>}</div>;
}
