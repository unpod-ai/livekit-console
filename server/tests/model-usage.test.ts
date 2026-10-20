import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReport, ReportValidationError } from '../src/agent-report.js';

const request = (usage: unknown, schemaVersion = 2) => ({
  schemaVersion, agentName: 'example', report: {
    room_id: 'RM_example', job_id: 'AJ_example', timestamp: 1000,
    chat_history: { items: [] }, usage,
  },
});
const content = (usage: unknown) => normalizeReport(request(usage)).content;

test('v1 normalization stays byte-for-byte compatible and ignores new SDK usage', () => {
  assert.equal(JSON.stringify(normalizeReport(request([{ type: 'llm_usage', input_tokens: 7 }], 1))),
    '{"roomSid":"RM_example","jobId":"AJ_example","agentName":"example","participantSid":null,"workerId":null,"sdkVersion":null,"reportedAt":1000000,"content":{"schemaVersion":1,"items":[],"omittedItems":0}}');
});

test('v2 distinguishes absent usage from a reported empty collection', () => {
  assert.equal(content(undefined).usage, null);
  assert.equal(content(null).usage, null);
  assert.deepEqual(content([]).usage, []);
});

test('SDK default-suppressed counters become zero only within a reported known model row', () => {
  const c = content([
    { type: 'llm_usage', provider: 'example', model: 'realtime', input_tokens: 20, input_cached_tokens: 5, input_audio_tokens: 12, output_tokens: 9, session_duration: 1.25, secret: 'discard' },
    { type: 'tts_usage', provider: '', model: '', characters_count: 30, audio_duration: 2.5 },
    { type: 'stt_usage', provider: 'example', model: 'speech' },
    { type: 'interruption_usage', provider: 'example', model: 'detector', total_requests: 2 },
    { type: 'eot_usage', provider: 'example', model: 'turn', total_requests: 3 },
  ]);
  assert.equal(c.schemaVersion, 2);
  assert.equal(c.usage?.length, 5);
  assert.equal(c.usage?.[0].metrics.input_tokens, 20);
  assert.equal(c.usage?.[0].metrics.output_text_tokens, 0);
  assert.equal(c.usage?.[0].metrics.session_duration, 1.25);
  assert.equal(c.usage?.[1].provider, '');
  assert.equal(c.usage?.[2].metrics.audio_duration, 0);
  assert.equal(JSON.stringify(c).includes('discard'), false);
});

test('unsupported usage kinds are counted and excluded without dropping the conversation', () => {
  const c = content([{ type: 'future_usage', secret: 'discard' }]);
  assert.deepEqual(c.usage, []);
  assert.equal(c.omittedUsage, 1);
  assert.equal(JSON.stringify(c).includes('discard'), false);
});

test('malformed counters and unbounded or duplicate rows cannot inflate usage', () => {
  const row = { type: 'llm_usage', provider: 'example', model: 'model' };
  for (const value of [-1, 0.5, Infinity, NaN, '10', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => content([{ ...row, input_tokens: value }]), ReportValidationError);
  }
  for (const usage of [{}, [null], [{ ...row, provider: 1 }], [{ ...row, model: 'x'.repeat(201) }],
    [row, row], Array.from({ length: 201 }, () => row)]) {
    assert.throws(() => content(usage), ReportValidationError);
  }
  assert.throws(() => content([{ ...row, session_duration: -0.1 }]), ReportValidationError);
  for (const key of ['audio_duration', 'session_duration']) {
    const type = key === 'audio_duration' ? 'tts_usage' : 'llm_usage';
    for (const value of [NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => content([{ ...row, type, [key]: value }]), ReportValidationError);
    }
  }
});
