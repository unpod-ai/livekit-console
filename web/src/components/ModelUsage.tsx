import { DataTable, type Col } from './DataTable';
import { Alert, Empty, Panel } from './ui';
import './metrics.css';

export type Usage = { type: string; provider: string; model: string; metrics: Record<string, number> };
const stages: Record<string, string> = { llm_usage: 'LLM tokens', tts_usage: 'Speech synthesis (TTS)', stt_usage: 'Speech recognition (STT)', interruption_usage: 'Interruption', eot_usage: 'End of turn' };
const number = (n: number | undefined) => n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const label = (key: string) => key.replace(/_/g, ' ').replace('duration', 'duration (seconds)');
const primary: Record<string, string[]> = {
  llm_usage: ['input_tokens', 'output_tokens', 'input_cached_tokens'],
  stt_usage: ['audio_duration', 'input_tokens', 'output_tokens'],
  tts_usage: ['audio_duration', 'characters_count', 'input_tokens', 'output_tokens'],
  interruption_usage: ['total_requests'], eot_usage: ['total_requests'],
};
const headers: Record<string, string> = { input_tokens: 'Input tokens', output_tokens: 'Output tokens', input_cached_tokens: 'Cached input tokens', audio_duration: 'Audio seconds', characters_count: 'Characters', total_requests: 'Requests' };
export function ModelUsage({ usage, omitted = 0, scope = 'report', title = 'Model usage' }: { usage?: Usage[] | null; omitted?: number; scope?: 'report' | 'agent' | 'server'; title?: string }) {
  return <Panel title={title}>
    {usage == null ? <Alert>Model usage was not reported. Use the version-2 upload helper with an SDK session that collects model usage; older reports cannot be backfilled.</Alert> : <>
      <details className="metrics-help metrics-body"><summary>About usage counters</summary><p>Model totals for {scope === 'server' ? 'retained reports for the selected agents and time range' : scope === 'agent' ? 'retained reports in this agent and time range' : 'this final report'}. Cached and audio/text/image token counts are subsets of the input/output totals; they are not added again. Audio seconds describe the individual speech stage, not call duration. Usage counters are not provider charges.</p></details>
      {!usage.length && <Empty title={scope === 'report' ? 'No supported model usage entries in this report' : 'No retained model usage for this selection'} />}
      {[...new Set(usage.map(row => row.type))].sort((a,b) => (Object.keys(stages).indexOf(a)) - (Object.keys(stages).indexOf(b))).map(type => {
        const rows = usage.filter(row => row.type === type);
        const counters = (primary[type] ?? []).filter(key => rows.some(row => row.metrics[key] != null && (['audio_duration', 'characters_count'].includes(key) || type === 'llm_usage' && ['input_tokens', 'output_tokens'].includes(key) || row.metrics[key] > 0)));
        const cols: Col<Usage>[] = [
          { key: 'provider', header: 'Provider / model', wrap: true, text: r => `${r.provider} ${r.model}`, cell: r => <span style={{ overflowWrap: 'anywhere' }}>{r.provider || 'Unknown provider'}<br /><span className="muted">{r.model || 'Unknown model'}</span></span> },
          ...counters.map(key => ({ key, header: headers[key], cell: (r: Usage) => number(r.metrics[key]) })),
          ...(rows.some(r => Object.entries(r.metrics).some(([key, value]) => !counters.includes(key) && value !== 0)) ? [{ key: 'details', header: 'Counter details', wrap: true, cell: (r: Usage) => {
            const details = Object.entries(r.metrics).filter(([key, value]) => !counters.includes(key) && value !== 0);
            return details.length ? <details><summary>Additional counters</summary>{details.map(([key, n]) => <div key={key}>{label(key)}: {number(n)}</div>)}</details> : '—';
          } }] : []),
        ];
        return <section className="metrics-group" key={type} aria-label={stages[type] ?? type}><h3>{stages[type] ?? type}</h3><DataTable rows={rows} cols={cols} rowKey={r => JSON.stringify([r.type, r.provider, r.model])} search={false} pageSize={rows.length > 25 ? 25 : false} /></section>;
      })}
    </>}
    {omitted > 0 && <Alert kind="warn">{omitted} unsupported usage entries were excluded. The displayed usage is incomplete.</Alert>}
  </Panel>;
}
