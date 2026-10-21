import { useApi } from '../lib/hooks';
import { can, useMe } from '../lib/me';
import { latencySummary } from '../lib/format';
import { Alert, Empty, Help, Panel } from './ui';
import { DataTable } from './DataTable';
import type { Usage } from './ModelUsage';
type Group = { agentName: string; count: number; p50: number | null; p95: number | null };
type Data = { stages: { metric: string; label: string; groups: Group[] }[]; modelsByAgent: { agentName: string; models: Usage[] }[] };
const stages = ['e2e_latency', 'llm_node_ttft', 'tts_node_ttfb', 'transcription_delay', 'end_of_turn_delay', 'stt_duration', 'llm_duration', 'tts_duration'];
export function AgentLatency({ name, hours, onMetric }: { name: string; hours: number; onMetric: (metric: string) => void }) {
  const me = useMe(), allowed = can(me.data, 'transcripts');
  const query = useApi<Data>(['agent-latency-summary', name, hours], () => {
    const to = Date.now();
    return '/agent-insights/analytics?' + new URLSearchParams({ from: String(to - hours * 3600000), to: String(to), agents: JSON.stringify([name]), metric: 'e2e_latency' });
  }, { enabled: allowed });
  if (!allowed) return null;
  const rows = stages.flatMap(metric => {
    const stage = query.data?.stages?.find(s => s.metric === metric), group = stage?.groups.find(g => g.agentName === name && g.count > 0);
    return stage && group ? [{ ...group, metric, label: stage.label }] : [];
  });
  const models = query.data?.modelsByAgent?.find(a => a.agentName === name)?.models ?? [];
  return <Panel title="Model & response latency" actions={<Help text="Reported turn timings and native node durations, scoped to this source agent name and the header time range. Model names are job-level usage identities, not per-turn timing attribution." />}>
    {query.error ? <Alert kind="bad">{query.error.message}</Alert> : query.isLoading ? <p className="muted panel-body">Loading reported latency…</p> : !rows.length ? <Empty title="No measured latency in this range">Turn timings appear when an instrumented agent reports them. Worker health does not measure model latency.</Empty> : <>
      <DataTable rows={rows} search={false} pageSize={false} rowKey={r => r.metric} cols={[
        { key: 'stage', header: 'Measurement', wrap: true, cell: r => <button className="latency-stage-link" aria-label={`Inspect ${r.label}`} onClick={() => onMetric(r.metric)}>{r.label}</button> },
        { key: 'p50', header: 'p50', cell: r => latencySummary(r.p50) },
        { key: 'p95', header: 'p95', cell: r => latencySummary(r.p95) },
        { key: 'count', header: 'Samples', cell: r => r.count },
      ]} />
      <p className="insights-note">Select a measurement to inspect its trend and contributing turns. Stages have independent sample counts.</p>
    </>}
    {models.length > 0 && <details className="insights-models agent-models"><summary>Reported models in this range</summary><ul>{models.map((m, i) => <li key={i}><span>{({llm_usage:'LLM',tts_usage:'TTS',stt_usage:'STT'} as Record<string,string>)[m.type] ?? m.type.replace(/_/g,' ')}</span><strong>{m.model}</strong><small>{m.provider}</small></li>)}</ul><p>Job-level model identities; timings are not attributed to individual models. Missing STT stages are unavailable. Current source name: {name}.</p></details>}
  </Panel>;
}
