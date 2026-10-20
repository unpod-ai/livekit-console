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

test('collection is disabled without an explicitly configured service token', async () => {
  const previous = config.telemetryToken; config.telemetryToken = '';
  try { assert.equal((await upload(envelope('AJ_disabled'))).status, 503); }
  finally { config.telemetryToken = previous; }
});
