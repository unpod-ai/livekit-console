import express, { Router, type ErrorRequestHandler } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { normalizeReport, ReportValidationError } from './agent-report.js';
import { aggregateAgentUsage, type ModelKey, type UsageReport } from './agent-usage.js';

export const telemetryIngest = Router();
export const agentInsights = Router();

const hash = (value: string): Buffer => createHash('sha256').update(value).digest();
const purge = () => db.prepare('UPDATE agent_session_reports SET content=NULL WHERE expires_at <= ? AND content IS NOT NULL').run(Date.now());

telemetryIngest.post('/session-reports', (req, res, next) => {
  if (!config.telemetryToken) { res.status(503).json({ error: 'Agent report collection is disabled' }); return; }
  const auth = req.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !timingSafeEqual(hash(auth.slice(7)), hash(config.telemetryToken))) {
    res.status(401).json({ error: 'Invalid telemetry token' }); return;
  }
  next();
}, express.json({ limit: '2mb' }), (req, res, next) => {
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
    db.prepare(`INSERT INTO agent_session_reports(room_sid,job_id,agent_name,participant_sid,worker_id,sdk_version,reported_at,received_at,expires_at,digest,content)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(roomSid, jobId, agentName, participantSid, workerId, sdkVersion, reportedAt, now, now + config.telemetryRetentionDays * 86400000, digest, JSON.stringify(content));
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
  res.json({ enabled: !!config.telemetryToken, retentionDays: config.telemetryRetentionDays, total, reports: rows.map(summary),
    selected: selected ? { ...summary(selected), content: selected.expires_at > Date.now() && selected.content ? JSON.parse(selected.content) : null } : null });
});

export function startReportRetention(): void {
  purge();
  setInterval(purge, 3600000).unref();
}
