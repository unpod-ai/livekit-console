import express, { Router, type ErrorRequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { normalizeReport, ReportValidationError } from './agent-report.js';
import { aggregateAgentUsage, type ModelKey, type UsageReport } from './agent-usage.js';
import { requireTelemetry } from './telemetry-auth.js';
import { logIngest, logInsights, purgeLogContent } from './session-logs.js';
import { redactContent } from './telemetry-privacy.js';
import { performance } from './performance.js';
import { liveIngest, liveInsights, purgeLiveContent } from './live-telemetry.js';

export const telemetryIngest = Router();
export const agentInsights = Router();

const hash = (value: string): Buffer => createHash('sha256').update(value).digest();
const purge = () => {
  db.prepare('UPDATE agent_session_reports SET content=NULL WHERE expires_at <= ? AND content IS NOT NULL').run(Date.now());
  purgeLogContent();
  purgeLiveContent();
};
telemetryIngest.use('/logs', logIngest);
telemetryIngest.use('/events', liveIngest);

telemetryIngest.post('/session-reports', requireTelemetry, express.json({ limit: '2mb' }), (req, res, next) => {
  try {
    const normalized = normalizeReport(req.body);
    const { roomSid, jobId, agentName, participantSid, workerId, sdkVersion, reportedAt, content } = normalized;
    const digest = hash(JSON.stringify(normalized)).toString('hex');
    purge();
    const existing = db.prepare('SELECT digest FROM agent_session_reports WHERE room_sid=? AND job_id=?').get(roomSid, jobId);
    if (existing) {
      if (existing.digest !== digest) { res.status(409).json({ error: 'A different final report already exists for this room/job' }); return; }
      res.json({ roomSid, jobId, duplicate: true }); return;
    }
    const now = Date.now();
    const liveJob = db.prepare('SELECT agent_name FROM agent_live_jobs WHERE room_sid=? AND job_id=?').get(roomSid, jobId);
    if (liveJob && liveJob.agent_name !== agentName) { res.status(409).json({ error: 'Conflicting job identity' }); return; }
    db.prepare(`INSERT INTO agent_session_reports(room_sid,job_id,agent_name,participant_sid,worker_id,sdk_version,reported_at,received_at,expires_at,digest,content)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(roomSid, jobId, agentName, participantSid, workerId, sdkVersion, reportedAt, now, now + config.telemetryRetentionDays * 86400000, digest, JSON.stringify(redactContent(content, config.telemetryRedaction, config.telemetryRedactTerms)));
    res.status(201).json({ roomSid, jobId, duplicate: false });
  } catch (err) {
    if (err instanceof ReportValidationError) { res.status(422).json({ error: err.message }); return; }
    next(err);
  }
});

const bodyErrors: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500;
  res.status(status).json({ error: status === 413 ? 'Report exceeds 2 MiB' : status === 400 ? 'Invalid JSON' : 'Could not store agent report' });
};
telemetryIngest.use(bodyErrors);

type ReportRow = { room_sid: string; job_id: string; agent_name: string; participant_sid: string | null; worker_id: string | null;
  sdk_version: string | null; reported_at: number; received_at: number; expires_at: number; content: string | null };
const summary = (r: ReportRow) => ({ roomSid: r.room_sid, jobId: r.job_id, agentName: r.agent_name, participantSid: r.participant_sid,
  workerId: r.worker_id, sdkVersion: r.sdk_version, reportedAt: r.reported_at, receivedAt: r.received_at, expiresAt: r.expires_at,
  state: r.expires_at <= Date.now() ? 'expired' : 'received' });

// index.ts mounts this router behind requireAuth + requireAdmin; the service token is upload-only.
agentInsights.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
agentInsights.use(logInsights);
agentInsights.use(liveInsights);
agentInsights.use(performance);
agentInsights.get('/agents/:name/usage', (req, res, next) => {
  try {
    const integer = (value: unknown, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) throw new ReportValidationError('Invalid usage range or page');
      return Number(value);
    };
    const hours = integer(req.query.hours, 24, 2160);
    const page = integer(req.query.page, 1, 1000000);
    let model: ModelKey | null = null;
    if (req.query.model !== undefined) {
      if (typeof req.query.model !== 'string' || req.query.model.length > 4000) throw new ReportValidationError('Invalid model filter');
      try { model = JSON.parse(req.query.model); } catch { throw new ReportValidationError('Invalid model filter'); }
      if (!Array.isArray(model) || model.length !== 3 || model.some(v => typeof v !== 'string' || v.length > 200)) throw new ReportValidationError('Invalid model filter');
    }
    const to = Date.now();
    const from = to - hours * 3600000;
    // Project only usage and metadata: never return or materialize conversation text for this endpoint.
    const records = db.prepare(`SELECT r.room_sid,r.job_id,r.reported_at,r.expires_at,
      (r.content IS NOT NULL AND r.expires_at > ?) AS retained,
      CASE WHEN r.expires_at > ? THEN json_extract(r.content,'$.usage') END AS usage,
      CASE WHEN r.expires_at > ? THEN COALESCE(json_extract(r.content,'$.omittedUsage'),0) ELSE 0 END AS omitted,
      (s.room_sid IS NOT NULL) AS session_available
      FROM agent_session_reports r LEFT JOIN sessions s ON s.room_sid=r.room_sid
      WHERE r.agent_name=? AND r.reported_at>=? AND r.reported_at<? ORDER BY r.reported_at DESC,r.room_sid,r.job_id`).iterate(to, to, to, req.params.name, from, to);
    function* reports(): Iterable<UsageReport> {
      for (const r of records) yield { roomSid: r.room_sid as string, jobId: r.job_id as string,
        reportedAt: r.reported_at as number, expiresAt: r.expires_at as number, retained: !!r.retained,
        sessionAvailable: !!r.session_available, usage: r.usage ? JSON.parse(r.usage as string) : null, omittedUsage: r.omitted as number };
    }
    res.json({ enabled: !!config.telemetryToken, ...aggregateAgentUsage(reports(), from, to, model, page) });
  } catch (err) {
    if (err instanceof ReportValidationError) { res.status(422).json({ error: err.message }); return; }
    next(err);
  }
});
agentInsights.get('/sessions/:sid', (req, res) => {
  purge();
  const columns = 'room_sid,job_id,agent_name,participant_sid,worker_id,sdk_version,reported_at,received_at,expires_at';
  const rows = db.prepare(`SELECT ${columns} FROM agent_session_reports WHERE room_sid=? ORDER BY reported_at DESC,job_id LIMIT 100`).all(req.params.sid) as unknown as ReportRow[];
  const job = typeof req.query.jobId === 'string' ? req.query.jobId : rows[0]?.job_id;
  const selected = job ? db.prepare(`SELECT ${columns},content FROM agent_session_reports WHERE room_sid=? AND job_id=?`).get(req.params.sid, job) as ReportRow | undefined : undefined;
  const total = db.prepare('SELECT COUNT(*) AS n FROM agent_session_reports WHERE room_sid=?').get(req.params.sid)!.n;
  const retained = selected && selected.expires_at > Date.now() && selected.content ? redactContent(JSON.parse(selected.content), config.telemetryRedaction, config.telemetryRedactTerms) : null;
  if (retained && selected) {
    const references = db.prepare(`SELECT json_extract(content,'$.messageId') AS message_id,trace_id,span_id,turn_id FROM agent_live_records
      WHERE room_sid=? AND job_id=? AND kind='message' AND content IS NOT NULL AND expires_at>? ORDER BY received_at DESC,rowid DESC LIMIT 10000`).all(req.params.sid, selected.job_id, Date.now()).reverse();
    const byMessage = new Map(references.filter(r=>r.message_id).map(r=>[r.message_id,r]));
    retained.items = retained.items.map((item: {id:string}) => {const ref=byMessage.get(item.id);return ref?{...item,traceId:ref.trace_id,spanId:ref.span_id,turnId:ref.turn_id}:item;});
  }

  res.json({ enabled: !!config.telemetryToken, retentionDays: config.telemetryRetentionDays, total, reports: rows.map(summary),
    selected: selected ? { ...summary(selected), content: retained } : null });
});

export function scrubRetainedTelemetry(): void {
  if (config.telemetryRedaction === 'off') return;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['agent_session_reports', 'agent_live_records']) {
      // The live table is added by the Phase 1 schema; both tables hold normalized content only.
      for (const row of db.prepare(`SELECT rowid,content FROM ${table} WHERE content IS NOT NULL`).iterate()) {
        db.prepare(`UPDATE ${table} SET content=? WHERE rowid=?`).run(JSON.stringify(redactContent(JSON.parse(row.content as string), config.telemetryRedaction, config.telemetryRedactTerms)), row.rowid as number);
      }
    }
    for (const row of db.prepare('SELECT rowid,message,logger FROM agent_log_entries WHERE message IS NOT NULL').iterate()) {
      const value = redactContent(row, config.telemetryRedaction, config.telemetryRedactTerms);
      db.prepare('UPDATE agent_log_entries SET message=?,logger=? WHERE rowid=?').run(value.message as string, value.logger as string | null, row.rowid as number);
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

export function startReportRetention(): void {
  purge();
  scrubRetainedTelemetry();
  setInterval(purge, 3600000).unref();
}
