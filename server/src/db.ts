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
  CREATE TABLE IF NOT EXISTS agent_pings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agent_name TEXT NOT NULL, at INTEGER NOT NULL,
    ok INTEGER NOT NULL, latency_ms INTEGER, worker_id TEXT, error TEXT, by_user TEXT
  );
  CREATE INDEX IF NOT EXISTS agent_pings_name ON agent_pings(agent_name, at);
  CREATE TABLE IF NOT EXISTS egress (
    egress_id TEXT PRIMARY KEY, room_sid TEXT, room_name TEXT, status TEXT,
    started_at INTEGER, ended_at INTEGER, info TEXT NOT NULL
  );
`);

// Timestamps are unix milliseconds throughout.
export const nowMs = (): number => Date.now();
