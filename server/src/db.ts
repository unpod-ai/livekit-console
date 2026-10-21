import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH ?? path.resolve('data/console.db');
mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA busy_timeout = 5000;
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
  CREATE TABLE IF NOT EXISTS console_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS console_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,actor TEXT NOT NULL,method TEXT NOT NULL,route TEXT NOT NULL,resource_hash TEXT NOT NULL,action TEXT NOT NULL,status INTEGER);
  CREATE INDEX IF NOT EXISTS console_audit_time ON console_audit(at DESC);
  CREATE TABLE IF NOT EXISTS agent_worker_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, agent_name TEXT, at INTEGER NOT NULL,
    ok INTEGER NOT NULL, load REAL, active_jobs INTEGER, latency_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS agent_worker_samples_at ON agent_worker_samples(url, at);
  CREATE TABLE IF NOT EXISTS repo_traffic (
    day INTEGER NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, uniques INTEGER NOT NULL,
    PRIMARY KEY (day, kind)
  );
  CREATE TABLE IF NOT EXISTS agent_session_reports (
    room_sid TEXT NOT NULL, job_id TEXT NOT NULL, agent_name TEXT NOT NULL,
    participant_sid TEXT, worker_id TEXT, sdk_version TEXT,
    reported_at INTEGER NOT NULL, received_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    digest TEXT NOT NULL, content TEXT,
    PRIMARY KEY (room_sid, job_id)
  );
  CREATE INDEX IF NOT EXISTS agent_reports_expiry ON agent_session_reports(expires_at) WHERE content IS NOT NULL;
  CREATE INDEX IF NOT EXISTS agent_reports_agent_time ON agent_session_reports(agent_name,reported_at);
  CREATE TABLE IF NOT EXISTS agent_log_batches (
    room_sid TEXT NOT NULL, job_id TEXT NOT NULL, batch_id TEXT NOT NULL, digest TEXT NOT NULL, received_at INTEGER NOT NULL,
    PRIMARY KEY(room_sid,job_id,batch_id)
  );
  CREATE TABLE IF NOT EXISTS agent_log_entries (
    room_sid TEXT NOT NULL, job_id TEXT NOT NULL, entry_id TEXT NOT NULL, agent_name TEXT NOT NULL,
    at INTEGER NOT NULL, level TEXT NOT NULL, message TEXT, logger TEXT, turn_id TEXT, trace_id TEXT, span_id TEXT,
    received_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, digest TEXT NOT NULL,
    PRIMARY KEY(room_sid,job_id,entry_id)
  );
  CREATE INDEX IF NOT EXISTS agent_log_room_time ON agent_log_entries(room_sid,at DESC);
  CREATE INDEX IF NOT EXISTS agent_log_expiry ON agent_log_entries(expires_at) WHERE message IS NOT NULL;
  CREATE TABLE IF NOT EXISTS agent_live_jobs (
    room_sid TEXT NOT NULL,job_id TEXT NOT NULL,agent_name TEXT NOT NULL,sdk_language TEXT NOT NULL,sdk_version TEXT,
    participant_sid TEXT,worker_id TEXT,mode TEXT NOT NULL,capabilities TEXT NOT NULL,
    first_received INTEGER NOT NULL,last_received INTEGER NOT NULL,expires_at INTEGER NOT NULL,
    terminal_id TEXT,terminal_state TEXT,expected_count INTEGER,dropped_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(room_sid,job_id)
  );
  CREATE TABLE IF NOT EXISTS agent_live_batches (
    room_sid TEXT NOT NULL,job_id TEXT NOT NULL,batch_id TEXT NOT NULL,digest TEXT NOT NULL,
    PRIMARY KEY(room_sid,job_id,batch_id)
  );
  CREATE TABLE IF NOT EXISTS agent_live_records (
    room_sid TEXT NOT NULL,job_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,at INTEGER NOT NULL,
    turn_id TEXT,trace_id TEXT,span_id TEXT,content TEXT,digest TEXT NOT NULL,
    received_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(room_sid,job_id,id)
  );
  CREATE INDEX IF NOT EXISTS agent_live_room ON agent_live_records(room_sid,at);
  CREATE INDEX IF NOT EXISTS agent_live_expiry ON agent_live_records(expires_at) WHERE content IS NOT NULL;
  CREATE TABLE IF NOT EXISTS diagnostic_records (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL, received_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, room_sid TEXT, participant_sid TEXT, track_sid TEXT,
    call_id TEXT, sip_call_id TEXT, provider_call_id TEXT, instance_id TEXT,
    digest TEXT NOT NULL, content TEXT
  );
  CREATE INDEX IF NOT EXISTS diagnostic_time ON diagnostic_records(kind,at);
  CREATE INDEX IF NOT EXISTS diagnostic_room ON diagnostic_records(room_sid,participant_sid,track_sid,at);
  CREATE INDEX IF NOT EXISTS diagnostic_call ON diagnostic_records(call_id,at);
  CREATE INDEX IF NOT EXISTS diagnostic_sip_call ON diagnostic_records(sip_call_id,at);
  CREATE INDEX IF NOT EXISTS diagnostic_provider_call ON diagnostic_records(provider_call_id,at);
  CREATE INDEX IF NOT EXISTS diagnostic_expiry ON diagnostic_records(expires_at) WHERE content IS NOT NULL;
  CREATE TABLE IF NOT EXISTS egress (
    egress_id TEXT PRIMARY KEY, room_sid TEXT, room_name TEXT, status TEXT,
    started_at INTEGER, ended_at INTEGER, info TEXT NOT NULL
  );
`);

// The manual agent ping was replaced by worker status polling.
db.exec('DROP TABLE IF EXISTS agent_pings');

const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
for (const col of ['transcripts', 'recordings', 'logs']) if (!userCols.includes(col)) {
  db.exec(`ALTER TABLE users ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0; UPDATE users SET ${col}=1 WHERE role='admin'`);
}

// Older databases lack the worker's type/SDK columns; they let a worker that has since died still show what it was.
const sampleCols = (db.prepare('PRAGMA table_info(agent_worker_samples)').all() as { name: string }[]).map((c) => c.name);
for (const col of ['worker_type', 'sdk_version', 'project_type']) if (!sampleCols.includes(col)) db.exec(`ALTER TABLE agent_worker_samples ADD COLUMN ${col} TEXT`);

// Timestamps are unix milliseconds throughout.
export const nowMs = (): number => Date.now();
