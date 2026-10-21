import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
const dir = mkdtempSync(path.join(tmpdir(), 'workers-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'test.db'), LIVEKIT_URL: 'ws://localhost', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' });
let body: unknown = { agent_name: 'worker-agent', worker_id: 'AW_first', worker_load: 0.3 };
let health = 200, info = 200, requests = 0;
const server = createServer((req, res) => {
 requests++;
 if (req.url === '/') { res.writeHead(health); res.end('health'); }
 else { res.writeHead(info, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); }
});
server.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const { config } = await import('../src/config.js');
const store = await import('../src/inventory-store.js');
const { pollWorkers } = await import('../src/workers.js');
const { db } = await import('../src/db.js');
const url = `http://127.0.0.1:${(server.address() as any).port}`;
config.workerUrls = [url];
after(async () => { await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); });
test('polls persist native identity across independent console connections, missing IDs and restart changes', async () => {
 await Promise.all([pollWorkers(), pollWorkers()]); assert.equal(requests, 2);
 const first = store.inventoryWorkerRows(24).workers[0]; assert.equal(first.workerId, 'AW_first'); assert.equal(first.registrationState, 'unknown');
 // A new node process with fresh modules reads the persisted connection, not an in-memory cache.
 const source = `const {config}=await import('./server/src/config.ts'); config.workerUrls=${JSON.stringify([url])}; const {inventoryWorkerRows}=await import('./server/src/inventory-store.ts'); console.log(JSON.stringify(inventoryWorkerRows(24).workers[0]));`;
 const reopened = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { cwd: path.resolve(import.meta.dirname, '../..'), env: process.env, encoding: 'utf8' }).trim());
 assert.equal(reopened.consoleWorkerId, first.consoleWorkerId);
 info = 503; health = 503; await pollWorkers();
 let current = store.inventoryWorkerRows(24).workers[0]; assert.equal(current.agentName, 'worker-agent'); assert.equal(current.workerId, null); assert.equal(current.lastReportedWorkerId, 'AW_first'); assert.equal(current.lastInfoAt, first.lastInfoAt);
 info = 200; health = 200; body = { agent_name: 'worker-agent', worker_id: 'AW_second' }; await pollWorkers();
 let rows = store.inventoryWorkerRows(24); assert.equal(rows.former[0].consoleWorkerId, first.consoleWorkerId); assert.notEqual(rows.workers[0].consoleWorkerId, first.consoleWorkerId);
 body = { agent_name: 'worker-agent' }; await pollWorkers(); current = store.inventoryWorkerRows(24).workers[0]; assert.equal(current.workerId, null); assert.equal(current.lastReportedWorkerId, 'AW_second');
});
test('health and info validity stay independent; bounded malformed info never invents IDs or readiness', async () => {
 for (const invalid of ['{bad', 'x'.repeat(65537), { agent_name: 'worker-agent', worker_load: -1 }, { agent_name: 'worker-agent', active_jobs: 1.5 }, { agent_name: 'worker-agent', worker_load: 'heavy' }]) {
  body = invalid; await pollWorkers(); const w = store.inventoryWorkerRows(24).workers[0]; assert.equal(w.ok, true); assert.equal(w.infoAvailable, false); assert.equal(w.workerId, null); assert.equal(w.load, null);
 }
 body = { agent_name: 'worker-agent', id: 'console-not-native', registered: false, ready: true }; await pollWorkers(); const w = store.inventoryWorkerRows(24).workers[0]; assert.equal(w.workerId, null); assert.equal(w.registrationState, 'unregistered'); assert.equal(w.readiness, 'ready');
});
test('endpoint rename remains separate until explicit alias merge; instance markers create deployment records', async () => {
 body = { agent_name: 'new-worker-name' }; await pollWorkers();
 const before = store.resolveAgent('worker-agent')!; const next = store.resolveAgent('new-worker-name')!; assert.notEqual(before.id, next.id);
 assert.ok(store.inventoryWorkerRows(24, before.id).former.length);
 store.linkAgentAlias(next.id, { name: 'worker-agent', mergeAgentId: before.id });
 assert.ok(store.inventoryWorkerRows(24, next.id).former.length);
 const first = store.inventoryWorkerRows(24, next.id).workers[0];
 config.workerMetadata[url] = { instanceKey: 'deploy-v2', version: '2' }; await pollWorkers();
 const deployed = store.inventoryWorkerRows(24, next.id); assert.notEqual(deployed.workers[0].consoleWorkerId, first.consoleWorkerId); assert.equal(deployed.workers[0].identityBasis, 'configured_instance');
});
test('renamed inventory and rollups survive endpoint removal, raw expiry and a fresh console process', () => {
 const identity = store.resolveAgent('new-worker-name')!;
 config.workerUrls = [];
 store.pruneInventory(Date.now() + 15 * 86400000);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_worker_samples').get()!.n, 0);
 store.syncInventory();
 const source = `const {config}=await import('./server/src/config.ts'); config.workerUrls=[]; const s=await import('./server/src/inventory-store.ts'); console.log(JSON.stringify({old:s.resolveAgent('worker-agent'),current:s.resolveAgent('new-worker-name'),rows:s.inventoryWorkerRows(24),rollups:s.workerRollups('worker-agent',365)}));`;
 const reopened = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { cwd: path.resolve(import.meta.dirname, '../..'), env: process.env, encoding: 'utf8' }).trim());
 assert.equal(reopened.old.id, identity.id);
 assert.equal(reopened.current.id, identity.id);
 assert.equal(reopened.rows.workers.length, 0);
 assert.ok(reopened.rows.former.some((w: any) => w.lastReportedWorkerId === 'AW_first'));
 assert.ok(reopened.rows.former.some((w: any) => w.lastReportedWorkerId === 'AW_second'));
 assert.ok(reopened.rollups.series.some((r: any) => r.samples > 0));
});
