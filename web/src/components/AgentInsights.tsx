import { Link, useSearchParams } from '../lib/router';
import { useMe, can } from '../lib/me';
import { useApi } from '../lib/hooks';
import { fromMs, fromMsPrecise } from '../lib/format';
import { DataTable, type Col } from './DataTable';
import { Alert, Badge, KV, Panel } from './ui';
import { ModelUsage, type Usage } from './ModelUsage';
import { LiveInsights } from './LiveInsights';
import { SessionRecordings } from './SessionRecordings';

type Item = {
  id: string; type: string; at: number | null; role?: string; text?: string; interrupted?: boolean;
  metrics?: Record<string, number>; name?: string | null; callId?: string | null;
  traceId?: string | null; spanId?: string | null; turnId?: string | null;
  isError?: boolean; fromAgent?: string | null; toAgent?: string;
};
type Content = { schemaVersion: number; items: Item[]; omittedItems: number; usage?: Usage[] | null; omittedUsage?: number };
type TranscriptRow = Item & { rowKey: string };
type Report = {
  roomSid: string; jobId: string; agentName: string; participantSid: string | null; workerId: string | null;
  sdkVersion: string | null; reportedAt: number; receivedAt: number; expiresAt: number; state: string;
};
type Reports = { enabled: boolean; retentionDays: number; total: number; reports: Report[]; selected: (Report & { content: Content | null }) | null };
const ms = (value: number | undefined) => value == null ? '—' : `${Math.round(value * 1000)} ms`;

export function AgentInsights({ sid }: { sid: string }) {
  const me = useMe();
  const admin = can(me.data, 'transcripts');
  const [params, setParams] = useSearchParams();
  const jobId = params.get('reportJob') ?? '';
  const setJobId = (job: string) => setParams(old => { const next = new URLSearchParams(old); next.set('reportJob', job); return next; });
  const query = useApi<Reports>(['agent-insights', sid, jobId], `/agent-insights/sessions/${encodeURIComponent(sid)}${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`, { enabled: admin });
  if (me.isLoading) return <Alert>Checking access…</Alert>;
  if (!admin) return <><SessionRecordings sid={sid} /><LiveInsights sid={sid} /><Alert>Transcript access is required to view agent reports.</Alert></>;
  if (query.error) return <Alert kind="bad">{(query.error as Error).message}</Alert>;
  if (!query.data) return <Alert>Loading agent reports…</Alert>;
  const data = query.data;
  const report = data.selected;
  if (!data.reports.length) return <><SessionRecordings sid={sid} /><LiveInsights sid={sid} /><Alert>{data.enabled
    ? 'No agent session report has been received for this room. Reports appear after an instrumented agent session ends.'
    : 'Agent report collection is disabled. An administrator can enable it and configure report uploads following the Agent telemetry setup guide.'}</Alert></>;
  const columns: Col<TranscriptRow>[] = [
    { key: 'at', header: 'Timestamp', cell: (i) => i.at==null?'—':<button aria-label={`Seek to report item ${i.id}`} aria-pressed={params.get('reportItem')===i.id} style={params.get('reportItem')===i.id?{borderColor:'var(--accent)'}:undefined} className="btn secondary sm mono" onClick={()=>setParams(old=>{const next=new URLSearchParams(old);next.set('mediaAt',String(i.at));next.set('reportItem',i.id);if(i.traceId)next.set('liveTrace',i.traceId);if(i.turnId)next.set('liveTurn',i.turnId);next.delete('livePage');return next;})}>{fromMsPrecise(i.at)}</button>, sort: (i) => i.at ?? 0 },
    { key: 'type', header: 'Event', cell: (i) => <div className="badges"><Badge>{i.role ?? i.type.replace(/_/g, ' ')}</Badge>{i.interrupted && <Badge tone="warn">Interrupted</Badge>}{i.isError && <Badge tone="bad">Tool error</Badge>}</div> },
    { key: 'text', header: 'Content', wrap: true, cell: (i) => <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{i.type === 'message' ? i.text || 'No text recorded' : i.type === 'agent_handoff' ? `${i.fromAgent ?? 'Unknown'} → ${i.toAgent}` : `${i.name ?? 'Tool'}${i.callId ? ` · ${i.callId}` : ''}`}</span>, text: (i) => i.text ?? i.name ?? i.toAgent ?? '' },
    { key: 'e2e', header: 'Response latency', cell: (i) => ms(i.metrics?.e2e_latency) },
    { key: 'llm', header: 'LLM first token', cell: (i) => ms(i.metrics?.llm_node_ttft) },
    { key: 'tts', header: 'TTS first audio', cell: (i) => ms(i.metrics?.tts_node_ttfb) },
  ];
  function download() {
    if (!report?.content) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${sid}_${report.jobId}_agent-report.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <SessionRecordings sid={sid} /><LiveInsights sid={sid} />
    <Panel title="Agent session reports">
      <div style={{ padding: '12px 14px' }}><label>Report <select className="select" aria-label="Agent report" value={report?.jobId ?? ''} onChange={(e) => setJobId(e.target.value)}>
        {data.reports.map((r) => <option key={r.jobId} value={r.jobId}>{r.agentName} · {r.jobId} · {r.state}</option>)}
      </select></label></div>
      {data.total > data.reports.length && <p className="muted">Showing the latest {data.reports.length} of {data.total} reports.</p>}
      {report && <KV items={[
        ['Logs', can(me.data, 'logs') ? <Link className="rowlink" to={`/sessions/${encodeURIComponent(sid)}?tab=logs&logJob=${encodeURIComponent(report.jobId)}`}>View this job's logs</Link> : 'Log access is required'],
        ['Agent', report.agentName], ['Job ID', <span className="mono">{report.jobId}</span>], ['SDK', report.sdkVersion ?? 'Not reported'],
        ['Participant SID', report.participantSid ?? 'Not reported'], ['Worker ID', report.workerId ?? 'Not reported'],
        ['Reported', fromMs(report.reportedAt)], ['Received', fromMs(report.receivedAt)], ['Content expires', fromMs(report.expiresAt)],
      ]} />}
    </Panel>
    {report?.state === 'expired' && <Alert>Conversation content for this report has expired. Its identifying metadata is retained; uploading it again does not restore the content.</Alert>}
    {report?.content && <>
      <Alert>This is a post-session report. Timings are reported by the agent SDK and may be unavailable for some models. Structured application logs are available in the Agent logs tab when submitted. Live events and spans appear above when instrumented. Audio and tool arguments/results are excluded.</Alert>
      <ModelUsage usage={report.content.usage} omitted={report.content.omittedUsage} />
      <Panel title="Conversation and tool events" actions={<button className="btn secondary sm" onClick={download}>Download report</button>}>
        <DataTable rows={report.content.items.map((item, index) => ({ ...item, rowKey: String(index) }))} cols={columns} rowKey={(i) => i.rowKey} pageSize={50} empty={{ title: 'No conversation items in this report' }} />
      </Panel>
      {report.content.omittedItems > 0 && <p className="muted">{report.content.omittedItems} system, developer or unsupported items were excluded from collection.</p>}
    </>}
  </>;
}
