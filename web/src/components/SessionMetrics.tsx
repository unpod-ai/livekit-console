import { latencySummary } from '../lib/format';
import { useSearchParams } from 'react-router-dom';
import { Alert, Empty, Kpi, Kpis, Panel } from './ui';
import { ModelUsage, type Usage } from './ModelUsage';
import { metricBins, metricSamples, nearestRank, SESSION_METRICS, type MetricItem } from './session-metric';
import './metrics.css';
const fmt = (value: number | null) => value == null ? 'Unavailable' : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ms`;
export function SessionMetrics({ items, usage, omittedUsage }: { items: MetricItem[]; usage?: Usage[] | null; omittedUsage?: number }) {
  const [params, setParams] = useSearchParams();
  const available = Object.keys(SESSION_METRICS).filter(key => metricSamples(items, key).length);
  const requested = params.get('sessionMetric'), metric = requested ?? available[0] ?? 'e2e_latency';
  const samples = metricSamples(items, metric), values = samples.map(s => s.valueMs), bins = metricBins(values);
  const selected = params.get('reportItem'), band = params.get('sessionMetricBand');
  const filtered = band !== null ? samples.filter(s => bins[Number(band)]?.values.includes(s.valueMs)) : samples;
  const selectedIndex = filtered.findIndex(s => s.item.id === selected);
  const pages = Math.max(1, Math.ceil(filtered.length / 50)), requestedPage = Number(params.get('sessionMetricPage') ?? 1);
  const page = selectedIndex >= 0 ? Math.floor(selectedIndex / 50) + 1 : Math.max(1, Math.min(pages, Number.isInteger(requestedPage) ? requestedPage : 1));
  function update(values: Record<string, string | null>) { setParams(old => { const next = new URLSearchParams(old); for (const [key, value] of Object.entries(values)) value === null ? next.delete(key) : next.set(key, value); return next; }); }
  function select(item: MetricItem, clearBand = false) { update({ ...(clearBand ? { sessionMetricBand: null } : {}), reportItem: item.id, mediaAt: item.at === null ? null : String(item.at), liveTurn: item.turnId ?? null, liveTrace: item.traceId ?? null, selectedSpan: null, selectedRecord: null }); }
  return <>
    {!available.length ? <Empty title="No turn timings reported" /> : <>
      <div className="metrics-toolbar"><label>Measurement <select className="select" aria-label="Session metric" value={metric} onChange={e => update({ sessionMetric: e.target.value, sessionMetricBand: null, sessionMetricPage: null })}>
        {requested && !available.includes(requested) && <option value={requested}>Selected measurement unavailable</option>}
        {available.map(key => <option key={key} value={key}>{SESSION_METRICS[key]}</option>)}
      </select></label></div>
      <Kpis><Kpi label={`${SESSION_METRICS[metric] ?? 'Selected measurement'} · p50`} value={latencySummary(nearestRank(values, .5))} foot={`${samples.length} reported measurements`} /><Kpi label="p95" value={latencySummary(nearestRank(values, .95))} /><Kpi label="Measured turns" value={samples.length} /></Kpis>
      <details className="metrics-help"><summary>About session measurements</summary><p>Nearest-rank percentiles use retained message measurements from this final report, including interrupted/error turns. Response, LLM and TTS timings use assistant messages; transcription, end-of-turn and callback delays may be reported on user messages. Seconds are converted to milliseconds. Missing stages are hidden; stage percentiles are independent and are never added. Select a turn to seek the recording using its reported timestamp.</p></details>
      {!samples.length ? <Alert>No retained measurements for this metric.</Alert> : <>
        <Panel title="Turn latency"><div className="metrics-body">
          <div className="metrics-toolbar"><label>Selected turn <select aria-label="Metric turn" className="select" value={samples.some(s => s.item.id === selected) ? selected! : ''} onChange={e => { const sample = samples.find(s => s.item.id === e.target.value); if (sample) select(sample.item, true); }}><option value="">Choose a measured turn</option>{samples.map(s => <option key={s.item.id} value={s.item.id}>Turn {s.index + 1} · {fmt(s.valueMs)}</option>)}</select></label>{band !== null && <button className="btn secondary sm" onClick={() => update({ sessionMetricBand: null })}>Clear distribution selection</button>}</div>
          <div className="metrics-chart" role="group" aria-label="Turn latency chart">{!filtered.length && <p className="muted">No measured turns in this distribution interval.</p>}{filtered.slice((page - 1) * 50, page * 50).map(s => <button key={s.item.id} className="metrics-bar" aria-label={`Select turn ${s.item.id}: ${fmt(s.valueMs)}`} aria-pressed={selected === s.item.id} onClick={() => select(s.item)}><span className="metrics-bar-label">Turn {s.index + 1}{s.item.interrupted ? ' · Interrupted' : ''}{s.item.isError ? ' · Error' : ''}</span><span className="metrics-bar-track"><span className="metrics-bar-fill" style={{ width: `${s.valueMs / Math.max(1, ...values) * 100}%` }} /></span><span>{fmt(s.valueMs)}</span></button>)}</div>
          {pages > 1 && <div className="metrics-toolbar"><button className="btn secondary sm" disabled={page <= 1} onClick={() => update({ reportItem: null, sessionMetricPage: String(page - 1) })}>Previous measured turns</button><span>Page {page} of {pages}</span><button className="btn secondary sm" disabled={page >= pages} onClick={() => update({ reportItem: null, sessionMetricPage: String(page + 1) })}>Next measured turns</button></div>}
          {selected && !samples.some(s => s.item.id === selected) && <Alert>The selected turn has no measurement for this metric.</Alert>}
        </div></Panel>
        <Panel title="Latency distribution"><div className="metrics-body metrics-chart" role="group" aria-label="Latency distribution chart">{bins.map((bin, index) => <button key={index} className="metrics-bar" aria-label={`Inspect distribution ${index + 1}: ${bin.values.length} turns, ${fmt(bin.from)} to ${fmt(bin.to)}`} aria-pressed={band === String(index)} onClick={() => update({ sessionMetricBand: String(index), sessionMetricPage: null })}><span>{fmt(bin.from)} – {fmt(bin.to)}{index < bins.length - 1 ? ' (exclusive)' : ''}</span><span className="metrics-bar-track"><span className="metrics-bar-fill" style={{ width: `${bin.values.length / samples.length * 100}%` }} /></span><span>{bin.values.length} turns</span></button>)}</div></Panel>
      </>}
    </>}
    <ModelUsage usage={usage} omitted={omittedUsage} />
  </>;
}
