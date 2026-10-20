import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';

const dir = mkdtempSync(path.join(tmpdir(), 'lkc-telemetry-'));
Object.assign(process.env, {
  DB_PATH: path.join(dir, 'test.db'), LIVEKIT_URL: 'ws://127.0.0.1:1', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test',
  ADMIN_USER: 'admin', ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'test-session-secret',
  AGENT_TELEMETRY_TOKEN: 'test-service-token-with-at-least-32-characters',
  AGENT_LOGS_ENABLED: 'true',
  AGENT_TELEMETRY_EVENTS_ENABLED: 'true',
});
const { telemetryIngest, agentInsights } = await import('../src/telemetry.js');
const { login, requireAuth, requireAdmin, hashPassword } = await import('../src/auth.js');
const { db } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const app = express();
app.use('/api/telemetry', telemetryIngest);
app.use(express.json(), cookieParser());
app.post('/api/auth/login', login);
app.use('/api/agent-insights', requireAuth, requireAdmin, agentInsights);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); rmSync(dir, { recursive: true, force: true }); });
const token = process.env.AGENT_TELEMETRY_TOKEN!;
const envelope = (job = 'AJ_test') => ({
  schemaVersion: 1, agentName: 'test-agent', participantSid: 'PA_agent', workerId: 'AW_worker',
  report: { room_id: 'RM_report', room: 'test-room', job_id: job, sdk_version: '1.5.8', timestamp: Date.now() / 1000,
    options: { secret: 'do-not-store' }, events: [{ secret: 'do-not-store' }], chat_history: { items: [
      { type: 'message', id: 'system', role: 'system', content: ['hidden instructions'], created_at: 1000 },
      { type: 'message', id: 'u', role: 'user', content: ['Hello'], created_at: 1001 },
      { type: 'function_call', id: 'f', name: 'lookup', call_id: 'c', arguments: 'do-not-store', created_at: 1002 },
      { type: 'function_call_output', id: 'o', name: 'lookup', call_id: 'c', output: 'do-not-store', is_error: true, created_at: 1003 },
      { type: 'agent_handoff', id: 'h', old_agent_id: 'one', new_agent_id: 'two', created_at: 1004 },
      { type: 'message', id: 'a', role: 'assistant', content: ['Welcome', { type: 'image_content', image: 'do-not-store' }], interrupted: true, created_at: 1005, metrics: { llm_node_ttft: 0.2, e2e_latency: 0, secret: 'do-not-store' } },
    ] } },
});
const upload = (body: unknown, auth: string | null = token) => fetch(base + '/api/telemetry/session-reports', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body),
});
async function cookie(username = 'admin') {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'test-password' }) });
  assert.equal(r.status, 200); return r.headers.get('set-cookie')!.split(';')[0];
}

test('uploads require a dedicated service token, including when a browser is signed in', async () => {
  assert.equal((await upload(envelope(), null)).status, 401);
  assert.equal((await upload(envelope(), 'wrong')).status, 401);
  const r = await fetch(base + '/api/telemetry/session-reports', { method: 'POST', headers: { 'content-type': 'application/json', cookie: await cookie() }, body: JSON.stringify(envelope()) });
  assert.equal(r.status, 401);
});

test('a final report arriving before room webhooks is readable by admins with only allowlisted content', async () => {
  assert.equal((await upload(envelope())).status, 201);
  const r = await fetch(base + '/api/agent-insights/sessions/RM_report', { headers: { cookie: await cookie() } });
  assert.equal(r.status, 200); const data = await r.json();
  assert.equal(data.reports.length, 1); assert.equal(data.selected.content.items.length, 5);
  assert.equal(data.selected.content.items[4].metrics.e2e_latency, 0);
  assert.equal(data.selected.content.items[4].at, 1005000);
  assert.equal(JSON.stringify(data).includes('do-not-store'), false);
  assert.equal(JSON.stringify(data).includes('hidden instructions'), false);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM agent_session_reports').all()).includes('do-not-store'), false);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE room_sid='RM_report'").get()!.n, 0);
  db.prepare('INSERT INTO sessions(room_sid,room_name,started_at) VALUES (?,?,?)').run('RM_report', 'test-room', Date.now());
  assert.equal((await (await fetch(base + '/api/agent-insights/sessions/RM_report', { headers: { cookie: await cookie() } })).json()).reports.length, 1);
});

test('normalized retries are idempotent; changed content for the same job is a conflict', async () => {
  const e = envelope('AJ_retry'); assert.equal((await upload(e)).status, 201);
  const row = db.prepare("SELECT received_at,expires_at FROM agent_session_reports WHERE job_id='AJ_retry'").get();
  assert.equal((await upload(e)).status, 200);
  e.report.options.secret = 'a-different-excluded-value'; assert.equal((await upload(e)).status, 200);
  assert.equal((await upload({ ...e, report: { ...e.report, usage: [{ type: 'llm_usage', input_tokens: 100 }] } })).status, 200);
  assert.equal((await upload({ ...e, schemaVersion: 2 })).status, 409);
  assert.deepEqual(db.prepare("SELECT received_at,expires_at FROM agent_session_reports WHERE job_id='AJ_retry'").get(), row);
  e.report.chat_history.items[1].content = ['Changed']; assert.equal((await upload(e)).status, 409);
});

test('invalid versions, missing room correlation, malformed JSON and oversized bodies are rejected', async () => {
  const e = envelope('AJ_invalid'); assert.equal((await upload({ ...e, schemaVersion: 3 })).status, 422);
  assert.equal((await upload({ ...e, report: { ...e.report, room_id: '' } })).status, 422);
  assert.equal((await upload({ ...e, report: { ...e.report, chat_history: {} } })).status, 422);
  assert.equal((await upload({ ...e, report: { ...e.report, timestamp: 'not-a-time' } })).status, 422);
  assert.equal((await upload({ ...e, report: { ...e.report, chat_history: { items: [{ type: { toString: null } }] } } })).status, 422);
  const headers = { 'content-type': 'application/json', Authorization: `Bearer ${token}` };
  assert.equal((await fetch(base + '/api/telemetry/session-reports', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/api/telemetry/session-reports', { method: 'POST', headers, body: JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }) })).status, 413);
});

test('multiple jobs and rooms remain isolated when selecting a report', async () => {
  const e = envelope('AJ_other'); e.report.room_id = 'RM_other';
  e.report.chat_history.items[1].content = ['Only in the other room'];
  assert.equal((await upload(e)).status, 201);
  const r = await fetch(base + '/api/agent-insights/sessions/RM_report?jobId=AJ_other', { headers: { cookie: await cookie() } });
  const data = await r.json(); assert.equal(data.selected, null);
  assert.equal(JSON.stringify(data).includes('Only in the other room'), false);
});

test('anonymous users and viewers cannot read report text, even with a valid service token', async () => {
  const url = base + '/api/agent-insights/sessions/RM_report';
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,?,?)').run('reader', hashPassword('test-password'), 'viewer', Date.now());
  const r = await fetch(url, { headers: { cookie: await cookie('reader') } }); assert.equal(r.status, 403); assert.equal((await r.text()).includes('Hello'), false);
});

test('expired content is never returned and retry cannot resurrect it', async () => {
  const e = envelope('AJ_expired'); assert.equal((await upload(e)).status, 201);
  db.prepare("UPDATE agent_session_reports SET expires_at=0 WHERE job_id='AJ_expired'").run();
  const r = await fetch(base + '/api/agent-insights/sessions/RM_report?jobId=AJ_expired', { headers: { cookie: await cookie() } });
  const report = (await r.json()).selected;
  assert.equal(report.state, 'expired'); assert.equal(report.content, null);
  assert.equal((await upload(e)).status, 200);
  assert.equal(db.prepare("SELECT content FROM agent_session_reports WHERE job_id='AJ_expired'").get()!.content, null);
});

test('v2 usage is retained once, read only by admins and removed with report content on expiry', async () => {
  const e = { ...envelope('AJ_usage'), schemaVersion: 2, report: { ...envelope('AJ_usage').report,
    usage: [{ type: 'llm_usage', provider: 'example', model: 'model', input_tokens: 20, input_cached_tokens: 5, output_tokens: 9, secret: 'do-not-store' }] } };
  assert.equal((await upload(e)).status, 201);
  assert.equal((await upload(e)).status, 200);
  const url = base + '/api/agent-insights/sessions/RM_report?jobId=AJ_usage';
  const read = () => fetch(url, { headers: { cookie: adminCookie } });
  const adminCookie = await cookie();
  const c = (await (await read()).json()).selected.content;
  assert.equal(c.usage.length, 1);
  assert.equal(c.usage[0].metrics.input_tokens, 20);
  assert.equal(c.usage[0].metrics.input_cached_tokens, 5);
  assert.equal(JSON.stringify(c).includes('do-not-store'), false);
  assert.equal((await fetch(url, { headers: { cookie: await cookie('reader') } })).status, 403);
  e.report.usage[0].input_tokens = 21;
  assert.equal((await upload(e)).status, 409);
  assert.equal((await upload({ ...e, report: { ...e.report, job_id: 'AJ_badusage', usage: [{ ...e.report.usage[0], input_tokens: -1 }] } })).status, 422);
  db.prepare("UPDATE agent_session_reports SET expires_at=0 WHERE job_id='AJ_usage'").run();
  assert.equal((await (await read()).json()).selected.content, null);
  assert.equal(db.prepare("SELECT content FROM agent_session_reports WHERE job_id='AJ_usage'").get()!.content, null);
});

test('agent usage aggregates retained reports with stage/model isolation, filters, boundaries and coverage', async () => {
  const now = Date.now();
  const make = (job: string, agent = 'usage-agent', timestamp = (now - 60000) / 1000) => ({
    ...envelope(job), schemaVersion: 2, agentName: agent,
    report: { ...envelope(job).report, timestamp, usage: [
      { type: 'llm_usage', provider: 'example', model: 'shared', input_tokens: 100, input_cached_tokens: 20, output_tokens: 40 },
      { type: 'tts_usage', provider: 'example', model: 'shared', audio_duration: 2.5, characters_count: 30 },
      { type: 'stt_usage', provider: 'example', model: 'speech', audio_duration: 4 },
    ] },
  });
  const first = make('AJ_agg1');
  assert.equal((await upload(first)).status, 201);
  assert.equal((await upload(first)).status, 200);
  assert.equal((await upload(make('AJ_agg2'))).status, 201);
  assert.equal((await upload(make('AJ_agg_other', 'other-agent'))).status, 201);
  assert.equal((await upload(make('AJ_agg_old', 'usage-agent', (now - 7200000) / 1000))).status, 201);
  assert.equal((await upload(make('AJ_agg_future', 'usage-agent', (now + 7200000) / 1000))).status, 201);
  assert.equal((await upload(make('AJ_agg_expired'))).status, 201);
  db.prepare("UPDATE agent_session_reports SET expires_at=0 WHERE job_id='AJ_agg_expired'").run();
  assert.equal((await upload({ ...make('AJ_agg_v1'), schemaVersion: 1 })).status, 201);
  const partial = make('AJ_agg_partial');
  assert.equal((await upload({ ...partial, report: { ...partial.report, usage: [{ type: 'future_usage' }] } })).status, 201);
  const auth = { cookie: await cookie() };
  const url = base + '/api/agent-insights/agents/usage-agent/usage?hours=1';
  const r = await fetch(url, { headers: auth }); assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const data = await r.json();
  assert.deepEqual(data.coverage, { totalReports: 5, retainedReports: 4, usageReports: 2, missingUsageReports: 1, emptyUsageReports: 1, expiredReports: 1, omittedUsage: 1 });
  assert.equal(data.models.length, 3);
  const llm = data.models.find((m: any) => m.type === 'llm_usage');
  assert.equal(llm.metrics.input_tokens, 200); assert.equal(llm.metrics.input_cached_tokens, 40);
  assert.equal(llm.metrics.output_tokens, 80);
  assert.equal(data.series.reduce((s: number, b: any) => s + b.llmInput, 0), 200);
  assert.equal(data.series.reduce((s: number, b: any) => s + b.ttsAudio, 0), 5);
  assert.equal(data.series.reduce((s: number, b: any) => s + b.sttAudio, 0), 8);
  assert.equal(data.totalContributingReports, 2);
  assert.equal(data.reports[0].sessionAvailable, true);
  assert.equal(JSON.stringify(data).includes('Hello'), false);
  const key = encodeURIComponent(JSON.stringify(['tts_usage', 'example', 'shared']));
  const filtered = await (await fetch(url + '&model=' + key, { headers: auth })).json();
  assert.equal(filtered.series.reduce((s: number, b: any) => s + b.llmInput, 0), 0);
  assert.equal(filtered.series.reduce((s: number, b: any) => s + b.ttsAudio, 0), 5);
  assert.equal(filtered.totalContributingReports, 2);
  // JSON escaping can expand otherwise valid 200-character provider/model names.
  const escaped = encodeURIComponent(JSON.stringify(['llm_usage', '\u0000'.repeat(200), 'model']));
  assert.equal((await fetch(url + '&model=' + escaped, { headers: auth })).status, 200);
  for (const query of ['hours=0', 'hours=NaN', 'hours=2161', 'page=-1', 'page=1.5', 'model=oops', 'model=%5B%22x%22%5D']) {
    assert.equal((await fetch(url.split('?')[0] + '?' + query, { headers: auth })).status, 422);
  }
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { cookie: await cookie('reader') } })).status, 403);
});

test('structured log batches are authenticated, atomically idempotent and searchable by room/job', async () => {
  const e = { schemaVersion: 1, agentName: 'log-agent', roomSid: 'RM_logroom', jobId: 'AJ_logs', batchId: 'batch1', entries: [
    { id: 'entry1', at: 1000, level: 'INFO', message: 'Ready <script>unsafe</script>', logger: 'app', turnId: 'turn1', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), secret: 'discard' },
    { id: 'entry2', at: 1002, level: 'ERROR', message: 'Tool unavailable', logger: 'app' },
  ] };
  const post = (body: unknown, auth: string | null = token) => fetch(base + '/api/telemetry/logs', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post(e, null)).status, 401);
  assert.equal((await post(e)).status, 201);
  const saved = db.prepare("SELECT expires_at FROM agent_log_entries WHERE entry_id='entry1'").get();
  assert.equal((await post(e)).status, 200);
  assert.deepEqual(db.prepare("SELECT expires_at FROM agent_log_entries WHERE entry_id='entry1'").get(), saved);
  assert.equal((await post({ ...e, batchId: 'another-batch' })).status, 201);
  assert.equal((await post({ ...e, agentName: 'different-agent', batchId: 'different-agent', entries: [{ ...e.entries[0], id: 'new-agent-entry' }] })).status, 409);
  assert.equal((await post({ ...e, entries: [{ ...e.entries[0], message: 'Changed' }] })).status, 409);
  const conflict = { ...e, batchId: 'conflict-batch', entries: [{ ...e.entries[0], id: 'new-entry' }, { ...e.entries[1], message: 'Changed' }] };
  assert.equal((await post(conflict)).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_log_entries WHERE entry_id='new-entry'").get()!.n, 0);
  const auth = { cookie: await cookie() }, url = base + '/api/agent-insights/sessions/RM_logroom/logs';
  const response = await fetch(url, { headers: auth }); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.total, 2); assert.equal(data.rows.length, 2);
  assert.equal(data.rows[0].message, 'Tool unavailable');
  assert.equal(data.rows[1].at, 1000000);
  assert.equal(data.rows[1].traceId, 'a'.repeat(32));
  assert.equal(JSON.stringify(data).includes('discard'), false);
  assert.equal((await (await fetch(url + '?level=ERROR&q=UNAVAILABLE', { headers: auth })).json()).total, 1);
  assert.equal((await (await fetch(url + '?jobId=AJ_other', { headers: auth })).json()).total, 0);
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { cookie: await cookie('reader') } })).status, 403);
  db.prepare("UPDATE agent_log_entries SET expires_at=0 WHERE room_sid='RM_logroom'").run();
  const expired = await (await fetch(url, { headers: auth })).json();
  assert.equal(expired.total, 0); assert.equal(expired.expired, 2);
  assert.equal((await post({ ...e, batchId: 'after-expiry' })).status, 201);
  assert.equal((await (await fetch(url, { headers: auth })).json()).total, 0);
  assert.equal(db.prepare("SELECT message FROM agent_log_entries WHERE entry_id='entry1'").get()!.message, null);
  assert.equal((await post({ ...e, batchId: 'invalid', entries: [{ ...e.entries[0], at: -1 }] })).status, 422);
  assert.equal((await post({ ...e, batchId: 'invalid', entries: [{ ...e.entries[0], traceId: 'invalid' }] })).status, 422);
  assert.equal((await post({ ...e, batchId: 'invalid', entries: [e.entries[0], e.entries[0]] })).status, 422);
  assert.equal((await post({ ...e, schemaVersion: 2 })).status, 422);
  assert.equal((await fetch(url + '?page=-1', { headers: auth })).status, 422);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE room_sid='RM_logroom'").get()!.n, 0);
  const previous = config.agentLogsEnabled; config.agentLogsEnabled = false;
  try { assert.equal((await post(e)).status, 503); }
  finally { config.agentLogsEnabled = previous; }
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + token };
  assert.equal((await fetch(base + '/api/telemetry/logs', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/api/telemetry/logs', { method: 'POST', headers, body: JSON.stringify({ padding: 'x'.repeat(256 * 1024) }) })).status, 413);
  assert.equal((await post({ ...e, entries: Array.from({ length: 101 }, (_, n) => ({ ...e.entries[0], id: String(n) })) })).status, 422);
  assert.equal((await post({ ...e, entries: [{ ...e.entries[0], message: 'x'.repeat(4001) }] })).status, 422);
  assert.equal((await post({ ...e, entries: [{ ...e.entries[0], level: 'NOTICE' }] })).status, 422);
});

test('log pagination, late events and identical entry IDs remain isolated by room/job', async () => {
  const e = { schemaVersion: 1, agentName: 'log-agent', roomSid: 'RM_paged', jobId: 'AJ_paged', batchId: 'paged',
    entries: Array.from({ length: 61 }, (_, n) => ({ id: `entry${n}`, at: 1000 + n, level: 'INFO', message: `Log ${n}` })) };
  const post = (e: unknown) => fetch(base + '/api/telemetry/logs', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(e) });
  assert.equal((await post(e)).status, 201);
  assert.equal((await post({ ...e, batchId: 'late', entries: [{ ...e.entries[0], id: 'late', at: 500 }] })).status, 201);
  assert.equal((await post({ ...e, roomSid: 'RM_other_logs', batchId: 'other' })).status, 201);
  const auth = { cookie: await cookie() }, url = base + '/api/agent-insights/sessions/RM_paged/logs';
  const first = await (await fetch(url, { headers: auth })).json();
  const second = await (await fetch(url + '?page=2', { headers: auth })).json();
  assert.equal(first.total, 62); assert.equal(first.rows.length, 50); assert.equal(second.rows.length, 12);
  assert.equal(first.rows[0].id, 'entry60'); assert.equal(second.rows.at(-1).id, 'late');
  assert.equal(new Set([...first.rows, ...second.rows].map(r => r.id)).size, 62);
  assert.equal((await fetch(url, { headers: { authorization: 'Bearer ' + token } })).status, 401);
});

test('live collection handles terminal-before-events, redaction, correlation, exports and expired retries', async () => {
  const header = { schemaVersion: 1, roomSid: 'RM_live', jobId: 'AJ_live', agentName: 'live-agent', batchId: 'start',
    sdk: { language: 'python', version: '1.5.8' }, participantSid: 'PA_live', workerId: 'AW_live', mode: 'pipeline', capabilities: ['events', 'spans', 'logs', 'report'] };
  const post = (body: unknown) => fetch(base + '/api/telemetry/events', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const terminal = { id: 'finish', kind: 'collection', at: 1003, state: 'complete', expectedCount: 4, droppedCount: 0 };
  assert.equal((await post({ ...header, entries: [terminal] })).status, 201);
  const auth = { cookie: await cookie() }, url = base + '/api/agent-insights/sessions/RM_live/telemetry';
  const read = async () => (await (await fetch(url, { headers: auth })).json());
  assert.equal((await read()).jobs[0].state, 'incomplete');
  const events = { ...header, batchId: 'events', entries: [
    { id: 'message1', kind: 'message', at: 1000, role: 'user', text: 'Contact jane@example.test +14155550100', turnId: 'turn1', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
    { id: 'tool1', kind: 'tool', at: 1001, name: 'lookup', callId: 'call1', isError: true, arguments: 'discard', output: 'discard', turnId: 'turn1' },
    { id: 'span1', kind: 'span', at: 1000, end: 1002, stage: 'llm', name: 'llm_node', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), status: 'error', turnId: 'turn1', attributes: { password: 'discard' } },
    { id: 'log1', kind: 'log', at: 1002, message: 'password=hidden-value', level: 'ERROR', logger: 'application', turnId: 'turn1', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
  ] };
  assert.equal((await post(events)).status, 201); assert.equal((await post(events)).status, 200);
  const final = { ...envelope('AJ_live'), agentName: 'live-agent', report: { ...envelope('AJ_live').report, room_id: 'RM_live' } };
  assert.equal((await upload(final)).status, 201);
  const conflicting = { ...envelope('AJ_live'), agentName: 'another-agent', report: { ...envelope('AJ_live').report, room_id: 'RM_live' } };
  assert.equal((await upload(conflicting)).status, 409);
  const data = await read(); assert.equal(data.jobs[0].state, 'complete'); assert.equal(data.total, 5);
  assert.equal(data.jobs[0].receivedCount, 4); assert.equal(data.jobs[0].workerId, 'AW_live');
  assert.equal(data.rows.find((x: any) => x.id === 'message1').text.includes('jane@example.test'), false);
  assert.equal(JSON.stringify(data).includes('discard'), false);
  const correlated = await (await fetch(url + '?traceId=' + 'a'.repeat(32), { headers: auth })).json();
  assert.equal(correlated.rows.length, 3);
  const logs = await (await fetch(base + '/api/agent-insights/sessions/RM_live/logs?traceId=' + 'a'.repeat(32), { headers: auth })).json();
  assert.equal(logs.total, 1); assert.equal(logs.rows[0].message.includes('hidden-value'), false);
  const exportUrl = base + '/api/agent-insights/sessions/RM_live/export';
  const exported = await (await fetch(exportUrl, { headers: auth })).json();
  assert.equal(exported.records.length, 5); assert.equal(exported.logs.length, 1); assert.equal(exported.reports.length, 1);
  assert.equal(JSON.stringify(exported).includes('jane@example.test'), false);
  assert.equal((await fetch(exportUrl)).status, 401);
  assert.equal((await fetch(exportUrl, { headers: { cookie: await cookie('reader') } })).status, 403);
  assert.equal((await fetch(url, { headers: { authorization: 'Bearer ' + token } })).status, 401);
  assert.equal((await post({ ...events, entries: [{ ...events.entries[0], text: 'Changed' }] })).status, 409);
  db.prepare("UPDATE agent_live_jobs SET expires_at=0 WHERE job_id='AJ_live'").run();
  db.prepare("UPDATE agent_live_records SET expires_at=0 WHERE job_id='AJ_live'").run();
  db.prepare("UPDATE agent_session_reports SET expires_at=0 WHERE job_id='AJ_live'").run();
  db.prepare("UPDATE agent_log_entries SET expires_at=0 WHERE job_id='AJ_live'").run();
  assert.equal((await read()).jobs[0].state, 'expired');
  assert.equal((await post(events)).status, 200); assert.equal((await read()).rows.length, 0);
});

test('collection is disabled without an explicitly configured service token', async () => {
  const previous = config.telemetryToken; config.telemetryToken = '';
  try { assert.equal((await upload(envelope('AJ_disabled'))).status, 503); }
  finally { config.telemetryToken = previous; }
});

test('live telemetry rejects invalid fields atomically and reports disabled, dropped and stalled jobs', async () => {
  const post = (body: unknown, auth: string | null = token) => fetch(base + '/api/telemetry/events', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
  const e = { schemaVersion: 1, roomSid: 'RM_edges', jobId: 'AJ_edges', agentName: 'test-agent', batchId: 'edge1', sdk: { language: 'python', version: '1.5.8' }, capabilities: ['events'], entries: [{ id: 'one', kind: 'state', at: 1000, state: 'thinking' }] };
  assert.equal((await post(e, null)).status, 401);
  config.telemetryEventsEnabled = false; assert.equal((await post(e)).status, 503); config.telemetryEventsEnabled = true;
  for (const entry of [
    { id: 'bad', kind: 'message', at: 1000, role: 'system', text: 'excluded' },
    { id: 'bad', kind: 'span', at: 2, end: 1, traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'llm', stage: 'llm' },
    { id: 'bad', kind: 'metrics', at: 1, stage: 'llm', metrics: { input_tokens: .5 } },
    { id: 'bad', kind: 'state', at: 1, state: 'thinking', traceId: '0'.repeat(32) },
    { id: 'bad', kind: 'collection', at: 1, state: 'complete', expectedCount: -1 },
  ]) assert.equal((await post({ ...e, entries: [...e.entries, entry] })).status, 422);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_live_records WHERE room_sid='RM_edges'").get()!.n, 0);
  assert.equal((await post(e)).status, 201);
  const admin = { cookie: await cookie() };
  const read = async () => (await (await fetch(base + '/api/agent-insights/sessions/RM_edges/telemetry', { headers: admin })).json()).jobs[0];
  assert.equal((await read()).state, 'receiving');
  db.prepare("UPDATE agent_live_jobs SET last_received=0 WHERE room_sid='RM_edges'").run();
  assert.equal((await read()).state, 'incomplete');
  assert.equal((await post({ ...e, batchId: 'edge2', entries: [{ id: 'end', kind: 'collection', at: 1001, state: 'incomplete', expectedCount: 2, droppedCount: 1 }] })).status, 201);
  assert.equal((await read()).droppedCount, 1);
  assert.equal((await post({ ...e, batchId: 'edge3', entries: [{ ...e.entries[0], state: 'speaking' }, { id: 'new', kind: 'state', at: 1001, state: 'idle' }] })).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_live_records WHERE room_sid='RM_edges' AND id='new'").get()!.n, 0);
  for (const route of ['telemetry', 'export']) {
    assert.equal((await fetch(base + '/api/agent-insights/sessions/RM_edges/' + route)).status, 401);
    assert.equal((await fetch(base + '/api/agent-insights/sessions/RM_edges/' + route, { headers: { authorization: `Bearer ${token}` } })).status, 401);
    assert.equal((await fetch(base + '/api/agent-insights/sessions/RM_edges/' + route, { headers: { cookie: await cookie('reader') } })).status, 403);
  }
});

test('privacy upgrades scrub retained content while preserving retry digests', async () => {
  const { scrubRetainedTelemetry } = await import('../src/telemetry.js');
  const previous = config.telemetryRedaction;
  try {
    config.telemetryRedaction = 'off';
    const e = envelope('AJ_privacy_upgrade'); e.report.chat_history.items[1].content = ['Contact person@example.test'];
    assert.equal((await upload(e)).status, 201);
    const before = db.prepare("SELECT digest FROM agent_session_reports WHERE job_id='AJ_privacy_upgrade'").get()!.digest;
    config.telemetryRedaction = 'strict'; scrubRetainedTelemetry();
    const row = db.prepare("SELECT digest,content FROM agent_session_reports WHERE job_id='AJ_privacy_upgrade'").get()!;
    assert.equal(row.digest, before); assert.equal(String(row.content).includes('person@example.test'), false);
    assert.equal((await upload(e)).status, 200);
    const data = await (await fetch(base + '/api/agent-insights/sessions/RM_report?jobId=AJ_privacy_upgrade', { headers: { cookie: await cookie() } })).json();
    assert.equal(data.selected.content.items[0].text, '[CONTENT REDACTED]');
  } finally { config.telemetryRedaction = previous; }
});

test('live events reject oversized bodies and paginate without mixing room/job identities', async () => {
  const post = (body: unknown) => fetch(base + '/api/telemetry/events', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const header = { schemaVersion: 1, roomSid: 'RM_pages', jobId: 'AJ_pages', agentName: 'page-agent', batchId: 'p1', sdk: { language: 'node', version: '1.9.3' }, capabilities: ['events'] };
  const entries = Array.from({ length: 100 }, (_, i) => ({ id: 's'+i, kind: 'state', at: 1000+i, state: 'thinking' }));
  assert.equal((await post({ ...header, entries })).status, 201);
  assert.equal((await post({ ...header, batchId: 'p2', entries: [{ id: 'extra', kind: 'state', at: 2000, state: 'idle' }] })).status, 201);
  assert.equal((await post({ ...header, batchId: 'oversize', entries: [{ id: 'huge', kind: 'message', at: 1, role: 'user', text: 'a'.repeat(300000) }] })).status, 413);
  assert.equal((await post({ ...header, batchId: 'too-many', entries: [...entries, entries[0]] })).status, 422);
  const data = await (await fetch(base + '/api/agent-insights/sessions/RM_pages/telemetry?page=2&jobId=AJ_pages', { headers: { cookie: await cookie() } })).json();
  assert.equal(data.total, 101); assert.equal(data.rows.length, 1); assert.equal(data.rows[0].jobId, 'AJ_pages'); assert.equal(data.rows[0].id, 'extra');
});

test('combined export rejects an excessive byte budget before materializing content', async () => {
  db.prepare("INSERT INTO agent_session_reports(room_sid,job_id,agent_name,reported_at,received_at,expires_at,digest,content) VALUES (?,?,?,?,?,?,?,json_object('text',hex(zeroblob(17000000))))").run('RM_large_export','AJ_large_export','test-agent',Date.now(),Date.now(),Date.now()+60000,'test-digest');
  try {
    const response = await fetch(base + '/api/agent-insights/sessions/RM_large_export/export', { headers: { cookie: await cookie() } });
    assert.equal(response.status, 413); assert.match((await response.json()).error, /32 MiB/);
  } finally { db.prepare("DELETE FROM agent_session_reports WHERE room_sid='RM_large_export'").run(); }
});

test('performance percentiles and bucket drilldowns use canonical retained sources with isolated comparisons', async () => {
  const start=Date.now()-60000,auth={cookie:await cookie()},path='/api/agent-insights/analytics';
  for(const [agentName,jobId,values]of [['perf-one','AJ_perf_one',[.1,.3]],['perf-two','AJ_perf_two',[.2,.4]]] as const){
    const body={schemaVersion:2,agentName,report:{room_id:'RM_perf',job_id:jobId,timestamp:start/1000,chat_history:{items:values.map((n,i)=>({id:'turn'+i,type:'message',role:'assistant',content:['not-returned'],created_at:(start+i*1000)/1000,metrics:{e2e_latency:n}}))},usage:[{type:'llm_usage',provider:'test',model:'test',input_tokens:10,output_tokens:2}]}};
    assert.equal((await upload(body)).status,201);
  }
  const query=new URLSearchParams({from:String(start-1000),to:String(start+3000),agents:JSON.stringify(['perf-one','perf-two'])});
  const response=await fetch(base+path+'?'+query,{headers:auth});assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.totalSamples,4);assert.equal(data.groups.find((g:any)=>g.agentName==='perf-one').p50,100);assert.equal(data.groups.find((g:any)=>g.agentName==='perf-two').p95,400);assert.equal(data.models[0].metrics.input_tokens,20);assert.equal(JSON.stringify(data).includes('not-returned'),false);
  query.set('bucket',String(data.series[0].t));const selected=await(await fetch(base+path+'?'+query,{headers:auth})).json();assert.equal(selected.totalContributors,selected.rows.length);assert.ok(selected.rows.every((s:any)=>s.at>=data.series[0].t&&s.at<data.series[0].t+data.bucketMs));
  query.set('sample',selected.rows[0].id);const drawer=await(await fetch(base+path+'?'+query,{headers:auth})).json();assert.equal(drawer.selected.id,selected.rows[0].id);
  assert.equal((await fetch(base+path+'?'+query)).status,401);assert.equal((await fetch(base+path+'?'+query,{headers:{cookie:await cookie('reader')}})).status,403);
  query.set('agents',JSON.stringify(['a','b','c','d','e']));assert.equal((await fetch(base+path+'?'+query,{headers:auth})).status,422);
});
