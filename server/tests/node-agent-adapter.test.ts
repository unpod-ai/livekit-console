import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
// Example is plain JavaScript so workers can copy it without a console dependency.
// @ts-ignore external example has no declaration file
import { SessionTelemetry, reportEnvelope, usageRows } from '../../examples/agent_live_telemetry.mjs';
const ctx = { job: { id: 'AJ_node', room: { sid: 'RM_node' } } };
test('Node collector preserves retry bodies and exposes overflow as incomplete', async () => {
  const bodies: string[] = [];
  const c = new SessionTelemetry(ctx, 'test', { background: false, capacity: 1, send: async (_: string, body: string) => { bodies.push(body); return bodies.length > 1; } });
  c.emit('state', { id: 'one', state: 'thinking' }); c.emit('state', { id: 'two', state: 'speaking' });
  assert.equal(await c.flush(), false); assert.equal(await c.flush(), true); assert.equal(bodies[0], bodies[1]);
  assert.equal(await c.close(), false); const terminal = JSON.parse(bodies.at(-1)!).entries[0];
  assert.equal(terminal.state, 'incomplete'); assert.equal(terminal.expectedCount, 2); assert.equal(terminal.droppedCount, 1);
});
test('Node SDK event projection excludes tool data, preserves interruption and converts milliseconds', async () => {
  const batches: any[] = [], session = new EventEmitter();
  const c = new SessionTelemetry(ctx, 'test', { background: false, send: async (_: string, body: string) => { batches.push(JSON.parse(body)); return true; } });
  c.attach(session, { mode: 'realtime' });
  session.emit('conversation_item_added', { item: { id: 'item', type: 'message', role: 'assistant', content: ['Hello', { image: 'private' }], createdAt: 1000, interrupted: true, metrics: { llmNodeTtft: .2 } } });
  session.emit('function_tools_executed', { createdAt: 2000, functionCalls: [{ name: 'lookup', callId: 'call1', arguments: 'private' }], functionCallOutputs: [{ callId: 'call1', isError: true, output: 'private' }] });
  await c.close(); const entries = batches.flatMap(b => b.entries);
  assert.equal(JSON.stringify(entries).includes('private'), false);
  const message = entries.find(e => e.kind === 'message'); assert.equal(message.at, 1); assert.equal(message.interrupted, true); assert.equal(message.metrics.llm_node_ttft, .2);
  assert.equal(entries.find(e => e.kind === 'tool').isError, true); assert.equal(session.listenerCount('conversation_item_added'), 0);
  assert.equal(batches.at(-1).mode, 'realtime');
});
test('Node final report and usage adapter convert native timing units without copying options', () => {
  assert.equal(usageRows([{ type: 'tts_usage', audioDurationMs: 3500 }])[0].audio_duration, 3.5);
  const body = reportEnvelope({ roomId: 'RM_node', jobId: 'AJ_node', timestamp: 1000, chatHistory: { items: [] }, options: { apiKey: 'private' }, modelUsage: [] }, 'test', '1.9.3');
  assert.equal(body.report.timestamp, 1); assert.equal(JSON.stringify(body).includes('private'), false);
});

test('Node reports distinguish unreported usage from a measured empty collection', () => {
  const base = { roomId: 'RM_node', jobId: 'AJ_node', timestamp: 1000, chatHistory: { items: [] } };
  assert.equal(reportEnvelope(base, 'test', '1.9.3').report.usage, null);
  assert.deepEqual(reportEnvelope({ ...base, modelUsage: [] }, 'test', '1.9.3').report.usage, []);
});
