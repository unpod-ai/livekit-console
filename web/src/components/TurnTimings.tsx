import { latencySummary } from '../lib/format';
import { metricSamples, nearestRank, type MetricItem } from './session-metric';
import type { Usage } from './ModelUsage';

const timings = [
  { key: 'e2e_latency', label: 'Response', help: 'Reported end-to-end response latency.' },
  { key: 'llm_node_ttft', label: 'LLM TTFT', help: 'LLM time to first token.' },
  { key: 'tts_node_ttfb', label: 'TTS TTFB', help: 'TTS time to first audio byte.' },
  { key: 'transcription_delay', label: 'STT delay', help: 'Reported transcription delay after speech; not STT processing duration.' },
  { key: 'end_of_turn_delay', label: 'End of turn', help: 'Reported end-of-turn detection delay.' },
  { key: 'on_user_turn_completed_delay', label: 'Turn callback', help: 'Reported user-turn-completed callback delay.' },
];
export function turnTimings(metrics?: Record<string, number>) {
  return timings.flatMap(timing => {
    const value = metrics?.[timing.key];
    return value != null && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 1000
      ? [{ ...timing, valueMs: value * 1000 }] : [];
  });
}
export function TurnTimings({ metrics, role, onSelect }: { metrics?: Record<string, number>; role?: string; onSelect?: (metric: string) => void }) {
  if (role !== 'assistant' && role !== 'user') return null;
  const reported = turnTimings(metrics).filter(t => role === 'assistant' || t.key === 'transcription_delay' || t.key === 'end_of_turn_delay' || t.key === 'on_user_turn_completed_delay');
  if (!reported.length && role !== 'assistant') return null;
  const missing = ['llm_node_ttft', 'tts_node_ttfb', 'transcription_delay'].filter(key => !reported.some(t => t.key === key));
  return <div className="turn-timings" aria-label="Reported turn timings">
    {reported.map(t => onSelect
      ? <button key={t.key} className="turn-timing" title={t.help + ' Open this measured turn.'} aria-label={`${t.label}: ${latencySummary(t.valueMs)}`} onClick={() => onSelect(t.key)}><span>{t.label}</span><strong>{latencySummary(t.valueMs)}</strong></button>
      : <span key={t.key} className="turn-timing" title={t.help}><span>{t.label}</span><strong>{latencySummary(t.valueMs)}</strong></span>)}
    {role === 'assistant' && missing.map(key => <span key={key} className="turn-timing missing" title={timings.find(t => t.key === key)!.help + ' No value submitted for this message.'}><span>{timings.find(t => t.key === key)!.label}</span><span>Not reported</span></span>)}
  </div>;
}
export function SessionTimingSummary({ items, usage, onSelect }: { items: MetricItem[]; usage?: Usage[] | null; onSelect: (metric: string) => void }) {
  const summaries = timings.slice(0, 4).flatMap(t => {
    const samples = metricSamples(items, t.key);
    return samples.length ? [{ ...t, count: samples.length, value: nearestRank(samples.map(s => s.valueMs), .5) }] : [];
  });
  if (!summaries.length && !usage?.length) return null;
  const labels: Record<string, string> = { llm_usage: 'LLM', stt_usage: 'STT', tts_usage: 'TTS', eot_usage: 'End of turn', interruption_usage: 'Interruption' };
  return <section className="insights-summary" aria-label="Session timing summary">
    {!!summaries.length && <div className="insights-summary-values">{summaries.map(t => <button key={t.key} onClick={() => onSelect(t.key)} title={`${t.help} p50 across ${t.count} reported message measurements; open metrics.`}><span>{t.label} <small>p50</small></span><strong>{latencySummary(t.value)}</strong><small>{t.count} {t.count === 1 ? 'sample' : 'samples'}</small></button>)}</div>}
    <details className="insights-models"><summary>Models & timing coverage</summary><p>Timings below come from each message in the selected final report. Missing measurements are not estimated. Separate stage timings are not added together.</p>
      {usage?.length ? <><ul>{usage.map((m, i) => <li key={i}><span>{labels[m.type] ?? m.type.replace(/_/g, ' ')}</span><strong>{m.model}</strong><small>{m.provider}</small></li>)}</ul><p>Models are reported for this job as a whole; the report does not attribute a model to each turn.</p></> : <p>Model identities were not reported for this job.</p>}
    </details>
  </section>;
}
