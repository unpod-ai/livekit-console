import { useState } from 'react';
import { Link } from '../lib/router';
import { api } from '../lib/api';
import { useApi, useMutate } from '../lib/hooks';
import { useMe } from '../lib/me';
import { useConfirm } from '../lib/confirm';
import { fromMs } from '../lib/format';
import { DataTable, type Col } from './DataTable';
import { Alert, Badge, KV, Kpi, Kpis, Panel, errText } from './ui';

export type InventoryAgent = { id: string; name: string; aliases: string[]; firstSeenAt: number | null; lastSeenAt: number | null };
export type Outage = { from: number; to: number | null; checks: number };
export type Worker = { url: string; ok: boolean; agentName: string | null; workerId: string | null; workerType: string | null; load: number | null; activeJobs: number | null; sdkVersion: string | null; projectType: string | null; latencyMs: number | null; checkedAt: number; error: string | null; uptimePct: number | null; avgLoadPct: number | null; outages: Outage[]; firstSeenAt: number | null; lastOkAt: number | null; lastCheckedAt: number | null; samples: number;
  consoleWorkerId?: string; agentId?: string; observedAgentName?: string | null; state?: string; identityBasis?: string; lastReportedWorkerId?: string | null; nativeIdLastReportedAt?: number | null; readiness?: string | null; infoAvailable?: boolean; lastInfoAt?: number | null; failedChecks?: number; registrationState?: string | null; metadata?: Record<string, unknown> | null; lastSeenAt?: number | null; archivedReason?: string | null;
};
export type FormerWorker = { reason?: string } & Pick<Worker, 'url' | 'agentName' | 'workerType' | 'sdkVersion' | 'projectType' | 'uptimePct' | 'avgLoadPct' | 'outages' | 'firstSeenAt' | 'lastOkAt' | 'lastCheckedAt' | 'samples'> & Partial<Worker>;
export type InventoryJob = { consoleWorkerId: string; workerId: string; roomSid: string; jobId: string; agentName: string };
export type Rollup = { t: number; samples: number; up: number; loadSum?: number; loadCount?: number; uptimePct: number | null; avgLoadPct: number | null };
export type AgentInventoryData = { agent: InventoryAgent; workers: Worker[]; former: FormerWorker[]; rollups: { series: Rollup[]; from: number; to: number; retentionDays: number; resolutionMs: number }; jobs: InventoryJob[]; jobsCoverage?: { limit: number; truncated: boolean } };

const JOB_TYPES: Record<string, string> = { JT_ROOM: 'Room', JT_PUBLISHER: 'Publisher', JT_PARTICIPANT: 'Participant' };
export const jobType = (t?: string | null) => t ? `${JOB_TYPES[t] ?? t} (${t})` : '—';
export const sdkLabel = (w: Pick<Worker, 'projectType' | 'sdkVersion'>) => w.sdkVersion ? `livekit-agents ${w.projectType ?? ''} ${w.sdkVersion}`.replace('  ', ' ') : '—';
type WorkerRow = FormerWorker & { retired?: boolean };
const archived = (w: WorkerRow) => w.retired || !!w.archivedReason || ['archived', 'stopped', 'removed', 'replaced', 'renamed'].includes(w.state ?? '');
// Health observations older than 30 seconds cannot establish current endpoint availability.
export const workerAvailable = (w: WorkerRow) => !archived(w) && w.state !== 'stale' && !!w.ok && Date.now() - (w.lastCheckedAt ?? w.checkedAt ?? 0) <= 30000;
const percent = (v: number | null | undefined) => v == null ? '—' : `${+v.toFixed(2)}%`;
const time = (v: number | null | undefined) => v == null ? '—' : fromMs(v);

export function WorkersPanel({ workers, former, agent, agentId, aliases = [], jobs = [] }: { workers: Worker[]; former: FormerWorker[]; agent?: string; agentId?: string; aliases?: string[]; jobs?: InventoryJob[] }) {
  const names = new Set([agent, ...aliases]);
  const rows: WorkerRow[] = [...workers, ...former.map(w => ({ ...w, retired: true }))].filter(w => !agent || (agentId && w.agentId === agentId) || names.has(w.agentName ?? undefined));
  const cols: Col<WorkerRow>[] = [
    { key: 'state', header: 'Lifecycle', wrap: true, cell: w => <><Badge>{w.state ?? (archived(w) ? 'Archived' : 'Observed')}</Badge>{(w.archivedReason || w.reason) && <div className="muted">{w.archivedReason || w.reason}</div>}</>, text: w => `${w.state ?? ''} ${w.archivedReason ?? w.reason ?? ''}` },
    { key: 'availability', header: 'Endpoint availability', cell: w => <Badge tone={archived(w) ? undefined : workerAvailable(w) ? 'ok' : 'warn'}>{archived(w) ? 'Archived' : workerAvailable(w) ? 'Available' : w.ok ? 'Stale observation' : 'Unavailable / unknown'}</Badge> },
    { key: 'info', header: 'Worker info (last check)', cell: w => <>{w.infoAvailable == null ? 'Unknown' : w.infoAvailable ? 'Available at last check' : 'Unavailable'}<div className="muted">Last info: {time(w.lastInfoAt)}</div></> },
    { key: 'registration', header: 'Registration / readiness (reported)', cell: w => <>{w.registrationState ?? 'Unknown'}<div className="muted">Readiness: {w.readiness ?? 'Unknown'}</div></> },
    { key: 'jobs', header: 'Serving jobs', cell: w => archived(w) || !workerAvailable(w) ? 'Unknown (historical)' : w.activeJobs ?? 'Unknown' },
    { key: 'console', header: 'Console worker ID (not native)', cell: w => <span className="mono">{w.consoleWorkerId ?? '—'}</span>, text: w => w.consoleWorkerId ?? '' },
    { key: 'native', header: 'Native worker ID', wrap: true, cell: w => <>{w.workerId && !archived(w) ? <><span className="mono">{w.workerId}</span><div className="muted">Reported at last check</div></> : <span className="muted">No current native report</span>}{(w.lastReportedWorkerId || (archived(w) && w.workerId)) && <div>Last known (historical): <span className="mono">{w.lastReportedWorkerId ?? w.workerId}</span></div>}</>, text: w => `${w.workerId ?? ''} ${w.lastReportedWorkerId ?? ''}` },
    { key: 'nativeAt', header: 'Native ID last reported at', cell: w => time(w.nativeIdLastReportedAt), sort: w => w.nativeIdLastReportedAt ?? 0 },
    { key: 'identity', header: 'Identity basis', wrap: true, cell: w => <>{{ native_worker_id: 'Reported native worker ID', configured_instance: 'Configured instance marker', endpoint_observation: 'Endpoint / agent observation' }[w.identityBasis ?? ''] ?? w.identityBasis ?? 'Endpoint / agent observation'}{!(w.workerId || w.lastReportedWorkerId) && <div className="muted">No native ID; does not prove a process restart.</div>}</> },
    { key: 'name', header: 'Observed agent name', cell: w => w.observedAgentName ?? w.agentName ?? '—', text: w => w.observedAgentName ?? w.agentName ?? '' },
    { key: 'url', header: 'Endpoint', cell: w => <span className="mono">{w.url}</span>, text: w => w.url },
    { key: 'seen', header: 'Last seen', cell: w => time(w.lastSeenAt), sort: w => w.lastSeenAt ?? 0 },
    { key: 'healthy', header: 'Last healthy', cell: w => time(w.lastOkAt), sort: w => w.lastOkAt ?? 0 },
    { key: 'check', header: 'Last check', cell: w => time(w.lastCheckedAt ?? w.checkedAt), sort: w => w.lastCheckedAt ?? w.checkedAt ?? 0 },
    { key: 'first', header: 'First seen', cell: w => time(w.firstSeenAt), sort: w => w.firstSeenAt ?? 0 },
    { key: 'sdk', header: 'SDK / job type', cell: w => <>{sdkLabel(w)}<div className="muted">{jobType(w.workerType)}</div></> },
    { key: 'metadata', header: 'Deployment metadata', wrap: true, cell: w => {
      const entries = Object.entries(w.metadata ?? {}).filter(([, v]) => v != null && typeof v !== 'object');
      return entries.length ? entries.map(([k, v]) => <div key={k}><b>{k}:</b> {String(v)}</div>) : <span className="muted">Not configured</span>;
    } },
    { key: 'load', header: 'Last reported load', cell: w => w.load == null ? '—' : percent(w.load * 100) },
    { key: 'uptime', header: 'Sampled check availability', cell: w => <>{percent(w.uptimePct)}<div className="muted">{w.samples ?? 0} checks{w.failedChecks != null && <> · {w.failedChecks} failed</>}</div></> },
    { key: 'sessions', header: 'Native-ID matched jobs', wrap: true, cell: w => {
      const native = w.workerId ?? w.lastReportedWorkerId;
      const matched = native ? jobs.filter(j => j.workerId === native && (!j.consoleWorkerId || j.consoleWorkerId === w.consoleWorkerId)) : [];
      return matched.length ? matched.map(j => <div key={`${j.roomSid}/${j.jobId}`}><Link className="rowlink mono" to={`/sessions/${encodeURIComponent(j.roomSid)}?tab=insights&reportJob=${encodeURIComponent(j.jobId)}`}>{j.jobId || j.roomSid}</Link></div>) : 'No native-ID matched jobs';
    } },
    { key: 'error', header: 'Last error', wrap: true, cell: w => w.error ?? '—' },
  ];
  return <Panel title={`Worker inventory (${rows.length})`}>
    <DataTable rows={rows} cols={cols} rowKey={w => w.consoleWorkerId ?? `${w.url}|${w.agentName}|${w.workerId ?? ''}|${w.firstSeenAt}`} pageSize={25} empty={{ title: 'No worker observations for this agent', hint: 'Inventory starts when a configured endpoint is observed.' }} />
  </Panel>;
}

function LinkPreviousName({ agent }: { agent: InventoryAgent }) {
  const list = useApi<InventoryAgent[]>(['inventory-agents'], '/inventory/agents');
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [makeCanonical, setMakeCanonical] = useState(false);
  const confirm = useConfirm();
  const entered = name.trim();
  const existing = (list.data ?? []).find(a => a.id !== agent.id && (a.id === source || a.name === entered || a.aliases.includes(entered)));
  const selected = (list.data ?? []).find(a => a.id === source);
  const alias = selected?.name ?? entered;
  const link = useMutate((body: { name: string; mergeAgentId?: string; makeCanonical: boolean }) => api(`/inventory/agents/${encodeURIComponent(agent.id)}/aliases`, { method: 'POST', body }), {
    invalidate: [['inventory-agents'], ['agent-inventory'], ['agent-workers'], ['agents'], ['agent-overview'], ['agent'], ['agent-usage']], success: 'Agent identity linked',
  });
  return <Panel title="Link previous name" flush={false}>
    <p className="muted">Only link names that identify this same agent. Reusing an endpoint does not establish identity. Original source reports keep their names.</p>
    <form onSubmit={async e => {
      e.preventDefault();
      if (!alias || list.isError || !list.data || link.isPending) return;
      if (!await confirm({ title: existing ? 'Merge agent identities?' : 'Link previous name?', message: existing ? `Merge ${existing.name} (console ID ${existing.id}) into ${agent.name} (${agent.id})? Linked history and aliases will share one identity; the old console ID will redirect.${makeCanonical ? ` The canonical name will become ${alias}.` : ''}` : `Link ${alias} to ${agent.name} (${agent.id})?${makeCanonical ? ' Use this name as the canonical name.' : ''}`, confirmLabel: existing ? 'Merge identities' : 'Link name', danger: !!existing })) return;
      link.mutate({ name: alias, ...(existing ? { mergeAgentId: existing.id } : {}), makeCanonical }, { onSuccess: () => { setSource(''); setName(''); setMakeCanonical(false); } });
    }}>
      <label className="field">Existing historical agent<select className="select" value={source} onChange={e => { setSource(e.target.value); setName(''); link.reset(); }}>
        <option value="">Enter a previous name instead</option>
        {(list.data ?? []).filter(a => a.id !== agent.id).map(a => <option key={a.id} value={a.id}>{a.name} · {a.id}</option>)}
      </select></label>
      {!source && <label className="field">Previous name<input className="input" required value={name} onChange={e => { setName(e.target.value); link.reset(); }} /></label>}
      <label className="check"><input type="checkbox" checked={makeCanonical} onChange={e => setMakeCanonical(e.target.checked)} />Use this as the canonical name</label>
      {existing && <Alert kind="warn">This name belongs to {existing.name} (console ID {existing.id}). Submitting requires explicit identity merge confirmation.</Alert>}
      {list.error && <Alert kind="bad">{errText(list.error)}</Alert>}
      {link.error && <Alert kind="bad">{errText(link.error)}</Alert>}
      <button className="btn" disabled={!alias || !list.data || list.isError || link.isPending}>{link.isPending ? 'Linking…' : 'Link previous name'}</button>
    </form>
  </Panel>;
}

// Plot the full returned time domain without the shared chart's 600-bucket cap.
function RollupChart({ data, metric, label }: { data: AgentInventoryData['rollups']; metric: 'uptimePct' | 'avgLoadPct'; label: string }) {
  const points = [...data.series].sort((a, b) => a.t - b.t);
  let previous: number | null = null;
  const path = points.map(p => {
    const value = p.samples ? p[metric] : null;
    if (value == null) { previous = null; return ''; }
    const command = previous == null || p.t - previous > data.resolutionMs ? 'M' : 'L';
    previous = p.t;
    return `${command}${45 + (p.t - data.from) / Math.max(1, data.to - data.from) * 940},${155 - Math.min(100, Math.max(0, value)) * 1.4}${command === 'M' ? 'l0.5,0' : ''}`;
  }).join(' ');
  return <Panel title={label}>
    {!points.some(p => p.samples && p[metric] != null) ? <p className="empty">No measured samples in this range</p> : <svg viewBox="0 0 1000 190" style={{ width: '100%', minHeight: 160 }} role="img" aria-label={`${label}; missing measurements are gaps`}>
      <title>{label}; missing measurements are gaps</title>
      <text x="3" y="20" fill="var(--muted)" fontSize="12">100%</text><text x="12" y="155" fill="var(--muted)" fontSize="12">0%</text>
      <path d="M45 155H985" stroke="var(--muted)" fill="none" />
      <path d={path} stroke="var(--accent, #20d5f9)" strokeWidth="1.5" fill="none" />
      <text x="45" y="180" fill="var(--muted)" fontSize="12">{fromMs(data.from)}</text><text x="985" y="180" textAnchor="end" fill="var(--muted)" fontSize="12">{fromMs(data.to)}</text>
    </svg>}
  </Panel>;
}

export function AgentInventory({ data, days, onDays }: { data: AgentInventoryData; days: number; onDays: (days: number) => void }) {
  const me = useMe();
  const r = data.rollups;
  const samples = r.series.reduce((n, p) => n + p.samples, 0);
  const up = r.series.reduce((n, p) => n + p.up, 0);
  const loadCount = r.series.reduce((n, p) => n + (p.loadCount ?? 0), 0);
  const loadSum = r.series.reduce((n, p) => n + (p.loadSum ?? 0), 0);
  return <>
    <Panel title="Agent identity"><KV items={[
      ['Canonical name', data.agent.name], ['Console agent ID (not native)', <span className="mono">{data.agent.id}</span>], ['Linked names', data.agent.aliases.filter(n => n !== data.agent.name).join(', ') || 'None'], ['First seen', time(data.agent.firstSeenAt)], ['Last seen', time(data.agent.lastSeenAt)],
    ]} /></Panel>
    {me.data?.role === 'admin' ? <LinkPreviousName key={data.agent.id} agent={data.agent} /> : <Alert>Identity links are read-only. An administrator can link a previous name.</Alert>}
    {data.jobsCoverage?.truncated && <Alert>Native-ID matched job links show up to {data.jobsCoverage.limit} retained job matches; additional matches may be omitted.</Alert>}
    <WorkersPanel workers={data.workers} former={data.former} agent={data.agent.name} agentId={data.agent.id} aliases={data.agent.aliases} jobs={data.jobs} />
    <Panel title="Retained endpoint checks" actions={<select className="select" aria-label="Inventory range" value={days} onChange={e => onDays(Number(e.target.value))}>{[30, 90, 365].map(d => <option key={d} value={d}>Past {d} days</option>)}</select>} flush={false}>
      <p>Sampled endpoint availability measures successful checks, not continuous uptime. Worker info, registration/readiness and serving jobs are separate observations. Missing load measurements remain unavailable.</p>
      <p className="muted">Coverage: {fromMs(r.from)} – {fromMs(r.to)} · retention {r.retentionDays} days · bucket {r.resolutionMs / 3600000} hours. Worker inventory survives sample expiration.</p>
    </Panel>
    <Kpis><Kpi label="Successful sampled checks" value={samples ? percent(up / samples * 100) : '—'} foot={`${up} successful / ${samples} measured checks`} /><Kpi label="Buckets with checks" value={r.series.filter(p => p.samples > 0).length} foot="Unobserved periods are gaps" /><Kpi label="Measured average load" value={loadCount ? percent(loadSum / loadCount * 100) : '—'} foot={`${loadCount} reported load measurements`} /></Kpis>
    <RollupChart data={r} metric="uptimePct" label="Sampled endpoint availability" />
    <RollupChart data={r} metric="avgLoadPct" label="Measured average load" />
    <Panel title="Measured rollup samples"><DataTable rows={[...r.series].reverse()} rowKey={p => String(p.t)} pageSize={25} search={false} empty={{ title: 'No retained sampled checks' }} cols={[
      { key: 't', header: 'Bucket start', cell: p => fromMs(p.t), sort: p => p.t }, { key: 'samples', header: 'Checks', cell: p => p.samples }, { key: 'up', header: 'Successful', cell: p => p.up }, { key: 'uptime', header: 'Sampled availability', cell: p => percent(p.uptimePct) }, { key: 'load', header: 'Measured load', cell: p => percent(p.avgLoadPct) },
    ]} /></Panel>
  </>;
}
