import { Link, useSearchParams } from 'react-router-dom';
import { useMe, can } from '../lib/me';
import { useApi } from '../lib/hooks';
import { fromMs } from '../lib/format';
import { AreaChart, BarsChart, PALETTE } from './Charts';
import { DataTable } from './DataTable';
import { ModelUsage, type Usage } from './ModelUsage';
import { Alert, Kpi, Kpis, Panel } from './ui';

type Report = { roomSid: string; jobId: string; reportedAt: number; expiresAt: number; sessionAvailable: boolean };
type Data = {
  enabled: boolean; from: number; to: number; bucketMs: number;
  coverage: { totalReports: number; retainedReports: number; usageReports: number; missingUsageReports: number; emptyUsageReports: number; expiredReports: number; omittedUsage: number };
  models: Usage[]; series: { t: number; llmInput: number; llmOutput: number; sttAudio: number; ttsAudio: number }[];
  reports: Report[]; totalContributingReports: number; page: number; pageSize: number;
};
const key = (u: Usage) => JSON.stringify([u.type, u.provider, u.model]);
export function AgentUsage({ name, hours }: { name: string; hours: number }) {
  const me = useMe();
  const admin = can(me.data, 'transcripts');
  const [params, setParams] = useSearchParams();
  const model = params.get('usageModel') ?? '';
  const page = params.get('usagePage') ?? '1';
  const query = new URLSearchParams({ hours: String(hours), page, ...(model ? { model } : {}) });
  const result = useApi<Data>(['agent-usage', name, hours, model, page], `/agent-insights/agents/${encodeURIComponent(name)}/usage?${query}`, { enabled: admin });
  function select(model: string, page: number) {
    setParams(old => {
      const next = new URLSearchParams(old);
      if (model) next.set('usageModel', model); else next.delete('usageModel');
      if (page > 1) next.set('usagePage', String(page)); else next.delete('usagePage');
      return next;
    });
  }
  if (me.isLoading) return <Alert>Checking access…</Alert>;
  if (!admin) return <Alert>Agent usage analytics requires transcripts access.</Alert>;
  if (result.error) return <Alert kind="bad">{(result.error as Error).message}</Alert>;
  if (!result.data) return <Alert>Loading model usage…</Alert>;
  const data = result.data, c = data.coverage;
  const models = model ? data.models.filter(u => key(u) === model) : data.models;
  const speech = [
    ...(models.some(m => m.type === 'stt_usage') ? [{ key: 'sttAudio', label: 'STT audio seconds', color: PALETTE.purple }] : []),
    ...(models.some(m => m.type === 'tts_usage') ? [{ key: 'ttsAudio', label: 'TTS audio seconds', color: PALETTE.orange }] : []),
  ];
  return <>
    <Alert>Usage is grouped by final report time in the selected header range. It covers retained instrumented reports, not every call. Cached and modality tokens are already included in their parent totals.</Alert>
    {!data.enabled && <Alert kind="warn">New report collection is disabled. Retained historical usage is shown until its expiration.</Alert>}
    <Kpis>
      <Kpi label="Reports with model usage" value={c.usageReports} />
      <Kpi label="Reports in range" value={c.totalReports} />
      <Kpi label="Usage not reported" value={c.missingUsageReports} />
      <Kpi label="Expired reports" value={c.expiredReports} />
    </Kpis>
    {(c.missingUsageReports > 0 || c.expiredReports > 0 || c.omittedUsage > 0) && <Alert kind="warn">Coverage is incomplete: {c.missingUsageReports} reports have no usage data, {c.expiredReports} have expired and {c.omittedUsage} unsupported usage entries were excluded. These gaps are not counted as zero consumption.</Alert>}
    {c.emptyUsageReports > 0 && <p className="muted">{c.emptyUsageReports} reports contain no supported model rows.</p>}
    <Panel title="Usage filter">
      <div style={{ padding: '12px 14px' }}><label>Model <select aria-label="Usage model" className="select" value={model} onChange={e => select(e.target.value, 1)}>
        <option value="">All models</option>
        {model && !data.models.some(m => key(m) === model) && <option value={model}>Selected model has no retained usage</option>}
        {data.models.map(m => <option key={key(m)} value={key(m)}>{m.type.replace('_usage', '').toUpperCase()} · {m.provider || 'Unknown provider'} · {m.model || 'Unknown model'}</option>)}
      </select></label></div>
    </Panel>
    {!models.length ? <Alert>No retained model usage matches this agent, range and model. Reports from older integrations cannot be backfilled.</Alert> : <>
      {models.some(m => m.type === 'llm_usage') && <Panel title="LLM tokens by report time"><BarsChart data={data.series} series={[{ key: 'llmInput', label: 'Input tokens (includes cached)', color: PALETTE.cyan }, { key: 'llmOutput', label: 'Output tokens', color: PALETTE.purple }]} from={data.from} to={data.to} bucketMs={data.bucketMs} /></Panel>}
      {speech.length > 0 && <Panel title="Speech audio seconds by report time"><AreaChart data={data.series} series={speech} from={data.from} to={data.to} bucketMs={data.bucketMs} fill="none" /></Panel>}
      <ModelUsage usage={models} scope="agent" />
    </>}
    <Panel title={`Contributing reports (${data.totalContributingReports})`}>
      <DataTable rows={data.reports} search={false} pageSize={false} rowKey={r => `${r.roomSid}/${r.jobId}`} empty={{ title: 'No contributing reports' }} cols={[
        { key: 'session', header: 'Session report', wrap: true, cell: r => r.sessionAvailable
          ? <Link className="rowlink mono" to={`/sessions/${encodeURIComponent(r.roomSid)}?tab=insights&reportJob=${encodeURIComponent(r.jobId)}`}>{r.roomSid} · {r.jobId}</Link>
          : <span className="muted">{r.roomSid} · {r.jobId} · Awaiting session history</span> },
        { key: 'reportedAt', header: 'Report time', cell: r => fromMs(r.reportedAt) },
        { key: 'expiresAt', header: 'Expires', cell: r => fromMs(r.expiresAt) },
      ]} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: 12 }}>
        <button className="btn secondary sm" disabled={data.page <= 1} onClick={() => select(model, data.page - 1)}>Previous reports</button>
        <span className="muted">Page {data.page} of {Math.max(1, Math.ceil(data.totalContributingReports / data.pageSize))}</span>
        <button className="btn secondary sm" disabled={data.page * data.pageSize >= data.totalContributingReports} onClick={() => select(model, data.page + 1)}>Next reports</button>
      </div>
    </Panel>
  </>;
}
