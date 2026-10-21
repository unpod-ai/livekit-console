import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
const dir = mkdtempSync(path.join(tmpdir(), 'inventory-routes-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'test.db'), LIVEKIT_URL: 'ws://localhost', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'test' });
const { inventory } = await import('../src/inventory.js');
const store = await import('../src/inventory-store.js');
const { db } = await import('../src/db.js');
const { login, hashPassword } = await import('../src/auth.js');
const { config } = await import('../src/config.js');
const app = express(); app.use(express.json(), cookieParser()); app.post('/login', login); app.use('/api/inventory', inventory);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
after(async () => { await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); });
db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)').run('viewer', hashPassword('test-password'), 'viewer', Date.now());
async function headers(user: string) {
 const r = await fetch(base + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: 'test-password' }) });
 return { cookie: r.headers.get('set-cookie')!.split(';')[0], 'content-type': 'application/json' };
}
test('viewer detail reads expose stable metadata contract, writes require admin and collision confirmation', async () => {
 const a = store.ensureAgentName('first'), b = store.ensureAgentName('second');
 assert.equal((await fetch(base + '/api/inventory/agents')).status, 401);
 const viewer = await headers('viewer'), admin = await headers('admin');
 const endpoint = base + '/api/inventory/agents/' + a.id;
 const detail = await (await fetch(endpoint, { headers: viewer })).json();
 assert.deepEqual(Object.keys(detail.agent).sort(), ['aliases', 'firstSeenAt', 'id', 'lastSeenAt', 'name']);
 for (const key of ['workers', 'former', 'jobs']) assert.ok(Array.isArray(detail[key]));
 assert.equal(detail.rollups.resolutionMs, 3600000); assert.equal(detail.rollups.to - detail.rollups.from, 365 * 86400000 + 3600000);
 const alias = (body: unknown, h = admin) => fetch(endpoint + '/aliases', { method: 'POST', headers: h, body: JSON.stringify(body) });
 assert.equal((await alias({ name: 'second', mergeAgentId: b.id }, viewer)).status, 403);
 assert.equal((await alias({ name: 'second' })).status, 409);
 assert.equal((await alias({ name: 'second', mergeAgentId: a.id })).status, 409);
 assert.equal((await alias({ name: 'second', mergeAgentId: b.id, makeCanonical: true })).status, 200);
 assert.equal((await (await fetch(base + '/api/inventory/agents/' + b.id, { headers: viewer })).json()).agent.id, a.id);
 for (const query of ['?days=0', '?days=3651', '?days=1.5', '?days=bad']) assert.equal((await fetch(endpoint + query, { headers: viewer })).status, 400);
 assert.equal((await alias({ name: 'invalid\nname' })).status, 400);
 assert.equal((await alias({ name: 'third', makeCanonical: 'true' })).status, 400);
});
test('backfill honors participant name variants and retained chronology exactly once', () => {
 const at = Date.now() - 86400000; config.workerUrls = ['http://legacy'];
 for (const [i, key] of ['lk.agent.name', 'lk.agent_name', 'agent.name'].entries()) db.prepare('INSERT INTO participants(room_sid,sid,identity,kind,joined_at,attributes) VALUES(?,?,?,?,?,?)').run('RM_legacy', 'PA_' + i, 'agent', '4', at, JSON.stringify({ [key]: 'participant-' + i }));
 // IDs intentionally differ from chronology; the migration uses timestamps for first lifecycle observations.
 const insert = db.prepare('INSERT INTO agent_worker_samples(url,agent_name,at,ok,load) VALUES(?,?,?,?,?)');
 insert.run('http://legacy', 'later', at + 1000, 0, null); insert.run('http://legacy', 'earlier', at, 1, 0.5);
 store.syncInventory(); store.syncInventory();
 for (let i = 0; i < 3; i++) assert.ok(store.resolveAgent('participant-' + i));
 assert.equal(store.inventoryWorkerRows(48, 'earlier').former[0].firstSeenAt, at);
 assert.equal(store.inventoryWorkerRows(48, 'later').workers[0].workerId, null);
 assert.equal(store.workerRollups('earlier', 365).series[0].samples, 1);
 assert.equal(store.workerRollups('earlier', 365).series[0].loadCount, 1);
 assert.equal(store.workerRollups('earlier', 365).series[0].loadSum, 0.5);
});
test('job links require native IDs, are metadata only and bounded; rollup cleanup uses an indexed range', () => {
 config.workerUrls = ['http://native', 'http://anonymous'];
 const at = Date.now(); store.recordWorkerObservation({ url: 'http://native', agentName: 'jobs', workerId: 'AW_jobs', checkedAt: at, ok: true });
 store.recordWorkerObservation({ url: 'http://anonymous', agentName: 'jobs', checkedAt: at, ok: true });
 const insert = db.prepare('INSERT INTO agent_session_reports(room_sid,job_id,agent_name,worker_id,reported_at,received_at,expires_at,digest,content) VALUES(?,?,?,?,?,?,?,?,?)');
 for (let i = 0; i < 205; i++) insert.run('RM_jobs', 'AJ_' + i, 'jobs', i === 0 ? 'AW_other' : 'AW_jobs', at, at, at + 86400000, 'test', JSON.stringify({ transcript: 'private-content' }));
 const links = store.agentWorkerJobs('jobs'); assert.equal(links.length, 201);
 assert.ok(links.every(l => l.workerId === 'AW_jobs')); assert.equal(JSON.stringify(links).includes('private-content'), false);
 const plan = db.prepare('EXPLAIN QUERY PLAN DELETE FROM inventory_rollups WHERE hour < ?').all(at).map(r => r.detail).join('\n'); assert.match(plan, /inventory_rollups_hour/);
 store.pruneInventory(at + 366 * 86400000); assert.equal(store.workerRollups('jobs', 3650).series.length, 0); assert.equal(store.inventoryWorkerRows(24, 'jobs').workers.length, 2);
});
