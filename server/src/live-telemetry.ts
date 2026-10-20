import express, { Router, type ErrorRequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { requireTelemetry } from './telemetry-auth.js';
import { ReportValidationError } from './report-validation.js';
import { redactContent } from './telemetry-privacy.js';
import { normalizeLogBatch, purgeLogContent } from './session-logs.js';
import { normalizeUsage } from './model-usage.js';

type Obj = Record<string, any>;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const privacy = <T>(v: T): T => redactContent(v, config.telemetryRedaction, config.telemetryRedactTerms);
const bad = (s: string): never => { throw new ReportValidationError(s); };
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : bad('Expected an object');
const text = (v: unknown, label: string, max = 200): string => typeof v === 'string' && v.trim() && v.length <= max ? v : bad(`Invalid ${label}`);
const optional = (v: unknown, label: string): string | null => v == null || v === '' ? null : text(v, label);
const id = (v: unknown, label: string): string => { const s = text(v, label); return /^[A-Za-z0-9_-]+$/.test(s) ? s : bad(`Invalid ${label}`); };
const numeric = (v: unknown, label: string, max = Number.MAX_SAFE_INTEGER, integer = false): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && (!integer || Number.isSafeInteger(v)) ? v : bad(`Invalid ${label}`);
const time = (v: unknown): number => Math.round(numeric(v, 'timestamp seconds', 8640000000000) * 1000);
const choice = (v: unknown, allowed: string[], label: string): string => typeof v === 'string' && allowed.includes(v) ? v : bad(`Invalid ${label}`);
const trace = (v: unknown, size: number): string | null => v == null ? null : typeof v === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(v) && !/^0+$/.test(v) ? v : bad('Invalid trace/span ID');
const METRICS = ['llm_node_ttft', 'tts_node_ttfb', 'e2e_latency', 'transcription_delay', 'end_of_turn_delay', 'on_user_turn_completed_delay', 'duration', 'ttft', 'ttfb', 'audio_duration', 'input_tokens', 'output_tokens', 'tokens_per_second', 'playback_latency', 'total_requests'];
function metrics(v: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (v == null) return result;
  const raw = obj(v);
  for (const k of METRICS) if (raw[k] != null) result[k] = numeric(raw[k], k, Number.MAX_SAFE_INTEGER, ['input_tokens', 'output_tokens', 'total_requests'].includes(k));
  return result;
}
export function normalizeLiveBatch(value: unknown) {
  const e = obj(value);
  if (e.schemaVersion !== 1) bad('Live schemaVersion must be 1');
  const roomSid = id(e.roomSid, 'roomSid'), jobId = id(e.jobId, 'jobId');
  if (!/^RM_.+/.test(roomSid) || !/^AJ_.+/.test(jobId)) bad('Invalid room/job correlation');
  const sdk = obj(e.sdk);
  const language = choice(sdk.language, ['python', 'node'], 'SDK language'), version = text(sdk.version, 'SDK version', 100);
  const capabilities = e.capabilities ?? ['events'];
  if (!Array.isArray(capabilities) || capabilities.length > 6) bad('Invalid capabilities');
  const caps = [...new Set((capabilities as unknown[]).map(v => choice(v, ['events', 'spans', 'logs', 'report', 'metrics', 'usage'], 'capability')))].sort();
  if (!Array.isArray(e.entries) || !e.entries.length || e.entries.length > 100) bad('Expected 1–100 live records');
  const seen = new Set<string>();
  const entries = (e.entries as unknown[]).map(v => {
    const item = obj(v), entryId = id(item.id, 'record ID');
    if (seen.has(entryId)) bad('Duplicate live record ID'); seen.add(entryId);
    const kind = choice(item.kind, ['message', 'tool', 'handoff', 'state', 'error', 'metrics', 'usage', 'span', 'log', 'collection'], 'record kind');
    const common = { id: entryId, kind, at: time(item.at), turnId: optional(item.turnId, 'turnId'), traceId: trace(item.traceId, 32), spanId: trace(item.spanId, 16) };
    if (common.spanId && !common.traceId) bad('A span ID requires a trace ID');
    if (kind === 'message') return { ...common, messageId: optional(item.messageId, 'messageId'), role: choice(item.role, ['user', 'assistant'], 'message role'), text: typeof item.text === 'string' && item.text.length <= 64000 ? item.text : bad('Invalid message text'), interrupted: item.interrupted === true, metrics: metrics(item.metrics) };
    if (kind === 'tool') return { ...common, name: text(item.name, 'tool name'), callId: id(item.callId, 'callId'), isError: item.isError === true, status: choice(item.status ?? 'unavailable', ['started', 'completed', 'unavailable'], 'tool status') };
    if (kind === 'handoff') return { ...common, fromAgent: optional(item.fromAgent, 'fromAgent'), toAgent: text(item.toAgent, 'toAgent') };
    if (kind === 'state') return { ...common, state: choice(item.state, ['initializing', 'idle', 'listening', 'thinking', 'speaking', 'away', 'active'], 'agent state') };
    if (kind === 'error') return { ...common, message: text(item.message, 'error message', 4000), source: optional(item.source, 'source'), recoverable: item.recoverable === true };
    if (kind === 'metrics') return { ...common, stage: choice(item.stage, ['stt', 'llm', 'tts', 'vad', 'eou', 'realtime', 'other'], 'metric stage'), metrics: metrics(item.metrics) };
    if (kind === 'usage') {
      if (!Array.isArray(item.models) || item.models.length > 200) bad('Invalid cumulative usage');
      // The same strict model schema is used by finalized reports; snapshots never enter billing/usage rollups.
      return { ...common, models: normalizeUsage(item.models).usage };
    }
    if (kind === 'span') {
      if (!common.traceId || !common.spanId) bad('Spans require trace and span IDs');
      const end = time(item.end); if (end < common.at) bad('Span ends before it starts');
      return { ...common, end, parentSpanId: trace(item.parentSpanId, 16), name: text(item.name, 'span name'), stage: choice(item.stage, ['session', 'turn', 'stt', 'llm', 'tts', 'tool', 'realtime', 'other'], 'span stage'), status: choice(item.status ?? 'unset', ['unset', 'ok', 'error'], 'span status'), interrupted: item.interrupted === true, metrics: metrics(item.metrics) };
    }
    if (kind === 'log') {
      const normal = normalizeLogBatch({ schemaVersion: 1, roomSid, jobId, agentName: e.agentName, batchId: e.batchId, entries: [{ ...item, at: common.at / 1000 }] }).entries[0];
      return { ...common, level: normal.level, message: normal.message, logger: normal.logger };
    }
    const state = choice(item.state, ['receiving', 'complete', 'incomplete'], 'collection state');
    return { ...common, state, expectedCount: state === 'receiving' ? null : numeric(item.expectedCount, 'expected count', 10000000, true), droppedCount: numeric(item.droppedCount ?? 0, 'dropped count', 10000000, true) };
  });
  return { schemaVersion: 1, roomSid, jobId, agentName: text(e.agentName, 'agentName'), batchId: id(e.batchId, 'batchId'), sdk: { language, version },
    participantSid: e.participantSid == null ? null : id(e.participantSid, 'participantSid'), workerId: e.workerId == null ? null : id(e.workerId, 'workerId'),
    mode: choice(e.mode ?? 'unknown', ['pipeline', 'realtime', 'mixed', 'unknown'], 'model mode'), capabilities: caps, entries };
}
export const liveIngest = Router(), liveInsights = Router();
export function purgeLiveContent(): void { db.prepare('UPDATE agent_live_records SET content=NULL WHERE expires_at<=? AND content IS NOT NULL').run(Date.now()); }
class Conflict extends Error {}
liveIngest.post('/', requireTelemetry, (_req, res, next) => {
  if (!config.telemetryEventsEnabled) { res.status(503).json({ error: 'Live telemetry collection is disabled' }); return; } next();
}, express.json({ limit: '256kb' }), (req, res) => {
  let transaction = false;
  try {
    const b = normalizeLiveBatch(req.body), digest = hash(b), now = Date.now();
    purgeLiveContent(); purgeLogContent(); db.exec('BEGIN IMMEDIATE'); transaction = true;
    const saved = db.prepare('SELECT digest FROM agent_live_batches WHERE room_sid=? AND job_id=? AND batch_id=?').get(b.roomSid, b.jobId, b.batchId);
    if (saved) {
      if (saved.digest !== digest) throw new Conflict('Conflicting live batch');
      db.exec('COMMIT'); transaction = false; res.json({ duplicate: true }); return;
    }
    const job = db.prepare('SELECT * FROM agent_live_jobs WHERE room_sid=? AND job_id=?').get(b.roomSid, b.jobId) as Obj | undefined;
    const report = db.prepare('SELECT agent_name FROM agent_session_reports WHERE room_sid=? AND job_id=?').get(b.roomSid, b.jobId);
    if ((job && (job.agent_name !== b.agentName || job.sdk_language !== b.sdk.language || job.sdk_version !== b.sdk.version)) || (report && report.agent_name !== b.agentName)) throw new Conflict('Conflicting job identity');
    for (const k of ['participantSid', 'workerId'] as const) {
      const existing = job?.[k === 'participantSid' ? 'participant_sid' : 'worker_id'];
      if (existing && b[k] && existing !== b[k]) throw new Conflict('Conflicting participant/worker identity');
    }
    const expiry = job?.expires_at ?? now + config.telemetryRetentionDays * 86400000;
    const terminal = b.entries.filter((e: Obj) => e.kind === 'collection' && e.state !== 'receiving') as Obj[];
    if (terminal.length > 1 || (terminal[0] && job?.terminal_id && terminal[0].id !== job.terminal_id)) throw new Conflict('Conflicting collection completion');
    for (const e of b.entries) {
      const old = db.prepare('SELECT digest FROM agent_live_records WHERE room_sid=? AND job_id=? AND id=?').get(b.roomSid, b.jobId, e.id);
      if (old && old.digest !== hash(e)) throw new Conflict('Conflicting live record');
    }
    const insert = db.prepare('INSERT OR IGNORE INTO agent_live_records(room_sid,job_id,id,kind,at,turn_id,trace_id,span_id,content,digest,received_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const e of b.entries as Obj[]) {
      const content = privacy(e);
      insert.run(b.roomSid, b.jobId, e.id, e.kind, e.at, e.turnId, e.traceId, e.spanId, expiry > now ? JSON.stringify(content) : null, hash(e), now, expiry);
      if (e.kind === 'log') {
        const log = normalizeLogBatch({ schemaVersion: 1, roomSid: b.roomSid, jobId: b.jobId, agentName: b.agentName, batchId: b.batchId, entries: [{ ...e, at: e.at / 1000 }] }).entries[0];
        const logDigest = hash({ roomSid: b.roomSid, jobId: b.jobId, agentName: b.agentName, entry: log });
        const old = db.prepare('SELECT digest FROM agent_log_entries WHERE room_sid=? AND job_id=? AND entry_id=?').get(b.roomSid, b.jobId, e.id);
        if (old && old.digest !== logDigest) throw new Conflict('Conflicting structured log');
        const privateLog = privacy(log);
        db.prepare(`INSERT OR IGNORE INTO agent_log_entries(room_sid,job_id,entry_id,agent_name,at,level,message,logger,turn_id,trace_id,span_id,received_at,expires_at,digest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          b.roomSid, b.jobId, e.id, b.agentName, e.at, log.level, expiry > now ? privateLog.message : null, expiry > now ? privateLog.logger : null, expiry > now ? e.turnId : null, expiry > now ? e.traceId : null, expiry > now ? e.spanId : null, now, expiry, logDigest);
      }
    }
    const mode = !job || job.mode === 'unknown' ? b.mode : b.mode === 'unknown' || b.mode === job.mode ? job.mode : 'mixed';
    const caps = [...new Set([...(job ? JSON.parse(job.capabilities) : []), ...b.capabilities])].sort();
    db.prepare(`INSERT INTO agent_live_jobs(room_sid,job_id,agent_name,sdk_language,sdk_version,participant_sid,worker_id,mode,capabilities,first_received,last_received,expires_at,terminal_id,terminal_state,expected_count,dropped_count)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(room_sid,job_id) DO UPDATE SET
      participant_sid=COALESCE(excluded.participant_sid,participant_sid),worker_id=COALESCE(excluded.worker_id,worker_id),mode=excluded.mode,capabilities=excluded.capabilities,last_received=excluded.last_received,
      terminal_id=COALESCE(excluded.terminal_id,terminal_id),terminal_state=COALESCE(excluded.terminal_state,terminal_state),expected_count=COALESCE(excluded.expected_count,expected_count),dropped_count=MAX(dropped_count,excluded.dropped_count)`).run(
      b.roomSid,b.jobId,b.agentName,b.sdk.language,b.sdk.version,b.participantSid,b.workerId,mode,JSON.stringify(caps),now,now,expiry,terminal[0]?.id ?? null,terminal[0]?.state ?? null,terminal[0]?.expectedCount ?? null,Math.max(0,...b.entries.filter((e: Obj) => e.kind === 'collection').map((e: Obj) => e.droppedCount)));
    db.prepare('INSERT INTO agent_live_batches(room_sid,job_id,batch_id,digest) VALUES (?,?,?,?)').run(b.roomSid,b.jobId,b.batchId,digest);
    db.exec('COMMIT'); transaction = false; res.status(201).json({ duplicate: false });
  } catch (err) {
    if (transaction) db.exec('ROLLBACK');
    res.status(err instanceof Conflict ? 409 : err instanceof ReportValidationError ? 422 : 500).json({ error: err instanceof Conflict || err instanceof ReportValidationError ? err.message : 'Could not store live telemetry' });
  }
});
const bodyErrors: ErrorRequestHandler = (err, _req, res, _next) => { res.status(err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'Invalid live telemetry upload' }); };
liveIngest.use(bodyErrors);

function jobs(room: string): Obj[] {
  const now = Date.now();
  const ids = db.prepare(`SELECT job_id FROM agent_live_jobs WHERE room_sid=? UNION SELECT job_id FROM agent_session_reports WHERE room_sid=? UNION SELECT job_id FROM agent_log_entries WHERE room_sid=? ORDER BY job_id LIMIT 100`).all(room,room,room);
  return ids.map(row => {
    const jobId = row.job_id as string;
    const job = db.prepare('SELECT * FROM agent_live_jobs WHERE room_sid=? AND job_id=?').get(room,jobId) as Obj | undefined;
    const report = db.prepare('SELECT agent_name,expires_at,content,participant_sid,worker_id FROM agent_session_reports WHERE room_sid=? AND job_id=?').get(room,jobId) as Obj | undefined;
    const log = db.prepare('SELECT agent_name,MAX(expires_at) AS expiry FROM agent_log_entries WHERE room_sid=? AND job_id=?').get(room,jobId) as Obj;
    const counts = db.prepare("SELECT COUNT(*) AS n,SUM(CASE WHEN kind!='collection' THEN 1 ELSE 0 END) AS received FROM agent_live_records WHERE room_sid=? AND job_id=? AND expires_at>? AND content IS NOT NULL").get(room,jobId,now) as Obj;
    const reportAvailable = !!(report?.content && report.expires_at > now), hasContent = counts.n > 0 || reportAvailable || log.expiry > now;
    const reasons: string[] = [];
    let state = 'receiving';
    if (!hasContent && (job || report || log.expiry)) state = 'expired';
    else if (!job) { state = 'incomplete'; reasons.push('Live collection was not instrumented for this job'); }
    else if (job.terminal_id) {
      if (job.terminal_state !== 'complete') reasons.push('Agent reported an incomplete collection');
      if (job.dropped_count) reasons.push(`${job.dropped_count} records were dropped by the agent`);
      if ((counts.received ?? 0) !== job.expected_count) reasons.push(`Expected ${job.expected_count} records, received ${counts.received ?? 0}`);
      if (JSON.parse(job.capabilities).includes('report') && !reportAvailable) reasons.push('Final report is missing or expired');
      state = reasons.length ? 'incomplete' : 'complete';
    } else if (now - job.last_received > 120000 || db.prepare('SELECT ended_at FROM sessions WHERE room_sid=?').get(room)?.ended_at) {
      state = 'incomplete'; reasons.push('No completion marker; the collection stopped or the session ended');
    }
    return { jobId,agentName:job?.agent_name ?? report?.agent_name ?? log.agent_name,sdkLanguage:job?.sdk_language ?? 'unknown',sdkVersion:job?.sdk_version ?? null,
      participantSid:job?.participant_sid ?? report?.participant_sid ?? null,workerId:job?.worker_id ?? report?.worker_id ?? null,mode:job?.mode ?? 'unknown',
      capabilities:job?JSON.parse(job.capabilities):['report'],state,reasons,receivedCount:counts.received??0,expectedCount:job?.expected_count??null,droppedCount:job?.dropped_count??0,
      firstReceived:job?.first_received??null,lastReceived:job?.last_received??null,expiresAt:job?.expires_at??report?.expires_at??log.expiry??null,reportAvailable };
  });
}
function filters(req: express.Request) {
  const args: (string|number)[] = [req.params.sid,Date.now()];
  let where = 'room_sid=? AND expires_at>? AND content IS NOT NULL';
  for (const [query,column] of [['jobId','job_id'],['turnId','turn_id'],['traceId','trace_id'],['kind','kind']]) if (req.query[query] !== undefined) {
    const v = text(req.query[query],query); if (query === 'traceId') trace(v,32);
    where += ` AND ${column}=?`; args.push(v);
  }
  return {where,args};
}
liveInsights.get('/sessions/:sid/telemetry', (req,res) => {
  try {
    purgeLiveContent();
    const p = req.query.page === undefined ? 1 : typeof req.query.page === 'string' && /^\d+$/.test(req.query.page) ? Number(req.query.page) : bad('Invalid telemetry page');
    if (!Number.isSafeInteger(p)||p<1||p>1000000) bad('Invalid telemetry page');
    const {where,args}=filters(req), total=db.prepare(`SELECT COUNT(*) AS n FROM agent_live_records WHERE ${where}`).get(...args)!.n as number;
    const page=Math.min(p,Math.max(1,Math.ceil(total/100)));
    const rows=db.prepare(`SELECT job_id,content FROM agent_live_records WHERE ${where} ORDER BY at,id LIMIT 100 OFFSET ?`).all(...args,(page-1)*100).map(r=>({...privacy(JSON.parse(r.content as string)),jobId:r.job_id}));
    res.json({enabled:config.telemetryEventsEnabled&&!!config.telemetryToken,redaction:config.telemetryRedaction,retentionDays:config.telemetryRetentionDays,jobs:jobs(req.params.sid),rows,total,page,pageSize:100});
  } catch(err) { res.status(err instanceof ReportValidationError?422:500).json({error:err instanceof ReportValidationError?err.message:'Could not read live telemetry'}); }
});
liveInsights.get('/sessions/:sid/export',(req,res)=>{
  try {
    purgeLiveContent();purgeLogContent();
    const room=req.params.sid, now=Date.now();
    const job=req.query.jobId===undefined?null:id(req.query.jobId,'jobId');
    const suffix=job?' AND job_id=?':'',args:(string|number)[]=[room,now,...(job?[job]:[])];
    for(const table of ['agent_live_records','agent_log_entries','agent_session_reports']){
      const count=db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE room_sid=? AND expires_at>?${suffix}`).get(...args)!.n as number;
      if(count>50000){res.status(413).json({error:'Export exceeds 50,000 records per category; export a single job or use paginated reads'});return;}
    }
    const records=db.prepare(`SELECT job_id,content FROM agent_live_records WHERE room_sid=? AND expires_at>? AND content IS NOT NULL${suffix} ORDER BY at,id`).all(...args).map(r=>({...privacy(JSON.parse(r.content as string)),jobId:r.job_id}));
    const reports=db.prepare(`SELECT job_id AS jobId,agent_name AS agentName,sdk_version AS sdkVersion,content FROM agent_session_reports WHERE room_sid=? AND expires_at>? AND content IS NOT NULL${suffix} ORDER BY reported_at`).all(...args).map(r=>({...r,content:privacy(JSON.parse(r.content as string))}));
    const logs=privacy(db.prepare(`SELECT entry_id AS id,job_id AS jobId,at,level,message,logger,turn_id AS turnId,trace_id AS traceId,span_id AS spanId FROM agent_log_entries WHERE room_sid=? AND expires_at>? AND message IS NOT NULL${suffix} ORDER BY at,entry_id`).all(...args));
    res.set('Content-Disposition','attachment; filename="agent-session-export.json"');
    res.json({schemaVersion:1,roomSid:room,exportedAt:now,redaction:config.telemetryRedaction,truncated:false,jobs:jobs(room).filter(j=>!job||j.jobId===job),reports,records,logs});
  } catch(err){res.status(err instanceof ReportValidationError?422:500).json({error:err instanceof ReportValidationError?err.message:'Could not export telemetry'});}
});
