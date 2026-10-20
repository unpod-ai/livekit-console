import { DataTable, type Col } from './DataTable';
import { Alert, Panel } from './ui';

export type Usage = { type: string; provider: string; model: string; metrics: Record<string, number> };
const stages: Record<string, string> = { llm_usage: 'LLM', tts_usage: 'TTS', stt_usage: 'STT', interruption_usage: 'Interruption', eot_usage: 'End of turn' };
const number = (n: number | undefined) => n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const label = (key: string) => key.replace(/_/g, ' ').replace('duration', 'duration (seconds)');

export function ModelUsage({ usage, omitted = 0, scope = 'report' }: { usage?: Usage[] | null; omitted?: number; scope?: 'report' | 'agent' }) {
  const cols: Col<Usage>[] = [
    { key: 'type', header: 'Stage', cell: (r) => stages[r.type] ?? r.type },
    { key: 'provider', header: 'Provider / model', wrap: true, text: (r) => `${r.provider} ${r.model}`, cell: (r) => <span style={{ overflowWrap: 'anywhere' }}>{r.provider || 'Unknown provider'}<br /><span className="muted">{r.model || 'Unknown model'}</span></span> },
    { key: 'input', header: 'Input tokens', cell: (r) => number(r.metrics.input_tokens) },
    { key: 'output', header: 'Output tokens', cell: (r) => number(r.metrics.output_tokens) },
    { key: 'cached', header: 'Cached input tokens', cell: (r) => number(r.metrics.input_cached_tokens) },
    { key: 'audio', header: 'Audio seconds', cell: (r) => number(r.metrics.audio_duration) },
    { key: 'characters', header: 'Characters', cell: (r) => number(r.metrics.characters_count) },
    { key: 'requests', header: 'Requests', cell: (r) => number(r.metrics.total_requests) },
    { key: 'details', header: 'Breakdown', wrap: true, cell: (r) => <details><summary>All counters</summary>{Object.entries(r.metrics).map(([key, n]) => <div key={key}>{label(key)}: {number(n)}</div>)}</details> },
  ];
  return <Panel title="Model usage">
    {usage == null ? <Alert>Model usage was not reported. Use the version-2 upload helper with an SDK session that collects model usage; older reports cannot be backfilled.</Alert> : <>
      <div style={{ padding: '12px 14px' }} className="muted">Model totals for {scope === 'agent' ? 'retained reports in this agent and time range' : 'this final report'}. Cached and audio/text/image token counts are subsets of the input/output totals; they are not added again. Audio seconds describe the individual speech stage, not call duration. Usage counters are not provider charges.</div>
      <DataTable rows={usage} cols={cols} rowKey={(r) => JSON.stringify([r.type, r.provider, r.model])} pageSize={25} empty={{ title: 'No supported model usage entries in this report' }} />
    </>}
    {omitted > 0 && <Alert kind="warn">{omitted} unsupported usage entries were excluded. The displayed usage is incomplete.</Alert>}
  </Panel>;
}
