import { useState } from 'react';
import { api, projectResource, type Json } from '../lib/api';
import { useApi, useMutate } from '../lib/hooks';
import { can, useMe } from '../lib/me';
import { useConfirm } from '../lib/confirm';
import { selectedProject } from '../lib/project';
import { fmtBytes, fromMs } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { Alert, Badge, Kpi, Kpis, KV, PageHeader, Panel, Tabs } from '../components/ui';

const labels = { reports: 'Agent reports', live: 'Live events and spans', logs: 'Structured logs', diagnostics: 'Diagnostics', history: 'Session history', workers: 'Worker history', traffic: 'Repository traffic', recordings: 'Recording access' };
type Category = keyof typeof labels;
type Policy = { categories: Record<Category, { retentionDays: number | null; accessEnabled?: boolean }>; redaction: 'off' | 'standard' | 'strict'; redactTerms: string[] };
type PolicyResponse = Policy & { bounds?: { minDays: number; maxDays: number; maxTerms: number; maxTermLength: number; exportRows: number; exportBytes: number } };
type Coverage = { rows: number; tables: Record<string, number>; retentionDays: number | null };
type Summary = { collectors: Json[]; storage: { databaseBytes: number; walBytes: number; allocatedBytes: number; pageCount: number; pageSize: number; categories?: Partial<Record<Category, Coverage>> }; categories?: Partial<Record<Category, Coverage>>; alerts: unknown };
const categoryList = Object.keys(labels) as Category[];
const tableLabels: Record<string, string> = { agent_session_reports: 'Agent reports', agent_live_jobs: 'Live jobs', agent_live_records: 'Live event records', agent_log_entries: 'Structured log entries', diagnostic_records: 'Diagnostic observations', sessions: 'Sessions', participants: 'Participants', events: 'Session events', egress: 'Egress records', agent_worker_samples: 'Worker samples', inventory_rollups: 'Worker rollups', repo_traffic: 'Repository traffic' };
const coverageText = (tables: Record<string, number> = {}) => Object.entries(tables).map(([key, count]) => `${tableLabels[key] ?? key}: ${count.toLocaleString()}`).join(' · ') || 'No local content rows';

function PolicyEditor({ initial }: { initial: PolicyResponse }) {
  const [draft, setDraft] = useState<Policy>(() => ({ categories: structuredClone(initial.categories), redaction: initial.redaction, redactTerms: [...initial.redactTerms] }));
  const [terms, setTerms] = useState(initial.redactTerms.join('\n'));
  const confirm = useConfirm();
  const save = useMutate((body: Policy) => api('/operations/policy', { method: 'PATCH', body }), { invalidate: [['operations-policy'], ['operations-summary']], success: 'Project policy updated' });
  const termList = terms.split('\n').map(t => t.trim()).filter(Boolean);
  const valid = categoryList.every(key => {
    const days = draft.categories[key].retentionDays;
    return days === null ? ['history', 'traffic'].includes(key) : Number.isInteger(days) && days >= (key === 'workers' ? 14 : initial.bounds?.minDays ?? 1) && days <= (initial.bounds?.maxDays ?? 3650);
  }) && termList.length <= (initial.bounds?.maxTerms ?? 50) && termList.every(t => t.length <= (initial.bounds?.maxTermLength ?? 200));
  return <Panel title="Retention and privacy"><form className="panel-body operations-form" onSubmit={async e => {
    e.preventDefault();
    if (valid && await confirm({ title: 'Apply project policy?', message: 'Shorter retention and redaction also apply to content already stored. Expired or deleted content cannot be recovered.', confirmLabel: 'Apply policy', danger: true })) save.mutate({ ...draft, redactTerms: termList });
  }}>
    <Alert>Retention applies to stored and future data. Recording policy controls console access and never deletes storage objects. Audit retention is managed separately by the operator.</Alert>
    {categoryList.map(key => <label key={key}>{labels[key]} · days<input className="input" type="number" min={key === 'workers' ? 14 : initial.bounds?.minDays ?? 1} max={initial.bounds?.maxDays ?? 3650} step="1" value={draft.categories[key].retentionDays ?? ''} placeholder={['history', 'traffic'].includes(key) ? 'Keep indefinitely' : undefined} onChange={e => setDraft({ ...draft, categories: { ...draft.categories, [key]: { ...draft.categories[key], retentionDays: e.target.value === '' ? null : Number(e.target.value) } } })} /><span className="hint">{key === 'workers' ? '14–3650 days' : ['history', 'traffic'].includes(key) ? 'Leave empty to keep indefinitely' : '1–3650 days'}</span></label>)}
    <label className="check"><input type="checkbox" checked={draft.categories.recordings.accessEnabled !== false} onChange={e => setDraft({ ...draft, categories: { ...draft.categories, recordings: { ...draft.categories.recordings, accessEnabled: e.target.checked } } })} />Allow console recording access</label>
    <label>Content redaction<select className="select" value={draft.redaction} onChange={e => setDraft({ ...draft, redaction: e.target.value as Policy['redaction'] })}><option value="off">Off</option><option value="standard">Standard</option><option value="strict">Strict</option></select></label>
    <label>Additional terms to redact<textarea className="textarea" rows={4} value={terms} onChange={e => setTerms(e.target.value)} /><span className="hint">One term per line, up to {initial.bounds?.maxTerms ?? 50} terms.</span></label>
    {save.error && <Alert kind="bad">{save.error.message}</Alert>}
    <button className="btn" disabled={!valid || save.isPending}>{save.isPending ? 'Applying…' : 'Apply policy'}</button>
  </form></Panel>;
}

function DataControls({ summary, bounds }: { summary?: Summary; bounds?: PolicyResponse['bounds'] }) {
  const me = useMe();
  const [category, setCategory] = useState<Category>('reports');
  const [content, setContent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Json | null>(null);
  const confirm = useConfirm();
  const coverage = summary?.categories?.[category] ?? summary?.storage.categories?.[category];
  const contentAllowed = category === 'reports' ? can(me.data, 'transcripts') : category === 'live' ? can(me.data, 'transcripts') && can(me.data, 'logs') : category === 'logs' ? can(me.data, 'logs') : category === 'diagnostics';
  const metadataAllowed = category === 'reports' ? can(me.data, 'transcripts') : category === 'live' ? can(me.data, 'transcripts') && can(me.data, 'logs') : ['logs', 'history'].includes(category) ? can(me.data, 'logs') : category === 'recordings' ? can(me.data, 'recordings') : true;
  const remove = useMutate(() => api<Json>(`/operations/data/${category}`, { method: 'DELETE', body: { confirm: category } }), { invalidate: [['operations-summary'], ['operations-policy']], success: 'Project data action completed' });
  async function download() {
    setExporting(true); setError('');
    try {
      const res = await fetch(projectResource(`/api/operations/export/${category}?content=${content && contentAllowed ? 'true' : 'false'}`), { credentials: 'same-origin' });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error ?? 'Export could not be completed.'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `${selectedProject()}-${category}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); }
    finally { setExporting(false); }
  }
  return <Panel title="Export and delete project data"><div className="panel-body">
    <Alert>Exports are bounded to {(bounds?.exportRows ?? 10000).toLocaleString()} rows and {fmtBytes(bounds?.exportBytes ?? 8 * 1024 * 1024)}. A category exceeding either limit is refused. Local history metadata may be collected again from upstream sources after deletion. Content deletion retains expiry markers.</Alert>
    <div className="operations-form">
      <label>Data category<select className="select" value={category} disabled={remove.isPending || exporting} onChange={e => { setCategory(e.target.value as Category); setContent(false); setReceipt(null); setError(''); }}>{categoryList.map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
      {contentAllowed && <label className="check"><input type="checkbox" checked={content} onChange={e => setContent(e.target.checked)} />Include retained content</label>}
      <button className="btn secondary" disabled={exporting || remove.isPending || !metadataAllowed} onClick={download}>{exporting ? 'Exporting…' : 'Export category'}</button>
      <button className="btn danger" disabled={remove.isPending || exporting || !summary} onClick={async () => {
        if (await confirm({ title: category === 'recordings' ? 'Disable recording access?' : `Delete ${labels[category].toLowerCase()}?`, message: category === 'recordings' ? 'This disables playback through the console. Files in upstream storage remain intact.' : `This affects only the selected project. ${coverage ? coverageText(coverage.tables) : 'Stored rows in the selected category'} will be processed. Retained conversation content cannot be restored. Collected metadata may appear again.`, confirmLabel: category === 'recordings' ? 'Disable access' : 'Delete category', danger: true })) remove.mutate(undefined, { onSuccess: setReceipt });
      }}>{remove.isPending ? 'Working…' : category === 'recordings' ? 'Disable access' : 'Delete category'}</button>
    </div>
    {!metadataAllowed && <Alert>You need the content permissions for this category before exporting.</Alert>}
    <p className="muted operations-scope">{coverage ? `${coverage.rows.toLocaleString()} category rows · ${coverageText(coverage.tables)}` : 'Category coverage is loading.'}</p>
    {(error || remove.error) && <Alert kind="bad">{error || remove.error?.message}</Alert>}
    {receipt && <Alert>{receipt.rows?.toLocaleString() ?? 0} rows affected. {coverageText(receipt.tables)}. {receipt.metadataMayBeRediscovered ? 'Upstream metadata can be collected again.' : 'Stored content expiry markers remain in place.'} Upstream objects were not deleted.</Alert>}
  </div></Panel>;
}

function Audit() {
  const audit = useApi<{ rows: Json[] }>(['operations-audit'], '/operations/audit?limit=100');
  return <Panel title="Project audit"><DataTable rows={audit.data?.rows} loading={audit.isLoading} error={audit.error} rowKey={r => String(r.id)} cols={[
    { key: 'time', header: 'Time', cell: r => fromMs(r.at ?? r.createdAt), sort: r => r.at ?? r.createdAt ?? 0 },
    { key: 'scope', header: 'Scope', cell: r => !r.projectId || ['control', 'global'].includes(r.projectId) ? 'Global control' : r.projectId, text: r => String(r.projectId ?? 'Global control') },
    { key: 'actor', header: 'Actor', cell: r => r.actor, text: r => String(r.actor ?? '') },
    { key: 'action', header: 'Action', cell: r => r.action, text: r => String(r.action ?? '') },
    { key: 'resource', header: 'Resource', cell: r => r.resource ?? r.route, wrap: true },
    { key: 'status', header: 'Status', cell: r => r.status ?? r.outcome ?? 'Pending' },
    { key: 'request', header: 'Request ID', cell: r => r.requestId ?? r.id, wrap: true },
  ]} empty={{ title: 'No audit entries for this project' }} /><p className="muted" style={{ padding: 14 }}>Latest 100 entries. Global administrators also see global account and sign-in activity, labeled by scope. Audit history cannot be deleted from project controls.</p></Panel>;
}

export function Operations() {
  const me = useMe();
  if (me.data?.role !== 'admin') return <Alert>Only project administrators can manage operations.</Alert>;
  return <OperationsContent />;
}
function OperationsContent() {
  const [tab, setTab] = useState('health');
  const summary = useApi<Summary>(['operations-summary'], '/operations/summary');
  const policy = useApi<PolicyResponse>(['operations-policy'], '/operations/policy', { live: false });
  const storage = summary.data?.storage;
  return <>
    <PageHeader title="Operations" crumbs={[{ label: 'Project' }, { label: 'Operations' }]} sub="Monitor collection, manage retained data, and review project activity." />
    <Tabs value={tab} onChange={setTab} tabs={[{ id: 'health', label: 'Health & storage' }, { id: 'policy', label: 'Retention & privacy' }, { id: 'alerts', label: 'Alerts' }, { id: 'data', label: 'Data controls' }, { id: 'audit', label: 'Audit' }]} />
    {summary.error && <Alert kind="bad">{summary.error.message}</Alert>}
    {tab === 'health' && <>
      <Kpis><Kpi label="Database size" value={storage ? fmtBytes(storage.databaseBytes) : 'Not measured'} /><Kpi label="Write-ahead log" value={storage ? fmtBytes(storage.walBytes) : 'Not measured'} /><Kpi label="Allocated storage" value={storage ? fmtBytes(storage.allocatedBytes) : 'Not measured'} /></Kpis>
      <Panel title="Collectors"><DataTable rows={summary.data?.collectors} loading={summary.isLoading} rowKey={r => String(r.source ?? r.id)} cols={[
        { key: 'source', header: 'Source', cell: r => sourceLabel(r.source, summary.data?.collectors ?? []), text: r => sourceLabel(r.source, summary.data?.collectors ?? []) },
        { key: 'state', header: 'State', cell: r => <Badge>{r.state ?? (r.enabled === false ? 'Disabled' : 'Unknown')}</Badge> },
        { key: 'receipt', header: 'Last received', cell: r => fromMs(r.lastReceipt) },
        { key: 'sourceAt', header: 'Last source time', cell: r => fromMs(r.sourceAt) },
        { key: 'lag', header: 'Ingestion lag', cell: r => r.lagMs == null ? 'Not measured' : `${r.lagMs.toLocaleString()} ms` },
        { key: 'success', header: 'Last successful check', cell: r => fromMs(r.lastSuccess) },
        { key: 'rate', header: 'Receipts / minute (past hour)', cell: r => r.receiptsPerMinute == null ? 'Not measured' : Number(r.receiptsPerMinute).toFixed(2) },
        { key: 'failures', header: 'Failed attempts', cell: r => r.failures ?? 'Unknown' },
        { key: 'error', header: 'Error category', cell: r => r.error ?? 'None reported', wrap: true },
      ]} empty={{ title: 'No collector observations yet' }} /></Panel>
      <Panel title="Stored data"><DataTable rows={Object.entries(summary.data?.categories ?? storage?.categories ?? {}).map(([category, value]) => ({ category, ...value }))} rowKey={r => r.category} loading={summary.isLoading} cols={[
        { key: 'category', header: 'Category', cell: r => labels[r.category as Category] ?? r.category },
        { key: 'rows', header: 'Rows', cell: r => r.rows.toLocaleString() },
        { key: 'retention', header: 'Retention', cell: r => r.retentionDays == null ? 'Keep indefinitely' : `${r.retentionDays} days` },
        { key: 'coverage', header: 'Coverage', wrap: true, cell: r => coverageText(r.tables) },
      ]} search={false} /></Panel>
      <Alert>Disabled or unobserved sources have no inferred health. Missing latency and volume measurements are not treated as zero.</Alert>
    </>}
    {tab === 'policy' && (policy.error ? <Alert kind="bad">{policy.error.message}</Alert> : policy.data ? <PolicyEditor key={policy.dataUpdatedAt} initial={policy.data} /> : <Alert>Loading project policy…</Alert>)}
    {tab === 'alerts' && <Alerts collectors={summary.data?.collectors ?? []} />}
    {tab === 'data' && <DataControls summary={summary.data} bounds={policy.data?.bounds} />}
    {tab === 'audit' && <Audit />}
  </>;
}

const ruleLabels = { worker_down: 'Worker unavailable', source_stale: 'Source stale', ingestion_failures: 'Ingestion failures', failed_calls: 'Failed calls', failed_egress: 'Failed egress', latency_ms: 'Response latency', quality_rtt_ms: 'Connection round-trip time', quality_packet_loss_pct: 'Packet loss' };
type RuleKind = keyof typeof ruleLabels;
type Rule = { id: string; kind: RuleKind; source: string; threshold: number; windowSeconds: number; enabled: boolean };
type AlertEvent = { id: string; ruleId: string; source: string; kind: RuleKind; state: 'open' | 'acknowledged' | 'resolved'; value: number; windowSeconds: number; firstAt: number; lastAt: number; ackAt: number | null; resolvedAt: number | null };
const sourceLabels: Record<string, string> = { webhook: 'Webhooks', reports: 'Agent reports', live: 'Live events', logs: 'Structured logs', diagnostics: 'Diagnostics', reconcile: 'Session reconciliation', egress: 'Egress collection', traffic: 'Repository traffic' };
function sourceLabel(source: string, collectors: Json[]) {
  if (sourceLabels[source]) return sourceLabels[source];
  const workers = collectors.filter(c => String(c.source).startsWith('worker-'));
  const index = workers.findIndex(c => c.source === source);
  return index >= 0 ? `Worker endpoint ${index + 1}` : 'Worker endpoint';
}
const units = (kind: RuleKind) => kind === 'source_stale' ? 'seconds' : kind === 'worker_down' ? 'unavailable observations' : kind === 'quality_packet_loss_pct' ? '%' : ['latency_ms', 'quality_rtt_ms'].includes(kind) ? 'ms' : 'failures';
function sourceMatches(kind: RuleKind, source: string) {
  return kind === 'worker_down' ? source.startsWith('worker-') : kind.startsWith('quality_') || kind === 'failed_calls' ? source === 'diagnostics' : kind === 'failed_egress' ? source === 'egress' : kind === 'latency_ms' ? ['reports', 'live'].includes(source) : true;
}
function Alerts({ collectors }: { collectors: Json[] }) {
  const rules = useApi<Rule[]>(['operations-rules'], '/operations/rules');
  const events = useApi<{ rows: AlertEvent[] }>(['operations-alerts'], '/operations/alerts');
  const [editing, setEditing] = useState<Rule | null>(null);
  const save = useMutate((r: Rule) => api(`/operations/rules${r.id ? `/${encodeURIComponent(r.id)}` : ''}`, { method: r.id ? 'PATCH' : 'POST', body: { kind: r.kind, source: r.source, threshold: r.threshold, windowSeconds: r.windowSeconds, enabled: r.enabled } }), { invalidate: [['operations-rules'], ['operations-alerts']], success: 'Alert rule saved' });
  const transition = useMutate((v: { id: string; action: 'ack' | 'resolve' }) => api(`/operations/alerts/${encodeURIComponent(v.id)}/${v.action}`, { method: 'POST' }), { invalidate: [['operations-alerts'], ['operations-summary']], success: 'Alert updated' });
  const valid = editing && editing.source && Number.isFinite(editing.threshold) && editing.threshold > 0 && editing.threshold <= 1e12 && Number.isInteger(editing.windowSeconds) && editing.windowSeconds >= 10 && editing.windowSeconds <= 604800;
  return <>
    <Alert>Alerts use submitted measurements within each rule’s window. Missing measurements do not trigger alerts. Disabled sources are not evaluated. Notifications appear in this console.</Alert>
    <Panel title="Alert rules" actions={<button className="btn" disabled={!collectors.length || save.isPending} onClick={() => setEditing({ id: '', kind: 'source_stale', source: collectors[0]?.source ?? '', threshold: 300, windowSeconds: 300, enabled: true })}>Add alert rule</button>}>
      <DataTable rows={rules.data} loading={rules.isLoading} error={rules.error} rowKey={r => r.id} cols={[
        { key: 'kind', header: 'Condition', cell: r => ruleLabels[r.kind], text: r => ruleLabels[r.kind] },
        { key: 'source', header: 'Measured source', cell: r => sourceLabel(r.source, collectors) },
        { key: 'threshold', header: 'Threshold', cell: r => `${r.threshold.toLocaleString()} ${units(r.kind)}` },
        { key: 'window', header: 'Window', cell: r => `${r.windowSeconds.toLocaleString()} seconds` },
        { key: 'enabled', header: 'State', cell: r => <Badge>{r.enabled ? 'Enabled' : 'Disabled'}</Badge> },
      ]} rowActions={r => <button className="btn secondary sm" disabled={save.isPending} onClick={() => setEditing({ ...r })}>Edit rule</button>} empty={{ title: 'No alert rules configured' }} />
    </Panel>
    {editing && <Panel title={editing.id ? 'Edit alert rule' : 'Add alert rule'}><form className="panel-body operations-form" onSubmit={e => { e.preventDefault(); if (valid) save.mutate(editing, { onSuccess: () => setEditing(null) }); }}>
      <label>Condition<select className="select" value={editing.kind} onChange={e => { const kind = e.target.value as RuleKind; setEditing({ ...editing, kind, source: collectors.find(c => sourceMatches(kind, c.source))?.source ?? '' }); }}>{(Object.keys(ruleLabels) as RuleKind[]).map(kind => <option key={kind} value={kind}>{ruleLabels[kind]}</option>)}</select></label>
      <label>Measured source<select className="select" value={editing.source} onChange={e => setEditing({ ...editing, source: e.target.value })}><option value="" disabled>Choose a source</option>{collectors.filter(c => sourceMatches(editing.kind, c.source)).map(c => <option key={c.source} value={c.source}>{sourceLabel(c.source, collectors)}{c.enabled === false ? ' (disabled)' : ''}</option>)}</select></label>
      <label>Threshold ({units(editing.kind)})<input type="number" className="input" min="0.000001" max="1000000000000" step="any" value={editing.threshold} onChange={e => setEditing({ ...editing, threshold: Number(e.target.value) })} /></label>
      <label>Observation window (seconds)<input type="number" className="input" min="10" max="604800" step="1" value={editing.windowSeconds} onChange={e => setEditing({ ...editing, windowSeconds: Number(e.target.value) })} /></label>
      {['worker_down', 'ingestion_failures'].includes(editing.kind) && <p className="muted">Failure counts use one-minute buckets and include boundary minutes. Worker alerts also require the latest check to be unavailable.</p>}
      {editing.kind === 'failed_calls' && <p className="muted">Counts distinct observed call IDs with an explicit failed outcome. Authentication challenges and unknown outcomes are excluded.</p>}
      <label className="check"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} />Enable this rule</label>
      {save.error && <Alert kind="bad">{save.error.message}</Alert>}
      <div className="table-tools"><button className="btn" disabled={!valid || save.isPending}>{save.isPending ? 'Saving…' : 'Save rule'}</button><button type="button" className="btn secondary" onClick={() => setEditing(null)}>Cancel</button></div>
    </form></Panel>}
    <Panel title="Alert events"><DataTable rows={events.data?.rows} loading={events.isLoading} error={events.error} rowKey={r => r.id} cols={[
      { key: 'condition', header: 'Condition', cell: r => ruleLabels[r.kind], text: r => ruleLabels[r.kind] },
      { key: 'source', header: 'Measured source', cell: r => sourceLabel(r.source, collectors) },
      { key: 'value', header: 'Measured value', cell: r => `${r.value.toLocaleString()} ${units(r.kind)}` },
      { key: 'window', header: 'Window', cell: r => `${r.windowSeconds.toLocaleString()} seconds` },
      { key: 'state', header: 'State', cell: r => <Badge tone={r.state === 'open' ? 'warn' : r.state === 'resolved' ? 'ok' : undefined}>{r.state}</Badge> },
      { key: 'first', header: 'First observed', cell: r => fromMs(r.firstAt) },
      { key: 'last', header: 'Last observed', cell: r => fromMs(r.lastAt) },
    ]} rowActions={r => <>{r.state === 'open' && <button className="btn secondary sm" disabled={transition.isPending} onClick={() => transition.mutate({ id: r.id, action: 'ack' })}>Acknowledge</button>}{r.state !== 'resolved' && <button className="btn secondary sm" disabled={transition.isPending} onClick={() => transition.mutate({ id: r.id, action: 'resolve' })}>Resolve</button>}</>} empty={{ title: 'No alert events' }} />{transition.error && <Alert kind="bad">{transition.error.message}</Alert>}<p className="muted" style={{ padding: 14 }}>Latest 500 events. Repeated observations of an active condition are grouped together.</p></Panel>
  </>;
}
