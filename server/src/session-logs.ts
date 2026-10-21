import express, { Router, type ErrorRequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { contentExpiry } from './operations-policy.js';
import { noteSourceTimestamp } from './operations-observability.js';
import { config } from './config.js';
import { requireTelemetry } from './telemetry-auth.js';
import { ReportValidationError } from './report-validation.js';
import { redactContent } from './telemetry-privacy.js';

const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportValidationError('Expected an object');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ReportValidationError(`Invalid ${label}`);
  return value;
}
const optional = (value: unknown, label: string) => value == null ? null : text(value, label);
function id(value: unknown, label: string): string {
  const v = text(value, label, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(v)) throw new ReportValidationError(`Invalid ${label}`);
  return v;
}
export function normalizeLogBatch(value: unknown) {
  const e = object(value);
  if (e.schemaVersion !== 1) throw new ReportValidationError('Log schemaVersion must be 1');
  const roomSid = id(e.roomSid, 'roomSid'), jobId = id(e.jobId, 'jobId');
  if (!/^RM_.+/.test(roomSid) || !/^AJ_.+/.test(jobId)) throw new ReportValidationError('Room SID and job ID are required');
  if (!Array.isArray(e.entries) || !e.entries.length || e.entries.length > 100) throw new ReportValidationError('Expected 1–100 log entries');
  const seen = new Set<string>();
  const entries = e.entries.map(value => {
    const item = object(value), entryId = id(item.id, 'entry id');
    if (seen.has(entryId)) throw new ReportValidationError('Duplicate log entry ID');
    seen.add(entryId);
    if (typeof item.at !== 'number' || !Number.isFinite(item.at) || item.at < 0 || item.at > 8640000000000) throw new ReportValidationError('Log at must be a nonnegative Unix timestamp in seconds');
    const level = text(item.level, 'level');
    if (!LEVELS.includes(level)) throw new ReportValidationError('Unsupported log level');
    const traceId = optional(item.traceId, 'traceId'), spanId = optional(item.spanId, 'spanId');
    if (traceId && (!/^[a-f0-9]{32}$/.test(traceId) || /^0+$/.test(traceId))) throw new ReportValidationError('Invalid traceId');
    if (spanId && (!traceId || !/^[a-f0-9]{16}$/.test(spanId) || /^0+$/.test(spanId))) throw new ReportValidationError('Invalid spanId');
    return { id: entryId, at: Math.round(item.at * 1000), level, message: text(item.message, 'message', 4000),
      logger: optional(item.logger, 'logger'), turnId: optional(item.turnId, 'turnId'), traceId, spanId };
  });
  return { schemaVersion: 1, roomSid, jobId, agentName: text(e.agentName, 'agentName'), batchId: id(e.batchId, 'batchId'), entries };
}
export function purgeLogContent() {
  db.prepare('UPDATE agent_log_entries SET message=NULL,logger=NULL,turn_id=NULL,trace_id=NULL,span_id=NULL WHERE expires_at<=? AND message IS NOT NULL').run(Date.now());
}
export const logIngest = Router();
export const logInsights = Router();
logIngest.post('/', requireTelemetry, (_req, res, next) => {
  if (!config.agentLogsEnabled) { res.status(503).json({ error: 'Structured agent logs are disabled' }); return; }
  next();
}, express.json({ limit: '256kb' }), (req, res) => {
  let transaction = false;
  try {
    const batch = normalizeLogBatch(req.body), digest = hash(batch);
    const { roomSid, jobId, agentName, batchId } = batch;
    purgeLogContent();
    db.exec('BEGIN IMMEDIATE'); transaction = true;
    const existing = db.prepare('SELECT digest FROM agent_log_batches WHERE room_sid=? AND job_id=? AND batch_id=?').get(roomSid, jobId, batchId);
    if (existing && existing.digest !== digest) { db.exec('ROLLBACK'); transaction = false; res.status(409).json({ error: 'Conflicting log batch' }); return; }
    if (existing) { db.exec('COMMIT'); transaction = false; res.json({ duplicate: true }); return; }
    const owner = db.prepare('SELECT agent_name FROM agent_log_entries WHERE room_sid=? AND job_id=? LIMIT 1').get(roomSid, jobId);
    if (owner && owner.agent_name !== agentName) { db.exec('ROLLBACK'); transaction = false; res.status(409).json({ error: 'Conflicting agent identity for this job' }); return; }
    const entries = batch.entries.map(entry => ({ entry, digest: hash({ roomSid, jobId, agentName, entry }) }));
    for (const row of entries) {
      const saved = db.prepare('SELECT digest FROM agent_log_entries WHERE room_sid=? AND job_id=? AND entry_id=?').get(roomSid, jobId, row.entry.id);
      if (saved && saved.digest !== row.digest) { db.exec('ROLLBACK'); transaction = false; res.status(409).json({ error: 'Conflicting log entry' }); return; }
    }
    const now = Date.now(), expires = contentExpiry('logs', now, roomSid, jobId);
    const insert = db.prepare(`INSERT OR IGNORE INTO agent_log_entries(room_sid,job_id,entry_id,agent_name,at,level,message,logger,turn_id,trace_id,span_id,received_at,expires_at,digest)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const { entry, digest } of entries) {
      const e = redactContent(entry, config.telemetryRedaction, config.telemetryRedactTerms);
      insert.run(roomSid, jobId, e.id, agentName, e.at, e.level, expires > now ? e.message : null, expires > now ? e.logger : null, expires > now ? e.turnId : null, expires > now ? e.traceId : null, expires > now ? e.spanId : null, now, expires, digest);
    }
    db.prepare('INSERT INTO agent_log_batches(room_sid,job_id,batch_id,digest,received_at) VALUES (?,?,?,?,?)').run(roomSid, jobId, batchId, digest, now);
    db.exec('COMMIT'); transaction = false;
    noteSourceTimestamp('logs',Math.max(...batch.entries.map(e=>e.at)));
    res.status(201).json({ duplicate: false });
  } catch (err) {
    if (transaction) db.exec('ROLLBACK');
    res.status(err instanceof ReportValidationError ? 422 : 500).json({ error: err instanceof ReportValidationError ? err.message : 'Could not store logs' });
  }
});
const bodyErrors: ErrorRequestHandler = (err, _req, res, _next) => res.status(err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'Invalid log upload' });
logIngest.use(bodyErrors);

// Mounted behind requireAuth + requireAdmin by the parent Agent Insights router.
logInsights.get('/sessions/:sid/logs', (req, res) => {
  try {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if ((req.query.page !== undefined && (typeof req.query.page !== 'string' || !/^\d+$/.test(req.query.page))) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new ReportValidationError('Invalid log page');
    const q = req.query.q === undefined ? '' : text(req.query.q, 'query', 200);
    const job = req.query.jobId === undefined ? null : id(req.query.jobId, 'jobId');
    const level = req.query.level === undefined ? null : text(req.query.level, 'level');
    if (level && !LEVELS.includes(level)) throw new ReportValidationError('Invalid log level');
    purgeLogContent();
    const now = Date.now(), args: (string | number)[] = [req.params.sid, now];
    let where = 'room_sid=? AND expires_at>? AND message IS NOT NULL';
    if (job) { where += ' AND job_id=?'; args.push(job); }
    if (level) { where += ' AND level=?'; args.push(level); }
    for (const [query, column] of [['turnId', 'turn_id'], ['traceId', 'trace_id'], ['spanId', 'span_id']]) {
      if (req.query[query] !== undefined) { where += ` AND ${column}=?`; args.push(text(req.query[query], query)); }
    }
    if (q) { where += ' AND instr(lower(message),lower(?))>0'; args.push(q); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM agent_log_entries WHERE ${where}`).get(...args)!.n as number;
    const current = Math.min(page, Math.max(1, Math.ceil(total / 50)));
    const rows = db.prepare(`SELECT entry_id AS id,job_id AS jobId,agent_name AS agentName,at,level,message,logger,turn_id AS turnId,trace_id AS traceId,span_id AS spanId,expires_at AS expiresAt
      FROM agent_log_entries WHERE ${where} ORDER BY at DESC,job_id,entry_id LIMIT 50 OFFSET ?`).all(...args, (current - 1) * 50);
    const expired = db.prepare(`SELECT COUNT(*) AS n FROM agent_log_entries WHERE room_sid=? AND expires_at<=? ${job ? 'AND job_id=?' : ''}`).get(req.params.sid, now, ...(job ? [job] : []))!.n;
    const jobs = db.prepare('SELECT DISTINCT job_id AS jobId,agent_name AS agentName FROM agent_log_entries WHERE room_sid=? ORDER BY job_id LIMIT 100').all(req.params.sid);
    res.json({ enabled: config.agentLogsEnabled && !!config.telemetryToken, retentionDays: config.logRetentionDays, total, expired, rows: redactContent(rows, config.telemetryRedaction, config.telemetryRedactTerms), jobs, page: current, pageSize: 50 });
  } catch (err) { res.status(err instanceof ReportValidationError ? 422 : 500).json({ error: err instanceof ReportValidationError ? err.message : 'Could not read logs' }); }
});
