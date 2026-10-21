import { test, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir = mkdtempSync(path.join(tmpdir(), 'lkc-agent-tests-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'test.db'), LIVEKIT_URL: 'ws://127.0.0.1:1', LIVEKIT_BROWSER_URL: 'wss://browser.example.test', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test-secret-at-least-32-characters', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'password', SESSION_SECRET: 'test-secret' });
// A missing implementation is the initial RED; SDK transport is mocked, never the store or router.
const backend = await import('../src/agent-tests.js');
const store = await import('../src/agent-test-store.js');
const { db } = await import('../src/db.js');
const { rooms, agentDispatch } = await import('../src/livekit.js');
const { updatePolicy } = await import('../src/operations-policy.js');
const live = new Map<string, any>();
let failCreate = false, failDelete = false, creates = 0;
let createGate: Promise<void> | null = null;
mock.method(rooms, 'createRoom', async (options: any) => {
  creates++;
  if (createGate) await createGate;
  const room = { ...options, sid: `RM_test${creates}` }; live.set(options.name, room);
  if (failCreate) throw new Error('Bearer private-upstream-secret');
  return room;
});
mock.method(rooms, 'listRooms', async (names: string[]) => [...live.values()].filter(r => names.includes(r.name)));
mock.method(rooms, 'deleteRoom', async (name: string) => { if (failDelete) throw new Error('api_key=private'); live.delete(name); });
mock.method(agentDispatch, 'createDispatch', async () => { throw new Error('Double dispatch is forbidden'); });
const app = express(); app.use(cookieParser()); app.use('/api/agent-tests', backend.agentTests);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}/api/agent-tests`;
const cookie = 'lkc_session=' + jwt.sign({ sub: 'admin', src: 'env' }, 'test-secret');
async function request(route: string, method = 'GET', body?: unknown, auth = cookie) {
  const response = await fetch(base + route, { method, headers: { cookie: auth, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
const prompt = { text: 'Say hello', expectedSubstring: 'hello', timeoutSeconds: 10 };
async function scenario() { const r = await request('/scenarios', 'POST', { name: 'Greeting', prompts: [prompt] }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; }
async function start(scenarioId?: string) { const r = await request('/runs', 'POST', { agentName: 'named-agent', ...(scenarioId ? { scenarioId } : {}) }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; }
after(async () => { mock.restoreAll(); await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); });

afterEach(async () => { failCreate = false; failDelete = false; for (const row of db.prepare("SELECT id FROM agent_test_runs WHERE state IN ('creating','active')").all()) await request('/runs/' + row.id + '/end', 'POST', {}); await backend.maintainAgentTests(); });

test('all test content requires authentication and admin/transcripts grants', async () => {
  assert.equal((await request('/scenarios', 'GET', undefined, '')).status, 401);
  let n=0;
  for (const [role, transcripts, logs, expected] of [['viewer', true, true, 403], ['admin', false, true, 403], ['admin', true, false, 200]] as const) {
    const name='access-user-'+(++n),id=Number(db.prepare('INSERT INTO users(username,password_hash,role,created_at,transcripts,recordings,logs) VALUES(?,?,?,?,?,0,?)').run(name,'unused',role,Date.now(),+transcripts,+logs).lastInsertRowid);
    const token='lkc_session='+jwt.sign({sub:name,src:'db',uid:id},'test-secret');
    const r=await fetch(base+'/runs',{headers:{cookie:token}});assert.equal(r.status,expected);
    if(expected===200)assert.equal((await fetch(base+'/compare?left=a&right=b',{headers:{cookie:token}})).status,403);
  }
});
test('scenarios validate 1–20 bounded prompts, substring and 10–120 second timeout; immutable run revisions', async () => {
  for (const prompts of [[], Array(21).fill(prompt), [{ ...prompt, timeoutSeconds: 9 }], [{ ...prompt, timeoutSeconds: 121 }], [{ ...prompt, text: 'x'.repeat(4001) }]]) assert.equal((await request('/scenarios', 'POST', { name: 'invalid', prompts })).status, 422);
  const s = await scenario(); assert.equal(s.revision, 1);
  const r = await start(s.id);
  const edit = await request('/scenarios/' + s.id, 'PATCH', { name: 'Edited', prompts: [{ ...prompt, text: 'new prompt' }] }); assert.equal(edit.body.revision, 2);
  const saved = (await request('/runs/' + r.run.id)).body.run; assert.equal(saved.scenarioRevision, 1); assert.equal(saved.scenario.prompts[0].text, prompt.text);
  assert.equal((await request('/scenarios/' + s.id, 'DELETE')).status, 200); assert.equal((await start()).run.state, 'active');
  assert.equal((await request('/runs', 'POST', { agentName: 'named-agent', scenarioId: s.id })).status, 404);
});
test('start uses a server-owned UUID room, one atomic named dispatch, safe short token and no auto egress', async () => {
  const result = await start(); const room = live.get(result.run.roomName);
  assert.equal(result.wsUrl, 'wss://browser.example.test');
  assert.match(room.name, /^console-test-[a-f0-9-]{36}$/); assert.equal(result.run.roomSid, room.sid);
  assert.deepEqual(room.agents.map((a: any) => a.agentName), ['named-agent']); assert.equal(room.egress, undefined);
  assert.equal(room.emptyTimeout, 60); assert.equal(room.departureTimeout, 30);
  const claims = jwt.decode(result.token) as any; assert.ok(claims.exp - claims.nbf <= 300); assert.equal(claims.video.room, room.name); assert.equal(claims.video.roomJoin, true);
  for (const key of ['roomAdmin', 'roomCreate', 'roomRecord', 'roomList', 'agent']) assert.ok(!claims.video[key]); assert.equal(claims.sip, undefined);
  assert.equal(claims.video.canUpdateOwnMetadata, false);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM agent_test_runs WHERE id=?').get(result.run.id)).includes(result.token));
  assert.equal(result.run.provenance.state, 'unknown'); assert.equal(result.run.provenance.actualWorkers.length, 0);
});
test('results validate sequential prompt records, compute outcomes/delays and reject fabricated native metrics', async () => {
  const s = await scenario(), r = await start(s.id), url = '/runs/' + r.run.id + '/results', now = Date.now();
  const record = { promptIndex: 0, status: 'received', responseText: 'hello world', sentAt: now, receivedAt: now, source: 'lk.transcription' };
  for (const forged of [{ workerId: 'WK_forged' }, { providerLatencyMs: 0 }, { costs: 0 }, { provenance: { verified: true } }]) assert.equal((await request(url, 'POST', { results: [{ ...record, ...forged }] })).status, 422);
  assert.equal((await request(url, 'POST', { results: [{ ...record, source: 'provider' }] })).status, 422);
  assert.equal((await request(url, 'POST', { results: [{ ...record, responseText: '' }] })).status, 422);
  assert.equal((await request(url, 'POST', { results: [{ ...record, receivedAt: now - 1 }] })).status, 422);
  const saved = await request(url, 'POST', { results: [record] }); assert.equal(saved.status, 200); assert.equal(saved.body.run.results[0].outcome, 'passed'); assert.equal(saved.body.run.results[0].responseDelayMs, 0); assert.equal(saved.body.run.results[0].delayBasis, 'browser_observed'); assert.equal(saved.body.run.provenance.state, 'unknown');
  assert.equal((await request(url, 'POST', { results: [record] })).status, 200);
  assert.equal((await request(url, 'POST', { results: [{ ...record, responseText: 'changed' }] })).status, 409);
  const ended = await request('/runs/' + r.run.id + '/end', 'POST', {}); assert.equal(ended.body.run.state, 'completed'); assert.equal(ended.body.run.cleanupState, 'complete');
});
test('timeout/disconnect/missing responses are explicit failures and missing delay stays null', async () => {
  for (const status of ['timeout', 'disconnected', 'failed']) {
    const s = await scenario(), r = await start(s.id);
    const saved = await request('/runs/' + r.run.id + '/results', 'POST', { results: [{ promptIndex: 0, status, source: 'transcription' }] });
    assert.equal(saved.status, 200); assert.equal(saved.body.run.results[0].outcome, 'failed'); assert.equal(saved.body.run.results[0].responseDelayMs, null);
    assert.equal((await request('/runs/' + r.run.id + '/end', 'POST', {})).body.run.state, 'failed');
  }
  const s = await scenario(), r = await start(s.id); const end = (await request('/runs/' + r.run.id + '/end', 'POST', {})).body.run;
  assert.equal(end.state, 'failed'); assert.equal(end.results[0].status, 'missing');
});
test('cleanup retries partial setup failure, never deletes foreign or replaced room and reconnect never redispatches', async () => {
  failCreate = true; failDelete = true;
  const failed = await request('/runs', 'POST', { agentName: 'named-agent' }); assert.equal(failed.status, 502); assert.ok(!JSON.stringify(failed.body).includes('private'));
  failCreate = false; failDelete = false; await backend.maintainAgentTests();
  const failedRun = (await request('/runs')).body.rows.find((r: any) => r.state === 'failed' && r.scenarioId === null); assert.equal(failedRun.cleanupState, 'complete');
  const r = await start(), before = creates;
  assert.equal((await request('/runs/' + r.run.id + '/reconnect', 'POST', {})).status, 200); assert.equal(creates, before);
  const owned = live.get(r.run.roomName); live.set(r.run.roomName, { ...owned, sid: 'RM_replaced', metadata: '{}' });
  assert.equal((await request('/runs/' + r.run.id + '/reconnect', 'POST', {})).status, 409);
  await request('/runs/' + r.run.id + '/end', 'POST', {}); assert.ok(live.has(r.run.roomName));
  assert.equal((await request('/runs/not-owned/end', 'POST', { roomName: 'production' })).status, 404);
});
test('expiry/restart abandon active tests, reject reconnect and retry only owned rooms', async () => {
  const r = await start(); db.prepare('UPDATE agent_test_runs SET expires_at=? WHERE id=?').run(Date.now() - 1, r.run.id);
  await backend.maintainAgentTests(); assert.equal((await request('/runs/' + r.run.id)).body.run.state, 'expired'); assert.equal((await request('/runs/' + r.run.id + '/reconnect', 'POST', {})).status, 409); assert.ok(!live.has(r.run.roomName));
  const other = await start(); db.prepare("UPDATE agent_test_runs SET process_id='previous-process' WHERE id=?").run(other.run.id); await backend.maintainAgentTests();
  assert.equal((await request('/runs/' + other.run.id)).body.run.state, 'abandoned'); assert.ok(!live.has(other.run.roomName));
});
test('compare requires terminal same-revision scenarios, explicit missing metrics and native room-correlated worker evidence', async () => {
  const s = await scenario(), a = await start(s.id), b = await start(s.id);
  assert.equal((await request(`/compare?left=${a.run.id}&right=${b.run.id}`)).status, 409);
  for (const r of [a, b]) { const now = Date.now(); await request('/runs/' + r.run.id + '/results', 'POST', { results: [{ promptIndex: 0, status: 'received', responseText: 'hello', sentAt: now, receivedAt: now, source: 'lk.chat' }] }); await request('/runs/' + r.run.id + '/end', 'POST', {}); }
  let comparison = (await request(`/compare?left=${a.run.id}&right=${b.run.id}`)).body;
  assert.equal(comparison.compatibility.sameScenarioRevision, true); assert.equal(comparison.compatibility.versionRegressionComparable, false); assert.ok(comparison.left.telemetry.missingMetrics.includes('e2e_latency'));
  db.prepare('INSERT INTO agent_live_jobs(room_sid,job_id,agent_name,sdk_language,sdk_version,worker_id,mode,capabilities,first_received,last_received,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(a.run.roomSid, 'AJ_test', 'named-agent', 'python', '1.2', 'WK_actual', 'pipeline', '[]', Date.now(), Date.now(), Date.now() + 60000);
  const detail = (await request('/runs/' + a.run.id)).body.run;
  assert.equal(detail.provenance.state, 'server_observed'); assert.equal(detail.provenance.actualWorkers[0].workerId, 'WK_actual'); assert.equal(detail.provenance.actualWorkers[0].version, null); assert.equal(detail.provenance.actualWorkers[0].sdkVersion, '1.2');
  await request('/scenarios/' + s.id, 'PATCH', { name: 'new revision' }); const c = await start(s.id); await request('/runs/' + c.run.id + '/end', 'POST', {});
  comparison = (await request(`/compare?left=${a.run.id}&right=${c.run.id}`)).body; assert.equal(comparison.compatibility.sameScenarioRevision, false);
});
test('deployment snapshots are optional, agent-matched and never accepted as actual provenance', async () => {
  const disabled = await request('/runs', 'POST', { agentName: 'named-agent', deploymentId: 'target' }); assert.equal(disabled.status, 503);
  const { config } = await import('../src/config.js');
  const helper = express(); helper.get('/targets', (_req, res) => res.json({ targets: [{ id: 'target', agentName: 'named-agent', image: 'fixture:latest', imageId: 'sha256:fixture', version: 'requested-v1', observedAt: Date.now() }] }));
  const helperServer = helper.listen(0, '127.0.0.1'); await new Promise<void>(resolve => helperServer.once('listening', resolve));
  const oldUrl = config.deploymentHelperUrl, oldToken = config.deploymentHelperToken;
  config.deploymentHelperUrl = `http://127.0.0.1:${(helperServer.address() as any).port}`; config.deploymentHelperToken = 'test-helper-token';
  try {
    const mismatch = await request('/runs', 'POST', { agentName: 'different-agent', deploymentId: 'target' }); assert.equal(mismatch.status, 422);
    const selected = await request('/runs', 'POST', { agentName: 'named-agent', deploymentId: 'target' }); assert.equal(selected.status, 201);
    assert.equal(selected.body.run.requestedDeployment.version, 'requested-v1'); assert.equal(selected.body.run.provenance.state, 'unknown'); assert.equal(selected.body.run.provenance.actualWorkers.length, 0);
  } finally { config.deploymentHelperUrl = oldUrl; config.deploymentHelperToken = oldToken; await new Promise<void>(resolve => helperServer.close(() => resolve())); }
});
test('sequential results are atomic, enforce timeout and scenario mismatch fails expectations', async () => {
  const s = (await request('/scenarios', 'POST', { name: 'Two prompts', prompts: [prompt, prompt] })).body, r = await start(s.id), now = Date.now();
  const record = { promptIndex: 0, status: 'received', responseText: 'wrong answer', sentAt: now, receivedAt: now, source: 'transcription' };
  const route = '/runs/' + r.run.id + '/results';
  assert.equal((await request(route, 'POST', { results: [{ ...record, promptIndex: 1 }] })).status, 409);
  assert.equal((await request(route, 'POST', { results: [record, { ...record, promptIndex: 3 }] })).status, 422);
  assert.equal((await request('/runs/' + r.run.id)).body.run.results.length, 0);
  assert.equal((await request(route, 'POST', { results: [{ ...record, sentAt: now - 11000 }] })).status, 422);
  const good = await request(route, 'POST', { results: [record] }); assert.equal(good.body.run.results[0].outcome, 'failed');
  const end = (await request('/runs/' + r.run.id + '/end', 'POST', {})).body.run; assert.equal(end.state, 'failed'); assert.equal(end.results[1].status, 'missing');
});
test('native measurements preserve zero and cannot be fabricated from same-name jobs in other rooms', async () => {
  const r = await start(), other = await start(), now = Date.now();
  db.prepare('INSERT INTO agent_live_jobs(room_sid,job_id,agent_name,sdk_language,sdk_version,worker_id,mode,capabilities,first_received,last_received,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(r.run.roomSid, 'AJ_zero', 'named-agent', 'python', '1.2', 'WK_zero', 'pipeline', '[]', now, now, now + 60000);
  db.prepare('INSERT INTO agent_live_records(room_sid,job_id,id,kind,at,received_at,expires_at,digest,content) VALUES(?,?,?,?,?,?,?,?,?)').run(r.run.roomSid, 'AJ_zero', 'message0', 'message', now, now, now + 60000, 'digest', JSON.stringify({ role: 'assistant', text: 'hello', metrics: { e2e_latency: 0 } }));
  const native = (await request('/runs/' + r.run.id)).body.run; const metric = native.telemetry.metrics.find((m: any) => m.metric === 'e2e_latency'); assert.equal(metric.count, 1); assert.equal(metric.p50Ms, 0); assert.equal(native.telemetry.cost, null);
  const missing = (await request('/runs/' + other.run.id)).body.run; assert.equal(missing.provenance.state, 'unknown'); assert.equal(missing.telemetry.metrics.find((m: any) => m.metric === 'e2e_latency').p50Ms, null);
});
test('five-run active cap and JSON/request bounds are enforced before creating rooms', async () => {
  for (let index = 0; index < 5; index++) await start();
  const count = creates; assert.equal((await request('/runs', 'POST', { agentName: 'named-agent' })).status, 409); assert.equal(creates, count);
  assert.equal((await request('/runs', 'POST', { agentName: 'named-agent', roomName: 'production' })).status, 422);
  assert.equal((await request('/scenarios', 'POST', { name: 'x'.repeat(400000) })).status, 413);
  assert.equal((await request('/runs?limit=0')).status, 422); assert.equal((await request('/runs?offset=-1')).status, 422);
});
test('retention only shortens expiry and redacted expectations cannot silently pass', async () => {
  const s = (await request('/scenarios', 'POST', { name: 'Sensitive', prompts: [{ ...prompt, expectedSubstring: 'a@example.test' }] })).body;
  assert.equal(s.prompts[0].expectationAvailable, false);
  const r = await start(s.id), now = Date.now();
  const saved = await request('/runs/' + r.run.id + '/results', 'POST', { results: [{ promptIndex: 0, status: 'received', responseText: '[EMAIL REDACTED]', sentAt: now, receivedAt: now, source: 'lk.chat' }] }); assert.equal(saved.body.run.results[0].outcome, 'unavailable');
  db.prepare('UPDATE agent_test_runs SET content_expires_at=? WHERE id=?').run(now - 1, r.run.id); store.maintainAgentTestContent();
  assert.equal((await request('/runs/' + r.run.id)).body.run.scenario, null);
  assert.equal((await request('/runs/' + r.run.id + '/end', 'POST', {})).body.run.state, 'failed');
  updatePolicy({ categories: { live: { retentionDays: 1 } } }); store.maintainAgentTestContent();
  const expiry = Number(db.prepare('SELECT expires_at FROM agent_test_scenarios WHERE id=?').get(s.id)!.expires_at);
  updatePolicy({ categories: { live: { retentionDays: 30 } } }); store.maintainAgentTestContent(); assert.equal(Number(db.prepare('SELECT expires_at FROM agent_test_scenarios WHERE id=?').get(s.id)!.expires_at), expiry);
});
test('maximum-length scenarios fit inside the bounded room lease', async () => {
  const s = (await request('/scenarios', 'POST', { name: 'Long scenario', prompts: Array(20).fill({ ...prompt, timeoutSeconds: 120 }) })).body;
  const r = await start(s.id); assert.ok(r.run.expiresAt - r.run.createdAt >= 20 * 120000 + 60000);
});
test('end during room creation cleans the late-created room and persists its native SID', async () => {
  let release!: () => void; createGate = new Promise<void>(resolve => { release = resolve; });
  const starting = request('/runs', 'POST', { agentName: 'named-agent' });
  let creating: any;
  for (let attempt = 0; attempt < 100; attempt++) { creating = db.prepare("SELECT * FROM agent_test_runs WHERE state='creating'").get(); if (creating) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(creating);
  try { await request('/runs/' + creating.id + '/end', 'POST', {}); } finally { createGate = null; release(); }
  assert.equal((await starting).status, 409);
  const saved = (await request('/runs/' + creating.id)).body.run; assert.match(saved.roomSid, /^RM_/); assert.equal(saved.cleanupState, 'complete'); assert.ok(!live.has(saved.roomName));
});
test('self-reported worker versions without shared native measurements never establish a measured regression', async () => {
  const s = await scenario(), a = await start(s.id), b = await start(s.id), now = Date.now();
  for (const [index, run] of [a.run, b.run].entries()) {
    const workerId = 'WK_version' + index, participantSid = 'PA_version' + index;
    db.prepare('INSERT INTO agent_live_jobs(room_sid,job_id,agent_name,sdk_language,sdk_version,worker_id,participant_sid,mode,capabilities,first_received,last_received,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(run.roomSid, 'AJ_version' + index, run.agentName, 'python', '1.2', workerId, participantSid, 'pipeline', '[]', now, now, now + 60000);
    db.prepare('INSERT INTO participants(room_sid,sid,identity,joined_at,attributes) VALUES(?,?,?,?,?)').run(run.roomSid, participantSid, workerId, now, JSON.stringify({ worker_id: workerId, worker_version: 'v' + index }));
    await request('/runs/' + run.id + '/results', 'POST', { results: [{ promptIndex: 0, status: 'received', responseText: 'hello', sentAt: now, receivedAt: now, source: 'lk.chat' }] });
    await request('/runs/' + run.id + '/end', 'POST', {});
  }
  const comparison = (await request(`/compare?left=${a.run.id}&right=${b.run.id}`)).body;
  assert.equal(comparison.left.provenance.actualWorkers[0].version, 'v0'); assert.equal(comparison.compatibility.versionRegressionComparable, false);
  assert.ok(comparison.compatibility.reasons.includes('shared_native_measurements_missing'));
});
test('privacy scrubs prompt/expected/response immediately; bounded export, monotonic retention and deletion prevent revival', async () => {
  const s = (await request('/scenarios', 'POST', { name: 'private@example.test', prompts: [{ text: 'private@example.test', expectedSubstring: 'private@example.test', timeoutSeconds: 10 }] })).body;
  const r = await start(s.id); const now = Date.now(); await request('/runs/' + r.run.id + '/results', 'POST', { results: [{ promptIndex: 0, status: 'received', responseText: 'private@example.test', source: 'lk.chat', sentAt: now, receivedAt: now }] });
  assert.ok(!JSON.stringify(store.exportAgentTestContent(true)).includes('private@example.test'));
  updatePolicy({ redaction: 'strict' }); store.scrubAgentTestContent();
  const saved = (await request('/runs/' + r.run.id)).body.run; assert.equal(saved.scenario.prompts[0].text, '[CONTENT REDACTED]'); assert.equal(saved.results[0].responseText, '[CONTENT REDACTED]');
  assert.ok(!JSON.stringify(store.exportAgentTestContent(false)).includes('Say hello')); assert.throws(() => store.exportAgentTestContent(true, { maxRows: 10000, maxBytes: 1 }));
  assert.ok(store.agentTestStorage().rows > 0); store.deleteAgentTestContent();
  assert.equal((await request('/runs/' + r.run.id + '/results', 'POST', { results: [{ promptIndex: 0, status: 'timeout', source: 'lk.chat' }] })).status, 409);
  const deleted = (await request('/runs/' + r.run.id)).body.run; assert.equal(deleted.scenario, null); assert.equal(deleted.results[0].responseText, null);
});
test('scenario deletion during deployment lookup cannot resurrect a cached snapshot',async()=>{
 const s=await scenario();const {config}=await import('../src/config.js');
 let entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const helper=express();helper.get('/targets',async(_q,res)=>{entered();await gate;res.json({targets:[{id:'target',agentName:'named-agent'}]});});
 const service=helper.listen(0,'127.0.0.1');await new Promise<void>(r=>service.once('listening',r));const before={url:config.deploymentHelperUrl,token:config.deploymentHelperToken};
 config.deploymentHelperUrl='http://127.0.0.1:'+(service.address() as any).port;config.deploymentHelperToken='fixture-token';
 try{
  const pending=request('/runs','POST',{agentName:'named-agent',scenarioId:s.id,deploymentId:'target'});await arrived;
  store.deleteAgentTestContent();release();const response=await pending;assert.equal(response.status,404);assert.ok(!JSON.stringify(response.body).includes('hello world'));
 }finally{release();config.deploymentHelperUrl=before.url;config.deploymentHelperToken=before.token;await new Promise<void>(r=>service.close(()=>r()));}
});
