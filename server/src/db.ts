import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH ?? path.resolve('data/console.db');
mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, ts INTEGER NOT NULL, type TEXT NOT NULL,
    room_sid TEXT, room_name TEXT, identity TEXT, payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_room ON events(room_sid, ts);
  CREATE TABLE IF NOT EXISTS sessions (
    room_sid TEXT PRIMARY KEY, room_name TEXT NOT NULL,
    started_at INTEGER NOT NULL, ended_at INTEGER, partial INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_at);
  CREATE TABLE IF NOT EXISTS participants (
    room_sid TEXT NOT NULL, sid TEXT NOT NULL, identity TEXT NOT NULL, name TEXT, kind TEXT,
    joined_at INTEGER NOT NULL, left_at INTEGER, attributes TEXT,
    PRIMARY KEY (room_sid, sid)
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
    created_at INTEGER NOT NULL, last_login_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS agent_worker_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, agent_name TEXT, at INTEGER NOT NULL,
    ok INTEGER NOT NULL, load REAL, active_jobs INTEGER, latency_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS agent_worker_samples_at ON agent_worker_samples(url, at);
  CREATE TABLE IF NOT EXISTS repo_traffic (
    day INTEGER NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, uniques INTEGER NOT NULL,
    PRIMARY KEY (day, kind)
  );
  CREATE TABLE IF NOT EXISTS egress (
    egress_id TEXT PRIMARY KEY, room_sid TEXT, room_name TEXT, status TEXT,
    started_at INTEGER, ended_at INTEGER, info TEXT NOT NULL
  );
`);

// The manual agent ping was replaced by worker status polling.
db.exec('DROP TABLE IF EXISTS agent_pings');

// Older databases lack the worker's type/SDK columns; they let a worker that has since died still show what it was.
const sampleCols = (db.prepare('PRAGMA table_info(agent_worker_samples)').all() as { name: string }[]).map((c) => c.name);
for (const col of ['worker_type', 'sdk_version', 'project_type']) if (!sampleCols.includes(col)) db.exec(`ALTER TABLE agent_worker_samples ADD COLUMN ${col} TEXT`);

// Timestamps are unix milliseconds throughout.
export const nowMs = (): number => Date.now();
