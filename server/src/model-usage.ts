import { ReportValidationError } from './report-validation.js';

const FIELDS: Record<string, readonly string[]> = {
  llm_usage: ['input_tokens', 'input_cached_tokens', 'input_audio_tokens', 'input_cached_audio_tokens', 'input_text_tokens', 'input_cached_text_tokens', 'input_image_tokens', 'input_cached_image_tokens', 'input_cache_creation_tokens', 'output_tokens', 'output_audio_tokens', 'output_text_tokens', 'output_reasoning_tokens', 'session_duration'],
  tts_usage: ['input_tokens', 'output_tokens', 'characters_count', 'audio_duration'],
  stt_usage: ['input_tokens', 'output_tokens', 'input_audio_tokens', 'audio_duration'],
  interruption_usage: ['total_requests'],
  eot_usage: ['total_requests'],
};
export type ModelUsage = { type: string; provider: string; model: string; metrics: Record<string, number> };

export function normalizeUsage(value: unknown): { usage: ModelUsage[] | null; omittedUsage: number } {
  if (value == null) return { usage: null, omittedUsage: 0 };
  if (!Array.isArray(value) || value.length > 200) throw new ReportValidationError('report.usage must be an array of at most 200 entries');
  const usage: ModelUsage[] = [];
  const seen = new Set<string>();
  let omittedUsage = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.type !== 'string') throw new ReportValidationError('usage entry must be an object with a type');
    if (!Object.hasOwn(FIELDS, item.type)) { omittedUsage++; continue; }
    for (const key of ['provider', 'model']) {
      if (typeof item[key] !== 'string' || item[key].length > 200) throw new ReportValidationError(`usage.${key} must be a string of at most 200 characters`);
    }
    const identity = JSON.stringify([item.type, item.provider, item.model]);
    if (seen.has(identity)) throw new ReportValidationError('Duplicate usage type/provider/model entry');
    seen.add(identity);
    const metrics: Record<string, number> = {};
    for (const key of FIELDS[item.type]) {
      // The SDK serializes with exclude_defaults=True: absent counters in a known row are zero.
      const n = Object.hasOwn(item, key) ? item[key] : 0;
      const duration = key === 'audio_duration' || key === 'session_duration';
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER || (!duration && !Number.isSafeInteger(n))) {
        throw new ReportValidationError(`usage.${key} must be a nonnegative ${duration ? 'finite number of seconds' : 'safe integer'}`);
      }
      metrics[key] = n;
    }
    usage.push({ type: item.type, provider: item.provider, model: item.model, metrics });
  }
  return { usage, omittedUsage };
}
