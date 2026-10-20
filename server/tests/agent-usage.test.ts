import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateAgentUsage, type UsageReport } from '../src/agent-usage.js';
import { ReportValidationError } from '../src/report-validation.js';

const report = (n: number): UsageReport => ({ roomSid: `RM_${n}`, jobId: `AJ_${n}`, reportedAt: 1700000000000 - n,
  expiresAt: 1800000000000, retained: true, sessionAvailable: n % 2 === 0, omittedUsage: 0,
  usage: [{ type: 'llm_usage', provider: 'provider', model: 'model', metrics: { input_tokens: 10, output_tokens: 4 } }],
});

test('report pagination never changes totals or chart contributions', () => {
  const rows = Array.from({ length: 31 }, (_, n) => report(n));
  const first = aggregateAgentUsage(rows, 1699996400000, 1700000000001, null, 1);
  const second = aggregateAgentUsage(rows, 1699996400000, 1700000000001, null, 2);
  assert.equal(first.reports.length, 25); assert.equal(second.reports.length, 6);
  assert.equal(first.totalContributingReports, 31);
  assert.equal(second.models[0].metrics.input_tokens, 310);
  assert.deepEqual(first.models, second.models); assert.deepEqual(first.series, second.series);
  assert.equal(new Set([...first.reports, ...second.reports].map(r => r.jobId)).size, 31);
  assert.equal(aggregateAgentUsage(rows, 0, 1, null, 100).page, 2);
});

test('absent, empty, expired and zero-valued reports remain distinct', () => {
  const zero = report(0); zero.usage![0].metrics = { input_tokens: 0, output_tokens: 0 };
  const empty = { ...report(1), usage: [] };
  const missing = { ...report(2), usage: null };
  const expired = { ...report(3), retained: false };
  const data = aggregateAgentUsage([zero, empty, missing, expired], 0, 1, null, 1);
  assert.equal(data.coverage.usageReports, 1);
  assert.equal(data.coverage.emptyUsageReports, 1); assert.equal(data.coverage.missingUsageReports, 1);
  assert.equal(data.coverage.expiredReports, 1);
  assert.equal(data.totalContributingReports, 1); assert.equal(data.models[0].metrics.input_tokens, 0);
  const noMatch = aggregateAgentUsage([zero], 0, 1, ['llm_usage', 'provider', 'other-model'], 1);
  assert.equal(noMatch.totalContributingReports, 0); assert.deepEqual(noMatch.series, []);
});

test('aggregate precision loss is rejected rather than showing rounded usage totals', () => {
  const huge = report(1); huge.usage![0].metrics.input_tokens = Number.MAX_SAFE_INTEGER;
  assert.throws(() => aggregateAgentUsage([huge, report(2)], 0, 1, null, 1), ReportValidationError);
});
