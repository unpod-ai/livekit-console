import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db } from './db.js';

const migratedKey = 'legacy-control-migrated';
const discoveryKey = 'legacy-control-discovery';
const auditColumns = ['id', 'at', 'actor', 'method', 'route', 'resource_hash', 'action', 'status'] as const;
type Row = Record<string, unknown>;
const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown) => typeof value === 'string' && value.length > 0;
function validUser(row: Row) {
  return integer(row.id) && Number(row.id) > 0 && text(row.username) && text(row.password_hash)
    && ['admin', 'viewer'].includes(String(row.role)) && integer(row.created_at)
    && (row.last_login_at === null || integer(row.last_login_at));
}
function validAudit(row: Row) {
  // Legacy route shaping permits an empty route; preserve it rather than rejecting valid history.
  return typeof row.route === 'string'
    && auditColumns.filter(key => !['at', 'status', 'route'].includes(key)).every(key => text(row[key]))
    && integer(row.at) && (row.status === null || (integer(row.status) && Number(row.status) >= 100 && Number(row.status) <= 599));
}
function sequence(database: DatabaseSync): number {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get()) return 0;
  const value = database.prepare("SELECT seq FROM sqlite_sequence WHERE name='users'").get()?.seq ?? 0;
  if (!integer(value)) throw new Error('Invalid legacy user sequence');
  return Number(value);
}

// Run once at startup, after db.ts has upgraded the single-server schema and before serving authentication.
// No project configuration or source database is consulted again after the committed migration marker.
export function migrateLegacyControl(source?: string): void {
  if (db.prepare('SELECT value FROM console_metadata WHERE key=?').get(migratedKey)?.value === '1') return;
  const main = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  if (typeof main !== 'string' || !main) throw new Error('Legacy migration requires a persistent main database');
  const configured = source !== undefined || process.env.LEGACY_CONTROL_DB_PATH !== undefined;
  const candidate = source ?? process.env.LEGACY_CONTROL_DB_PATH ?? path.join(path.dirname(main), 'control.db');
  if (typeof candidate !== 'string' || !candidate.trim()) throw new Error('Invalid legacy control database path');
  if (!existsSync(candidate)) {
    if (configured) throw new Error('Configured legacy control database is missing');
    // Discovery is not completion: a subsequently supplied canonical control database must still be migratable.
    db.prepare('INSERT INTO console_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(discoveryKey, 'absent');
    return;
  }
  if (realpathSync(candidate) === realpathSync(main)) throw new Error('Legacy control database must be separate from the main database');

  let legacy: DatabaseSync | undefined;
  let writing = false;
  try {
    legacy = new DatabaseSync(candidate, { readOnly: true });
    legacy.exec('PRAGMA busy_timeout=5000; BEGIN');
    if (legacy.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Invalid legacy control database');
    if (legacy.prepare("SELECT value FROM control_metadata WHERE key='users-migrated'").get()?.value !== '1') throw new Error('Legacy control database is not initialized');
    // Preparing every required projection before writing also rejects partially initialized source schemas.
    const users = legacy.prepare('SELECT id,username,password_hash,role,created_at,last_login_at FROM users ORDER BY id');
    const membership = legacy.prepare("SELECT transcripts,recordings,logs FROM project_memberships WHERE project_id='default' AND user_id=?");
    const audits = legacy.prepare(`SELECT ${auditColumns.join(',')} FROM control_audit WHERE project_id IN ('default','control') ORDER BY at,id`);
    const legacySequence = sequence(legacy);
    db.exec('BEGIN IMMEDIATE'); writing = true;
    // Another startup sharing this destination may have finished while this source was being validated.
    if (db.prepare('SELECT value FROM console_metadata WHERE key=?').get(migratedKey)?.value === '1') {
      db.exec('COMMIT'); writing = false;
      return;
    }
    db.exec('DELETE FROM users');
    const insertUser = db.prepare('INSERT INTO users(id,username,password_hash,role,created_at,last_login_at,transcripts,recordings,logs) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const row of users.iterate()) {
      if (!validUser(row)) throw new Error('Invalid legacy user');
      const grants = membership.all(row.id!);
      if (grants.length > 1 || grants.some(grant => ['transcripts', 'recordings', 'logs'].some(key => grant[key] !== 0 && grant[key] !== 1))) throw new Error('Invalid default content grants');
      const caps = row.role === 'admin' ? [1, 1, 1] : grants.length ? [grants[0].transcripts, grants[0].recordings, grants[0].logs] : [0, 0, 0];
      insertUser.run(row.id!, row.username!, row.password_hash!, row.role!, row.created_at!, row.last_login_at!, ...caps as number[]);
    }
    // Preserve both databases' historical high-water marks; deleted account IDs must never be recycled.
    const nextSequence = Math.max(sequence(db), legacySequence);
    if (db.prepare("SELECT 1 FROM sqlite_sequence WHERE name='users'").get()) db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='users'").run(nextSequence);
    else db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('users',?)").run(nextSequence);
    const insertAudit = db.prepare(`INSERT INTO console_audit(${auditColumns.join(',')}) VALUES(?,?,?,?,?,?,?,?)`);
    for (const row of audits.iterate()) {
      if (!validAudit(row)) throw new Error('Invalid legacy audit');
      const existing = db.prepare(`SELECT ${auditColumns.join(',')} FROM console_audit WHERE id=?`).get(row.id!);
      if (existing) {
        if (auditColumns.some(key => existing[key] !== row[key])) throw new Error('Conflicting audit identity');
      } else insertAudit.run(...auditColumns.map(key => row[key]!));
    }
    db.prepare('INSERT INTO console_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(discoveryKey, 'imported');
    db.prepare('INSERT INTO console_metadata(key,value) VALUES(?,?)').run(migratedKey, '1');
    db.exec('COMMIT'); writing = false;
  } catch {
    if (writing) db.exec('ROLLBACK');
    // Never echo source paths, SQLite row values, password hashes, or raw database errors into startup logs.
    throw new Error('Legacy control migration failed; destination was not changed');
  } finally {
    legacy?.close();
  }
}
