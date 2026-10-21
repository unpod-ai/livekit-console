export const SESSION_METRICS: Record<string, string> = {
  e2e_latency: 'Response latency', llm_node_ttft: 'LLM first token', tts_node_ttfb: 'TTS first audio',
  transcription_delay: 'Transcription delay', end_of_turn_delay: 'End-of-turn delay', on_user_turn_completed_delay: 'Turn callback delay',
};
export type MetricItem = { id: string; type: string; role?: string; at: number | null; metrics?: Record<string, number>; turnId?: string | null; traceId?: string | null; interrupted?: boolean; isError?: boolean };
export function metricSamples(items: MetricItem[], metric: string) {
  return items.flatMap((item, index) => {
    const value = item.metrics?.[metric];
    return item.type === 'message' && (item.role === 'assistant' || item.role === 'user' && ['transcription_delay', 'end_of_turn_delay', 'on_user_turn_completed_delay'].includes(metric)) && value != null && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 1000
      ? [{ item, index, valueMs: value * 1000 }] : [];
  });
}
export function nearestRank(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
}
export function metricBins(values: number[]) {
  if (!values.length) return [];
  const min = Math.min(...values), max = Math.max(...values), count = min === max ? 1 : 5;
  const step = (max - min) / count;
  return Array.from({ length: count }, (_, index) => {
    const from = min + step * index, to = index === count - 1 ? max : min + step * (index + 1);
    return { from, to, values: values.filter(v => v >= from && (index === count - 1 ? v <= to : v < to)) };
  });
}
