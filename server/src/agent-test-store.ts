import { randomUUID, createHash } from 'node:crypto';
import { db } from './db.js';
import { getPolicy } from './operations-policy.js';
import { redactContent } from './telemetry-privacy.js';
import { canonicalMeasurements, METRICS, percentile, type Input } from './turn-analytics.js';
import { aggregateAgentUsage } from './agent-usage.js';

export class AgentTestError extends Error { constructor(message: string, public status = 422) { super(message); } }
export type TestPrompt = { text: string; expectedSubstring: string | null; timeoutSeconds: number; expectationAvailable: boolean };
export type TestScenario = { id: string; name: string; revision: number; prompts: TestPrompt[]; createdAt: number; updatedAt: number; expiresAt: number };
export type RequestedDeployment = { id: string; agentName: string; image: string | null; imageId: string | null; version: string | null; observedAt: number | null };
export type TestRunState = 'creating' | 'active' | 'completed' | 'failed' | 'ended' | 'expired' | 'abandoned';
export type TestResultInput = { promptIndex: number; status: 'received' | 'timeout' | 'disconnected' | 'failed'; responseText?: string; sentAt?: number; receivedAt?: number; source: 'lk.transcription' | 'transcription' | 'lk.chat' };
export type TestResult = { promptIndex: number; status: TestResultInput['status'] | 'missing'; outcome: 'passed' | 'failed' | 'received' | 'unavailable'; responseText: string | null; sentAt: number | null; receivedAt: number | null; source: TestResultInput['source'] | null; responseDelayMs: number | null; delayBasis: 'browser_observed'; trust: 'untrusted_client' };
export type TestRun = { id: string; agentName: string; scenarioId: string | null; scenarioRevision: number | null; scenario: TestScenario | null; roomName: string; roomSid: string | null; state: TestRunState; createdAt: number; updatedAt: number; expiresAt: number; contentExpiresAt: number; endedAt: number | null; cleanupState: 'pending' | 'complete' | 'failed'; requestedDeployment: RequestedDeployment | null; results: TestResult[]; provenance: ReturnType<typeof nativeProvenance>; telemetry: ReturnType<typeof nativeTelemetry> | null };
type Row = Record<string, any>;
export const agentTestProcessId = randomUUID();
const tables = ['agent_test_scenarios', 'agent_test_runs', 'agent_test_results'] as const;
const MAX_SCENARIOS = 200, MAX_RUNS = 10000;
db.exec(`CREATE TABLE IF NOT EXISTS agent_test_scenarios (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, content TEXT);
 CREATE TABLE IF NOT EXISTS agent_test_runs (
 id TEXT PRIMARY KEY, agent_name TEXT NOT NULL, scenario_id TEXT, scenario_revision INTEGER, room_name TEXT NOT NULL UNIQUE, room_sid TEXT,
 state TEXT NOT NULL, process_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 content_expires_at INTEGER NOT NULL, ended_at INTEGER, cleanup_state TEXT NOT NULL DEFAULT 'pending', content TEXT);
 CREATE INDEX IF NOT EXISTS agent_test_runs_state ON agent_test_runs(state,expires_at);
 CREATE TABLE IF NOT EXISTS agent_test_results (
 run_id TEXT NOT NULL REFERENCES agent_test_runs(id), prompt_index INTEGER NOT NULL, status TEXT NOT NULL, outcome TEXT NOT NULL,
 sent_at INTEGER, received_at INTEGER, source TEXT, response_delay_ms INTEGER, digest TEXT NOT NULL, content TEXT, PRIMARY KEY(run_id,prompt_index));`);

export function object(value: unknown): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentTestError('Expected an object'); return value as Row; }
export function keys(value: Row, allowed: string[]) { if (Object.keys(value).some(k => !allowed.includes(k))) throw new AgentTestError('Unknown field'); }
export function boundedText(value: unknown, label: string, max = 200): string { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new AgentTestError(`Invalid ${label}`); return value; }
const privacyText = (text: string): string => { const policy = getPolicy(); return redactContent({ text }, policy.redaction, policy.redactTerms).text; };
function sanitize<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (!value || typeof value !== 'object') return value;
  const result: Row = {};
  for (const [key, item] of Object.entries(value)) result[key] = ['name', 'text', 'expectedSubstring', 'responseText'].includes(key) && typeof item === 'string' ? privacyText(item) : sanitize(item);
  if ('expectationAvailable' in result && result.expectedSubstring !== (value as Row).expectedSubstring) result.expectationAvailable = false;
  return result as T;
}
const expiry = (at: number) => at + getPolicy().categories.live.retentionDays! * 86400000;
export function scenarioById(id: string): TestScenario {
  const row = db.prepare('SELECT * FROM agent_test_scenarios WHERE id=? AND deleted=0 AND content IS NOT NULL AND expires_at>?').get(id, Date.now()) as Row | undefined;
  if (!row) throw new AgentTestError('Scenario not found or expired', 404);
  return { ...sanitize(JSON.parse(row.content)), id: row.id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at };
}
export function listScenarios() { return db.prepare('SELECT id FROM agent_test_scenarios WHERE deleted=0 AND content IS NOT NULL AND expires_at>? ORDER BY updated_at DESC,id LIMIT 200').all(Date.now()).map(r => scenarioById(r.id as string)); }
export function saveScenario(value: unknown, id?: string): TestScenario {
  const input = object(value); keys(input, ['name', 'prompts']); const old = id ? scenarioById(id) : null;
  const name = input.name === undefined && old ? old.name : boundedText(input.name, 'scenario name');
  const raw = input.prompts === undefined && old ? old.prompts : input.prompts;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw new AgentTestError('Expected 1–20 prompts');
  const prompts = raw.map(p => {
    const v = object(p); keys(v, input.prompts === undefined && old ? ['text', 'expectedSubstring', 'timeoutSeconds', 'expectationAvailable'] : ['text', 'expectedSubstring', 'timeoutSeconds']);
    const text = boundedText(v.text, 'prompt', 4000), expectedSubstring = v.expectedSubstring == null ? null : boundedText(v.expectedSubstring, 'expected substring', 1000);
    if (!Number.isInteger(v.timeoutSeconds) || v.timeoutSeconds < 10 || v.timeoutSeconds > 120) throw new AgentTestError('Timeout must be 10–120 seconds');
    return { text, expectedSubstring, timeoutSeconds: v.timeoutSeconds, expectationAvailable: input.prompts === undefined && old ? v.expectationAvailable : true };
  });
  if (!old && Number(db.prepare('SELECT COUNT(*) n FROM agent_test_scenarios').get()!.n) >= MAX_SCENARIOS) throw new AgentTestError('Scenario storage limit reached', 409);
  const now = Date.now(), scenarioId = id ?? randomUUID(), content = JSON.stringify(sanitize({ name, prompts }));
  db.prepare(`INSERT INTO agent_test_scenarios(id,revision,created_at,updated_at,expires_at,content) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,content=excluded.content`).run(scenarioId, (old?.revision ?? 0) + 1, now, now, expiry(now), content);
  return scenarioById(scenarioId);
}
export function deleteScenario(id: string) { scenarioById(id); db.prepare('UPDATE agent_test_scenarios SET deleted=1,content=NULL WHERE id=?').run(id); }
export function runRow(id: string): Row { const row = db.prepare('SELECT * FROM agent_test_runs WHERE id=?').get(id); if (!row) throw new AgentTestError('Test run not found', 404); return row; }
export function createRun(agentName: string, scenario: TestScenario | null, requestedDeployment: RequestedDeployment | null) {
  if (Number(db.prepare("SELECT COUNT(*) n FROM agent_test_runs WHERE state IN ('creating','active')").get()!.n) >= 5) throw new AgentTestError('At most five active tests are allowed', 409);
  if (Number(db.prepare('SELECT COUNT(*) n FROM agent_test_runs').get()!.n) >= MAX_RUNS) throw new AgentTestError('Run storage limit reached', 409);
  const id = randomUUID(), now = Date.now(), room = 'console-test-' + id;
  const leaseMs = Math.max(30 * 60000, ((scenario?.prompts.reduce((sum, prompt) => sum + prompt.timeoutSeconds, 0) ?? 0) + 120) * 1000);
  db.prepare(`INSERT INTO agent_test_runs(id,agent_name,scenario_id,scenario_revision,room_name,state,process_id,created_at,updated_at,expires_at,content_expires_at,content) VALUES(?,?,?,?,?,'creating',?,?,?,?,?,?)`).run(id, agentName, scenario?.id ?? null, scenario?.revision ?? null, room, agentTestProcessId, now, now, now + leaseMs, expiry(now), JSON.stringify(sanitize({ scenario, requestedDeployment })));
  return runRow(id);
}
export function activateRun(id: string, sid: string) { db.prepare("UPDATE agent_test_runs SET room_sid=?,state=CASE WHEN state='creating' THEN 'active' ELSE state END,updated_at=? WHERE id=?").run(sid, Date.now(), id); }
export function setCleanup(id: string, state: string) { db.prepare('UPDATE agent_test_runs SET cleanup_state=?,updated_at=? WHERE id=?').run(state, Date.now(), id); }
export function failRun(id: string) { db.prepare("UPDATE agent_test_runs SET state='failed',ended_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), id); }
export const isActive = (row: Row) => ['active', 'creating'].includes(row.state);
function nativeJobs(roomSid: string | null): Row[] {
  if (!roomSid) return [];
  return db.prepare(`SELECT job_id,agent_name,participant_sid,worker_id,sdk_version FROM agent_live_jobs WHERE room_sid=? AND expires_at>?
    UNION SELECT job_id,agent_name,participant_sid,worker_id,sdk_version FROM agent_session_reports WHERE room_sid=? AND expires_at>? AND content IS NOT NULL LIMIT 101`).all(roomSid, Date.now(), roomSid, Date.now());
}
function nativeProvenance(row: Row) {
  const actualWorkers = nativeJobs(row.room_sid).filter(j => j.worker_id).map(j => {
    const participant = j.participant_sid ? db.prepare('SELECT attributes FROM participants WHERE room_sid=? AND sid=?').get(row.room_sid, j.participant_sid) : null;
    let attrs: Row = {}; try { attrs = JSON.parse(String(participant?.attributes ?? '{}')); } catch { /* malformed native attributes do not prove version */ }
    const version = (attrs['lk.worker_id'] ?? attrs.worker_id) === j.worker_id ? attrs['lk.worker_version'] ?? attrs.worker_version : null;
    return { jobId: j.job_id as string, agentName: j.agent_name as string, participantSid: j.participant_sid as string | null, workerId: j.worker_id as string, sdkVersion: j.sdk_version as string | null,
      version: typeof version === 'string' && version.length <= 200 ? privacyText(version) : null, evidence: 'room_correlated_native_telemetry' as const, versionEvidence: typeof version === 'string' ? 'server_retrieved_participant_attribute' : null, cryptographicallyVerified: false };
  });
  return { state: actualWorkers.length ? 'server_observed' as const : 'unknown' as const, actualWorkers, requestedDeploymentIsProof: false, clientRecordsAreProof: false };
}
function nativeTelemetry(row: Row) {
  const now = Date.now(), roomSid = row.room_sid;
  const reports = roomSid ? db.prepare('SELECT * FROM agent_session_reports WHERE room_sid=? ORDER BY job_id LIMIT 101').all(roomSid) as Row[] : [];
  const records = roomSid ? db.prepare(`SELECT r.*,j.agent_name FROM agent_live_records r JOIN agent_live_jobs j USING(room_sid,job_id) WHERE r.room_sid=? AND r.expires_at>? AND r.content IS NOT NULL AND r.kind IN ('message','span') LIMIT 10001`).all(roomSid, now) as Row[] : [];
  if (reports.length > 100 || records.length > 10000) throw new AgentTestError('Test telemetry exceeds the measurement budget', 413);
  const inputs: Input[] = [];
  for (const report of reports) if (report.content && report.expires_at > now) {
    const content = JSON.parse(report.content);
    for (const item of content.items ?? []) inputs.push({ kind: 'report', roomSid, jobId: report.job_id, agentName: report.agent_name, itemId: item.id, role: item.role, at: item.at, expiresAt: report.expires_at, receivedAt: report.received_at, metrics: item.metrics ?? {} });
  }
  for (const record of records) { const item = JSON.parse(record.content); inputs.push({ kind: record.kind, roomSid, jobId: record.job_id, agentName: record.agent_name, itemId: record.id, messageId: item.messageId, role: item.role, at: record.at, end: item.end, spanName: item.name, expiresAt: record.expires_at, receivedAt: record.received_at, metrics: item.metrics ?? {} }); }
  const samples = canonicalMeasurements(inputs, now);
  const metrics = Object.keys(METRICS).map(metric => { const values = samples.filter(s => s.metric === metric).map(s => s.valueMs).sort((a, b) => a - b); return { metric, count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95) }; });
  const usage = aggregateAgentUsage(reports.map(r => { const content = r.content && r.expires_at > now ? JSON.parse(r.content) : null; return { roomSid, jobId: r.job_id, reportedAt: r.reported_at, expiresAt: r.expires_at, sessionAvailable: true, retained: !!content, usage: content?.usage ?? null, omittedUsage: content?.omittedUsage ?? 0 }; }), row.created_at, row.ended_at ?? now, null, 1);
  return { basis: 'server_telemetry' as const, metrics, missingMetrics: metrics.filter(m => !m.count).map(m => m.metric), models: usage.models, usageCoverage: usage.coverage, cost: null, costState: 'not_measured' as const };
}
export function readRun(id: string, includeTelemetry = false): TestRun {
  const row = runRow(id), content = row.content && row.content_expires_at > Date.now() ? sanitize(JSON.parse(row.content)) : null;
  const results = db.prepare('SELECT * FROM agent_test_results WHERE run_id=? ORDER BY prompt_index LIMIT 20').all(id).map(r => ({ promptIndex: Number(r.prompt_index), status: r.status, outcome: r.outcome, responseText: content && r.content ? sanitize(JSON.parse(r.content as string)).responseText : null, sentAt: r.sent_at, receivedAt: r.received_at, source: r.source, responseDelayMs: r.response_delay_ms, delayBasis: 'browser_observed', trust: 'untrusted_client' })) as TestResult[];
  return { id: row.id, agentName: row.agent_name, scenarioId: row.scenario_id, scenarioRevision: row.scenario_revision, scenario: content?.scenario ?? null, requestedDeployment: content?.requestedDeployment ?? null, roomName: row.room_name, roomSid: row.room_sid, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at, contentExpiresAt: row.content_expires_at, endedAt: row.ended_at, cleanupState: row.cleanup_state, results, provenance: nativeProvenance(row), telemetry: includeTelemetry ? nativeTelemetry(row) : null };
}
export function listRuns(limit = 50, offset = 0) { return db.prepare('SELECT id FROM agent_test_runs ORDER BY created_at DESC,id LIMIT ? OFFSET ?').all(limit, offset).map(r => readRun(r.id as string)); }
function timestamp(value: unknown, row: Row): number | null { if (value === undefined) return null; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < row.created_at - 60000 || value > Date.now() + 60000) throw new AgentTestError('Invalid client timestamp'); return value; }
export function saveResults(id: string, value: unknown) {
  const row = runRow(id), body = object(value); keys(body, ['results']);
  if (row.state !== 'active' || row.expires_at <= Date.now() || !row.content || row.content_expires_at <= Date.now()) throw new AgentTestError('Run is not active or content was deleted', 409);
  const scenario = JSON.parse(row.content).scenario as TestScenario | null;
  if (!scenario) throw new AgentTestError('Prompt results require a scenario', 409);
  if (!Array.isArray(body.results) || !body.results.length || body.results.length > 20) throw new AgentTestError('Expected 1–20 results');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const raw of body.results) {
      const v = object(raw); keys(v, ['promptIndex', 'status', 'responseText', 'sentAt', 'receivedAt', 'source']);
      const index = v.promptIndex;
      if (!Number.isInteger(index) || index < 0 || index >= scenario.prompts.length) throw new AgentTestError('Invalid prompt index');
      if (!['received', 'timeout', 'disconnected', 'failed'].includes(v.status) || !['lk.transcription', 'transcription', 'lk.chat'].includes(v.source)) throw new AgentTestError('Invalid result status/source');
      const responseText = v.responseText === undefined ? null : boundedText(v.responseText, 'response text', 16000);
      const sentAt = timestamp(v.sentAt, row), receivedAt = timestamp(v.receivedAt, row);
      if (receivedAt !== null && (sentAt === null || receivedAt < sentAt)) throw new AgentTestError('Response precedes prompt');
      if (v.status === 'received' && (!responseText || sentAt === null || receivedAt === null)) throw new AgentTestError('Received results require text and timestamps');
      const prompt = scenario.prompts[index];
      if (v.status === 'received' && receivedAt! - sentAt! > prompt.timeoutSeconds * 1000) throw new AgentTestError('Response exceeded prompt timeout');
      const outcome = v.status !== 'received' ? 'failed' : !prompt.expectedSubstring ? 'received' : !prompt.expectationAvailable ? 'unavailable' : responseText!.toLowerCase().includes(prompt.expectedSubstring.toLowerCase()) ? 'passed' : 'failed';
      const normalized = { promptIndex: index, status: v.status, responseText, sentAt, receivedAt, source: v.source }, digest = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
      const old = db.prepare('SELECT digest FROM agent_test_results WHERE run_id=? AND prompt_index=?').get(id, index);
      if (old) { if (old.digest !== digest) throw new AgentTestError('Conflicting result for prompt', 409); continue; }
      const count = Number(db.prepare('SELECT COUNT(*) n FROM agent_test_results WHERE run_id=?').get(id)!.n);
      if (index !== count) throw new AgentTestError('Results must be sequential', 409);
      db.prepare('INSERT INTO agent_test_results VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, index, v.status, outcome, sentAt, receivedAt, v.source, v.status === 'received' ? receivedAt! - sentAt! : null, digest, JSON.stringify(sanitize({ responseText })));
    }
    db.prepare('UPDATE agent_test_runs SET updated_at=? WHERE id=?').run(Date.now(), id); db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function endRun(id: string) {
  const row = runRow(id); if (!isActive(row)) return;
  const scenario = row.content ? JSON.parse(row.content).scenario as TestScenario | null : null;
  if (scenario) for (let index = 0; index < scenario.prompts.length; index++) db.prepare("INSERT OR IGNORE INTO agent_test_results(run_id,prompt_index,status,outcome,digest) VALUES(?,?,'missing','failed','missing')").run(id, index);
  const failed = db.prepare("SELECT 1 FROM agent_test_results WHERE run_id=? AND outcome IN ('failed','unavailable') LIMIT 1").get(id);
  db.prepare('UPDATE agent_test_runs SET state=?,ended_at=?,updated_at=? WHERE id=?').run(row.scenario_id ? !scenario || failed ? 'failed' : 'completed' : 'ended', Date.now(), Date.now(), id);
}
export function maintainAgentTestContent(at = Date.now()) {
  const duration = getPolicy().categories.live.retentionDays! * 86400000;
  db.prepare('UPDATE agent_test_scenarios SET expires_at=MIN(expires_at,created_at+?)').run(duration);
  db.prepare('UPDATE agent_test_runs SET content_expires_at=MIN(content_expires_at,created_at+?)').run(duration);
  db.prepare('UPDATE agent_test_scenarios SET content=NULL WHERE expires_at<=?').run(at);
  db.prepare('UPDATE agent_test_results SET content=NULL WHERE run_id IN (SELECT id FROM agent_test_runs WHERE content_expires_at<=?)').run(at);
  db.prepare('UPDATE agent_test_runs SET content=NULL WHERE content_expires_at<=?').run(at);
  // A previous process cannot safely resume a browser session or replay dispatch.
  db.prepare("UPDATE agent_test_runs SET state=CASE WHEN expires_at<=? THEN 'expired' ELSE 'abandoned' END,ended_at=?,updated_at=? WHERE state IN ('creating','active') AND (expires_at<=? OR process_id!=?)").run(at, at, at, at, agentTestProcessId);
}
export function pendingCleanup(): Row[] { return db.prepare("SELECT * FROM agent_test_runs WHERE state NOT IN ('creating','active') AND cleanup_state!='complete' ORDER BY updated_at LIMIT 100").all(); }
export function scrubAgentTestContent(_at = Date.now()) {
  for (const table of tables) for (const row of db.prepare(`SELECT rowid,content FROM ${table} WHERE content IS NOT NULL`).iterate()) db.prepare(`UPDATE ${table} SET content=? WHERE rowid=?`).run(JSON.stringify(sanitize(JSON.parse(row.content as string))), row.rowid!);
}
export function agentTestStorage() { const counts: Record<string, number> = {}; for (const table of tables) counts[table] = Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n); return { rows: Object.values(counts).reduce((a, b) => a + b, 0), tables: counts }; }
export function deleteAgentTestContent() {
  const counts: Record<string, number> = {}, at = Date.now();
  for (const table of tables) counts[table] = Number(db.prepare(`UPDATE ${table} SET content=NULL WHERE content IS NOT NULL`).run().changes);
  db.prepare('UPDATE agent_test_runs SET content_expires_at=MIN(content_expires_at,?)').run(at);
  db.prepare('UPDATE agent_test_scenarios SET expires_at=MIN(expires_at,?),deleted=1').run(at);
  db.prepare("UPDATE agent_test_runs SET state='abandoned',ended_at=?,updated_at=? WHERE state IN ('creating','active')").run(at, at);
  return { rows: Object.values(counts).reduce((a, b) => a + b, 0), tables: counts };
}
export function exportAgentTestContent(content: boolean, limits = { maxRows: 10000, maxBytes: 8 * 1024 * 1024 }): { tables: Record<string, unknown[]>; rows: number } {
  maintainAgentTestContent();
  const projections = content ? { agent_test_scenarios: 'id,revision,created_at,updated_at,expires_at,deleted,content', agent_test_runs: 'id,agent_name,scenario_id,scenario_revision,room_name,room_sid,state,created_at,updated_at,expires_at,content_expires_at,ended_at,cleanup_state,content', agent_test_results: 'run_id,prompt_index,status,outcome,sent_at,received_at,source,response_delay_ms,content' } : { agent_test_scenarios: 'revision,created_at,updated_at,expires_at,deleted', agent_test_runs: 'state,created_at,updated_at,expires_at,content_expires_at,ended_at,cleanup_state', agent_test_results: 'prompt_index,status,outcome,sent_at,received_at,response_delay_ms' };
  let rows = 0, bytes = 0;
  for (const table of tables) {
    const sizes = projections[table].split(',').map(column => `COALESCE(length(CAST(${column} AS BLOB)),4)+64`).join('+');
    const totals = db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(${sizes}),0) bytes FROM ${table}`).get()!; rows += Number(totals.n); bytes += Number(totals.bytes) * 6;
    if (rows > limits.maxRows || bytes > limits.maxBytes) throw new AgentTestError('Test export exceeds row or byte budget', 413);
  }
  const output: Record<string, unknown[]> = {};
  for (const table of tables) output[table] = db.prepare(`SELECT ${projections[table]} FROM ${table}`).all().map(row => ({ ...row, ...('content' in row ? { content: row.content ? sanitize(JSON.parse(row.content as string)) : null } : {}) }));
  if (Buffer.byteLength(JSON.stringify(output)) > limits.maxBytes) throw new AgentTestError('Test export exceeds byte budget', 413);
  return { tables: output, rows };
}
