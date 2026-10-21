import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(path.join(tmpdir(), 'single-server-migration-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'console.db'), LIVEKIT_URL: 'ws://localhost', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'test', SESSION_SECRET: 'test' });
const { db } = await import('../src/db.js');
// Parent owns the production schema upgrade; these fixtures also run before that change lands.
for (const column of ['transcripts', 'recordings', 'logs']) if (!db.prepare('PRAGMA table_info(users)').all().some(row => row.name === column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
db.exec(`CREATE TABLE IF NOT EXISTS console_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS console_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,actor TEXT NOT NULL,method TEXT NOT NULL,route TEXT NOT NULL,resource_hash TEXT NOT NULL,action TEXT NOT NULL,status INTEGER);`);
const migration = await import('../src/single-server-migration.js');
after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { delete process.env.LEGACY_CONTROL_DB_PATH; db.exec('DELETE FROM users; DELETE FROM console_metadata; DELETE FROM console_audit; DELETE FROM sqlite_sequence WHERE name=\'users\''); rmSync(path.join(dir, 'control.db'), { force: true }); });
let fixtureId = 0;
function legacy() {
 const file = path.join(dir, `legacy-${++fixtureId}.db`), source = new DatabaseSync(file);
 source.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at INTEGER NOT NULL,last_login_at INTEGER);
 CREATE TABLE control_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO control_metadata VALUES('users-migrated','1');
 CREATE TABLE project_memberships(project_id TEXT,user_id INTEGER,role TEXT,transcripts INTEGER,recordings INTEGER,logs INTEGER,PRIMARY KEY(project_id,user_id));
 CREATE TABLE control_audit(id TEXT PRIMARY KEY,at INTEGER,project_id TEXT,actor TEXT,method TEXT,route TEXT,resource_hash TEXT,action TEXT,status INTEGER);
 INSERT INTO users VALUES(7,'canonical-viewer','current-password-hash','viewer',10,20);
 INSERT INTO users VALUES(8,'canonical-admin','admin-password-hash','admin',11,NULL);
 INSERT INTO users VALUES(9,'no-membership','viewer-hash','viewer',12,NULL);
 INSERT INTO project_memberships VALUES('default',7,'admin',1,0,1);
 INSERT INTO project_memberships VALUES('other',9,'admin',1,1,1);
 INSERT INTO control_audit VALUES('audit-default',100,'default','canonical-viewer','GET','/api/sessions/:resource','${'a'.repeat(64)}','read',200);
 INSERT INTO control_audit VALUES('audit-control',101,'control','canonical-admin','DELETE','/api/users/:resource','${'b'.repeat(64)}','mutation',NULL);
 INSERT INTO control_audit VALUES('audit-other',102,'other','hidden-user','POST','/api/operations','${'c'.repeat(64)}','mutation',403);`);
 return { file, source };
}
function staleMain() { db.prepare('INSERT INTO users(id,username,password_hash,role,created_at,transcripts,recordings,logs) VALUES(?,?,?,?,?,?,?,?)').run(7, 'stale-name', 'stale-hash', 'admin', 1, 1, 1, 1); db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(40, 'deleted-in-control', 'stale', 'admin', 1); }
function users() { return db.prepare('SELECT * FROM users ORDER BY id').all(); }
function metadata() { return db.prepare('SELECT * FROM console_metadata ORDER BY key').all(); }

test('canonical control users replace stale main users with stable cookie UIDs, hashes, roles and default grants', () => {
 const { file, source } = legacy(); source.close(); staleMain();
 migration.migrateLegacyControl(file);
 const rows = users(); assert.deepEqual(rows.map(row => row.id), [7, 8, 9]);
 assert.equal(rows[0].username, 'canonical-viewer'); assert.equal(rows[0].password_hash, 'current-password-hash'); assert.equal(rows[0].created_at, 10); assert.equal(rows[0].last_login_at, 20);
 assert.equal(rows[0].role, 'viewer'); assert.deepEqual([rows[0].transcripts, rows[0].recordings, rows[0].logs], [1, 0, 1]);
 assert.equal(rows[1].role, 'admin'); assert.deepEqual([rows[1].transcripts, rows[1].recordings, rows[1].logs], [1, 1, 1]);
 assert.deepEqual([rows[2].transcripts, rows[2].recordings, rows[2].logs], [0, 0, 0]);
 const audits = db.prepare('SELECT * FROM console_audit ORDER BY at').all(); assert.equal(audits.length, 2); assert.deepEqual(audits.map(row => row.id), ['audit-default', 'audit-control']); assert.equal(audits[1].status, null);
 assert.ok(!JSON.stringify(audits).includes('project_id')); assert.ok(!JSON.stringify(audits).includes('hidden-user'));
 const original = new DatabaseSync(file, { readOnly: true }); assert.equal(original.prepare('SELECT COUNT(*) n FROM control_audit').get()!.n, 3); original.close();
});
test('preserves deleted-account autoincrement history so an old UID cookie can never bind to a new user', () => {
 const { file, source } = legacy(); source.exec("INSERT INTO users VALUES(200,'deleted','deleted-hash','viewer',1,NULL); DELETE FROM users WHERE id=200"); source.close();
 migration.migrateLegacyControl(file); const created = db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES('new','hash','viewer',1)").run(); assert.ok(Number(created.lastInsertRowid) > 200);
});
test('restart marker prevents re-reading source or reviving accounts deleted after migration', () => {
 const { file, source } = legacy(); source.close(); migration.migrateLegacyControl(file);
 db.prepare('DELETE FROM users WHERE id=7').run(); writeFileSync(file, 'invalid database after migration');
 migration.migrateLegacyControl(file); assert.equal(db.prepare('SELECT 1 FROM users WHERE id=7').get(), undefined);
 const before = JSON.stringify({ users: users(), metadata: metadata() }); migration.migrateLegacyControl('/missing/private/source'); assert.equal(JSON.stringify({ users: users(), metadata: metadata() }), before);
});
test('absent default sibling preserves users and records discovery without blocking a later canonical source', () => {
 staleMain(); const before = users(); migration.migrateLegacyControl(); assert.deepEqual(users(), before); assert.ok(metadata().length > 0);
 const { file, source } = legacy(); source.close(); migration.migrateLegacyControl(file); assert.equal(users()[0].username, 'canonical-viewer');
});
test('defaults to sibling control.db, supports explicit legacy path, and never reads a runtime project config', () => {
 const { file, source } = legacy(); source.close(); process.env.LEGACY_CONTROL_DB_PATH = file; migration.migrateLegacyControl(); assert.equal(users()[0].username, 'canonical-viewer');
 db.exec('DELETE FROM users; DELETE FROM console_metadata; DELETE FROM console_audit'); delete process.env.LEGACY_CONTROL_DB_PATH;
 writeFileSync(path.join(dir, 'control.db'), readFileSync(file)); migration.migrateLegacyControl(); assert.equal(users()[0].username, 'canonical-viewer');
});
test('invalid, missing configured, self-referencing and uninitialized sources fail closed without changing destination', () => {
 const broken = path.join(dir, 'broken.db'); writeFileSync(broken, 'not SQLite');
 const { file, source } = legacy(); source.exec("DELETE FROM control_metadata WHERE key='users-migrated'"); source.close(); staleMain();
 const before = JSON.stringify({ users: users(), metadata: metadata() });
 for (const candidate of [broken, path.join(dir, 'missing.db'), file, process.env.DB_PATH!]) { assert.throws(() => migration.migrateLegacyControl(candidate)); assert.equal(JSON.stringify({ users: users(), metadata: metadata() }), before); }
 process.env.LEGACY_CONTROL_DB_PATH = path.join(dir, 'missing-env.db'); assert.throws(() => migration.migrateLegacyControl());
});
test('malformed grants and duplicate canonical usernames fail atomically and permit retry after repair', () => {
 for (const corrupt of ["UPDATE project_memberships SET transcripts=2 WHERE user_id=7", "UPDATE users SET username='canonical-viewer' WHERE id=9"]) {
  const { file, source } = legacy(); source.exec(corrupt); source.close(); staleMain();
  const before = JSON.stringify(users()); assert.throws(() => migration.migrateLegacyControl(file)); assert.equal(JSON.stringify(users()), before); assert.equal(metadata().length, 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM console_audit').get()!.n, 0);
  db.exec('DELETE FROM users');
 }
 const { file, source } = legacy(); source.close(); migration.migrateLegacyControl(file); assert.equal(users().length, 3);
});
test('audit conflicts roll back users and metadata; identical existing audit rows remain idempotent', () => {
 const { file, source } = legacy(); source.close(); staleMain();
 db.prepare('INSERT INTO console_audit VALUES(?,?,?,?,?,?,?,?)').run('audit-default', 100, 'different-actor', 'GET', '/api/sessions/:resource', 'a'.repeat(64), 'read', 200);
 const before = JSON.stringify(users()); assert.throws(() => migration.migrateLegacyControl(file)); assert.equal(JSON.stringify(users()), before); assert.equal(metadata().length, 0);
 db.prepare("UPDATE console_audit SET actor='canonical-viewer' WHERE id='audit-default'").run(); migration.migrateLegacyControl(file); assert.equal(db.prepare('SELECT COUNT(*) n FROM console_audit').get()!.n, 2);
});
test('an empty canonical user table removes stale and deleted accounts rather than retaining them', () => {
 const { file, source } = legacy(); source.exec('DELETE FROM users'); source.close(); staleMain(); migration.migrateLegacyControl(file); assert.equal(users().length, 0);
});
test('migration and one-time marker survive SQLite backup/restore and a fresh server process', () => {
 const { file, source } = legacy(); source.close(); migration.migrateLegacyControl(file);
 const backup = path.join(dir, 'backup.db'); db.prepare('VACUUM INTO ?').run(backup);
 const restored = new DatabaseSync(backup, { readOnly: true });
 try { assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok'); for (const table of ['users', 'console_audit', 'console_metadata']) assert.deepEqual(restored.prepare(`SELECT * FROM ${table}`).all(), db.prepare(`SELECT * FROM ${table}`).all()); } finally { restored.close(); }
 const moduleUrl = new URL('../src/single-server-migration.ts', import.meta.url).href;
 const restarted = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `const {migrateLegacyControl}=await import(${JSON.stringify(moduleUrl)}); migrateLegacyControl('/unavailable/old/control.db');`], { env: { ...process.env, DB_PATH: backup }, encoding: 'utf8' });
 assert.equal(restarted.status, 0, restarted.stderr);
});
test('legacy audit empty routes are valid retained history and migrate unchanged', () => {
 const { file, source } = legacy();
 source.prepare("UPDATE control_audit SET route='' WHERE id='audit-default'").run(); source.close();
 migration.migrateLegacyControl(file);
 assert.equal(db.prepare("SELECT route FROM console_audit WHERE id='audit-default'").get()!.route, '');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM console_audit').get()!.n, 2);
});
test('invalid audit fields still fail closed atomically without echoing private source content', () => {
 const { file, source } = legacy();
 source.prepare("UPDATE control_audit SET route=NULL,actor='private-marker' WHERE id='audit-default'").run(); source.close(); staleMain();
 const before = JSON.stringify(users());
 assert.throws(() => migration.migrateLegacyControl(file), error => error instanceof Error && !error.message.includes('private-marker') && !error.message.includes(file));
 assert.equal(JSON.stringify(users()), before); assert.equal(metadata().length, 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM console_audit').get()!.n, 0);
});
