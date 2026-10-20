import type { ModelUsage } from './model-usage.js';
import { ReportValidationError } from './report-validation.js';

export type UsageReport = { roomSid: string; jobId: string; reportedAt: number; expiresAt: number;
  sessionAvailable: boolean; retained: boolean; usage: ModelUsage[] | null; omittedUsage: number };
export type ModelKey = [string, string, string];
const matches = (u: ModelUsage, key: ModelKey | null) => !key || (u.type === key[0] && u.provider === key[1] && u.model === key[2]);
const identity = (u: ModelUsage) => JSON.stringify([u.type, u.provider, u.model]);
function add(a: number, b: number, integer = true): number {
  const sum = a + b;
  if (!Number.isFinite(sum) || sum > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(sum))) throw new ReportValidationError('Usage totals exceed the supported numeric range');
  return sum;
}

export function aggregateAgentUsage(rows: Iterable<UsageReport>, from: number, to: number, model: ModelKey | null, page: number) {
  const bucketMs = to - from <= 48 * 3600000 ? 3600000 : 86400000;
  const coverage = { totalReports: 0, retainedReports: 0, usageReports: 0, missingUsageReports: 0, emptyUsageReports: 0, expiredReports: 0, omittedUsage: 0 };
  const models = new Map<string, ModelUsage>();
  const buckets = new Map<number, { t: number; llmInput: number; llmOutput: number; sttAudio: number; ttsAudio: number }>();
  const reports: Omit<UsageReport, 'usage' | 'omittedUsage' | 'retained'>[] = [];
  for (const row of rows) {
    coverage.totalReports++;
    if (!row.retained) { coverage.expiredReports++; continue; }
    coverage.retainedReports++;
    coverage.omittedUsage += row.omittedUsage;
    if (row.usage == null) { coverage.missingUsageReports++; continue; }
    if (!row.usage.length) { coverage.emptyUsageReports++; continue; }
    coverage.usageReports++;
    let contributes = false;
    for (const u of row.usage) {
      const key = identity(u);
      if (!models.has(key)) models.set(key, { type: u.type, provider: u.provider, model: u.model, metrics: {} });
      const metrics = models.get(key)!.metrics;
      for (const [k, n] of Object.entries(u.metrics)) metrics[k] = add(metrics[k] ?? 0, n, !k.endsWith('_duration'));
      if (!matches(u, model)) continue;
      contributes = true;
      const t = Math.floor(row.reportedAt / bucketMs) * bucketMs;
      if (!buckets.has(t)) buckets.set(t, { t, llmInput: 0, llmOutput: 0, sttAudio: 0, ttsAudio: 0 });
      const b = buckets.get(t)!;
      if (u.type === 'llm_usage') { b.llmInput = add(b.llmInput, u.metrics.input_tokens); b.llmOutput = add(b.llmOutput, u.metrics.output_tokens); }
      if (u.type === 'stt_usage') b.sttAudio = add(b.sttAudio, u.metrics.audio_duration, false);
      if (u.type === 'tts_usage') b.ttsAudio = add(b.ttsAudio, u.metrics.audio_duration, false);
    }
    if (contributes) reports.push({ roomSid: row.roomSid, jobId: row.jobId, reportedAt: row.reportedAt, expiresAt: row.expiresAt, sessionAvailable: row.sessionAvailable });
  }
  const pageSize = 25;
  page = Math.min(page, Math.max(1, Math.ceil(reports.length / pageSize)));
  return { from, to, bucketMs, coverage, models: [...models.values()].sort((a, b) => identity(a).localeCompare(identity(b))),
    series: [...buckets.values()].sort((a, b) => a.t - b.t), totalContributingReports: reports.length,
    reports: reports.slice((page - 1) * pageSize, page * pageSize), page, pageSize };
}
