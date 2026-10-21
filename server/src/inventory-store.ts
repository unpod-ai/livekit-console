import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config, type WorkerMetadata } from './config.js';

const HOUR = 3600_000;
export type Agent = { id: string; name: string; aliases: string[]; firstSeenAt: number; lastSeenAt: number };
export type Observation = {
 url: string; agentName: string | null; workerId?: string | null; ok: boolean; checkedAt: number;
 workerType?: string | null; load?: number | null; activeJobs?: number | null; sdkVersion?: string | null;
 projectType?: string | null; latencyMs?: number | null; error?: string | null; infoAvailable?: boolean;
 registrationState?: string; readiness?: string; lastInfoAt?: number | null; lastSeenAt?: number | null; metadata?: WorkerMetadata;
};
type Worker = { id: string; agent_id: string | null; url: string; observed_name: string | null; native_id: string | null; marker: string; first_seen: number; last_seen: number; last_ok: number | null; native_at: number | null; archived_reason: string | null; snapshot: string; metadata: string };
db.exec(`
 CREATE TABLE IF NOT EXISTS inventory_agents(id TEXT PRIMARY KEY,name TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,redirect_id TEXT);
 CREATE TABLE IF NOT EXISTS inventory_aliases(name TEXT PRIMARY KEY,agent_id TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS inventory_alias_agent ON inventory_aliases(agent_id);
 CREATE TABLE IF NOT EXISTS inventory_workers(id TEXT PRIMARY KEY,agent_id TEXT,url TEXT NOT NULL,observed_name TEXT,native_id TEXT,marker TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,last_ok INTEGER,native_at INTEGER,archived_reason TEXT,snapshot TEXT NOT NULL,metadata TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS inventory_workers_agent ON inventory_workers(agent_id);
 CREATE INDEX IF NOT EXISTS inventory_workers_url ON inventory_workers(url,last_seen);
 CREATE TABLE IF NOT EXISTS inventory_rollups(worker_id TEXT NOT NULL,hour INTEGER NOT NULL,samples INTEGER NOT NULL,up INTEGER NOT NULL,load_sum REAL NOT NULL,load_count INTEGER NOT NULL,PRIMARY KEY(worker_id,hour));
 CREATE INDEX IF NOT EXISTS inventory_rollups_hour ON inventory_rollups(hour);
 CREATE INDEX IF NOT EXISTS inventory_live_worker ON agent_live_jobs(worker_id);
 CREATE INDEX IF NOT EXISTS inventory_report_worker ON agent_session_reports(worker_id);
 CREATE TABLE IF NOT EXISTS inventory_migrations(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
`);
const cols = db.prepare('PRAGMA table_info(agent_worker_samples)').all().map(r => r.name);
if (!cols.includes('inventory_info')) db.exec('ALTER TABLE agent_worker_samples ADD COLUMN inventory_info TEXT');
function transaction<T>(fn: () => T): T {
 db.exec('BEGIN IMMEDIATE');
 try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function agentObject(row: Record<string, any>): Agent {
 return { id: row.id, name: row.name, aliases: db.prepare('SELECT name FROM inventory_aliases WHERE agent_id=? ORDER BY name').all(row.id).map(r => String(r.name)), firstSeenAt: row.first_seen, lastSeenAt: row.last_seen };
}
export function resolveAgent(ref: string): Agent | null {
 let row = db.prepare('SELECT * FROM inventory_agents WHERE id=?').get(ref);
 if (!row) row = db.prepare('SELECT a.* FROM inventory_agents a JOIN inventory_aliases n ON n.agent_id=a.id WHERE n.name=?').get(ref);
 const seen = new Set<string>();
 while (row?.redirect_id) { if (seen.has(String(row.id))) throw new Error('Agent redirect cycle'); seen.add(String(row.id)); row = db.prepare('SELECT * FROM inventory_agents WHERE id=?').get(row.redirect_id); }
 return row ? agentObject(row) : null;
}
function resolveName(name: string): Agent | null {
 const alias = db.prepare('SELECT agent_id FROM inventory_aliases WHERE name=?').get(name);
 return alias ? resolveAgent(String(alias.agent_id)) : null;
}
function validName(name: unknown): asserts name is string {
 if (typeof name !== 'string' || !name.trim() || name.length > 512 || /[\x00-\x1f]/.test(name)) throw new Error('Invalid agent name');
}
export function ensureAgentName(name: string, at = Date.now()): Agent {
 validName(name);
 let agent = resolveName(name);
 if (!agent) {
  const id = 'CA_' + randomUUID();
  db.prepare('INSERT INTO inventory_agents VALUES(?,?,?,?,NULL)').run(id, name, at, at);
  db.prepare('INSERT INTO inventory_aliases VALUES(?,?)').run(name, id);
  agent = resolveAgent(id)!;
 } else db.prepare('UPDATE inventory_agents SET first_seen=MIN(first_seen,?),last_seen=MAX(last_seen,?) WHERE id=?').run(at, at, agent.id);
 return resolveAgent(agent.id)!;
}
export function agentAliases(ref: string): string[] { return resolveAgent(ref)?.aliases ?? [ref]; }
export function listAgents(): Agent[] { return db.prepare('SELECT * FROM inventory_agents WHERE redirect_id IS NULL ORDER BY name').all().map(agentObject); }
export function linkAgentAlias(ref: string, input: { name: string; mergeAgentId?: string; makeCanonical?: boolean }): Agent {
 validName(input.name);
 return transaction(() => {
  const target = resolveAgent(ref); if (!target) throw new Error('Agent not found');
  const source = resolveName(input.name);
  if (source && source.id !== target.id) {
   if (input.mergeAgentId !== source.id) throw new Error('Alias belongs to another agent; exact mergeAgentId required');
   db.prepare('UPDATE inventory_aliases SET agent_id=? WHERE agent_id=?').run(target.id, source.id);
   db.prepare('UPDATE inventory_workers SET agent_id=? WHERE agent_id=?').run(target.id, source.id);
   db.prepare('UPDATE inventory_agents SET redirect_id=? WHERE id=?').run(target.id, source.id);
   db.prepare('UPDATE inventory_agents SET first_seen=MIN(first_seen,?),last_seen=MAX(last_seen,?) WHERE id=?').run(source.firstSeenAt, source.lastSeenAt, target.id);
  } else if (input.mergeAgentId && input.mergeAgentId !== source?.id) throw new Error('mergeAgentId does not match alias owner');
  db.prepare('INSERT OR IGNORE INTO inventory_aliases VALUES(?,?)').run(input.name, target.id);
  if (input.makeCanonical) db.prepare('UPDATE inventory_agents SET name=? WHERE id=?').run(input.name, target.id);
  return resolveAgent(target.id)!;
 });
}
export function lastWorkerObservation(url: string): Worker | undefined {
 return db.prepare('SELECT * FROM inventory_workers WHERE url=? ORDER BY last_seen DESC,rowid DESC LIMIT 1').get(url) as Worker | undefined;
}
function applyObservation(o: Observation): void {
 const prior = lastWorkerObservation(o.url);
 const name = o.agentName ?? prior?.observed_name ?? null;
 const agent = name ? ensureAgentName(name, o.checkedAt) : null;
 const metadata = o.metadata ?? {};
 const marker = metadata.instanceKey ?? '';
 const priorSnapshot = prior ? JSON.parse(prior.snapshot) as Observation : null;
 const native = typeof o.workerId === 'string' && /^AW_[A-Za-z0-9_-]+$/.test(o.workerId) ? o.workerId : null;
 // Missing native ID is an observation gap, not evidence of a new process.
 const same = prior && prior.agent_id === (agent?.id ?? null) && prior.marker === marker && (!native || prior.native_id === native) && !prior.archived_reason;
 o.lastInfoAt = o.infoAvailable ? o.checkedAt : same ? priorSnapshot?.lastInfoAt ?? null : null;
 o.lastSeenAt = o.ok || o.infoAvailable ? o.checkedAt : same ? priorSnapshot?.lastSeenAt ?? null : null;
 const id = same ? prior.id : 'CW_' + randomUUID();
 if (!same) {
  if (prior && !prior.archived_reason) db.prepare('UPDATE inventory_workers SET archived_reason=? WHERE id=?').run(prior.agent_id !== agent?.id ? 'agent_changed' : prior.marker !== marker ? 'deployment_changed' : 'native_id_changed', prior.id);
  db.prepare('INSERT INTO inventory_workers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, agent?.id ?? null, o.url, name, native, marker, o.checkedAt, o.checkedAt, o.ok ? o.checkedAt : null, native ? o.checkedAt : null, null, JSON.stringify(o), JSON.stringify(metadata));
 } else {
  db.prepare('UPDATE inventory_workers SET last_seen=?,last_ok=CASE WHEN ? THEN ? ELSE last_ok END,native_at=CASE WHEN ? THEN ? ELSE native_at END,snapshot=?,metadata=?,observed_name=? WHERE id=?').run(o.checkedAt, o.ok ? 1 : 0, o.checkedAt, native ? 1 : 0, o.checkedAt, JSON.stringify(o), JSON.stringify(metadata), name, id);
 }
 const load = typeof o.load === 'number' && Number.isFinite(o.load) && o.load >= 0 && o.load <= 1 ? o.load : null;
 db.prepare(`INSERT INTO inventory_rollups VALUES(?,?,?,?,?,?) ON CONFLICT(worker_id,hour) DO UPDATE SET samples=samples+1,up=up+excluded.up,load_sum=load_sum+excluded.load_sum,load_count=load_count+excluded.load_count`).run(id, Math.floor(o.checkedAt / HOUR) * HOUR, 1, o.ok ? 1 : 0, load ?? 0, load === null ? 0 : 1);
}
function migrateSamples(): void {
 const cursor = Number(db.prepare("SELECT value FROM inventory_migrations WHERE key='samples'").get()?.value ?? 0);
 const rows = db.prepare('SELECT * FROM agent_worker_samples WHERE id>? ORDER BY at,id').all(cursor);
 let max = cursor;
 for (const r of rows) {
  const info = r.inventory_info ? JSON.parse(String(r.inventory_info)) : {};
  applyObservation({ url: String(r.url), agentName: r.agent_name as string | null, checkedAt: Number(r.at), ok: !!r.ok, load: r.load as number | null, activeJobs: r.active_jobs as number | null, workerType: r.worker_type as string | null, sdkVersion: r.sdk_version as string | null, projectType: r.project_type as string | null, ...info });
  max = Math.max(max, Number(r.id));
 }
 db.prepare("INSERT INTO inventory_migrations VALUES('samples',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(max);
}
export function recordWorkerObservation(o: Observation): void {
 transaction(() => {
  o = { ...o, metadata: config.workerMetadata[o.url] ?? {} };
  db.prepare('INSERT INTO agent_worker_samples(url,agent_name,at,ok,load,active_jobs,latency_ms,worker_type,sdk_version,project_type,inventory_info) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(o.url, o.agentName, o.checkedAt, o.ok ? 1 : 0, o.load ?? null, o.activeJobs ?? null, o.latencyMs ?? null, o.workerType ?? null, o.sdkVersion ?? null, o.projectType ?? null, JSON.stringify(o));
  migrateSamples();
 });
}
export function syncInventory(): void {
 transaction(() => {
  migrateSamples();
  for (const r of db.prepare(`SELECT agent_name name,MIN(reported_at) first,MAX(reported_at) last FROM agent_session_reports GROUP BY agent_name UNION ALL SELECT agent_name,MIN(first_received),MAX(last_received) FROM agent_live_jobs GROUP BY agent_name UNION ALL SELECT COALESCE(json_extract(attributes,'$."lk.agent.name"'),json_extract(attributes,'$."lk.agent_name"'),json_extract(attributes,'$."agent.name"')),MIN(joined_at),MAX(joined_at) FROM participants WHERE kind IN ('AGENT','4') AND json_valid(attributes) AND COALESCE(json_extract(attributes,'$."lk.agent.name"'),json_extract(attributes,'$."lk.agent_name"'),json_extract(attributes,'$."agent.name"')) IS NOT NULL GROUP BY 1`).all()) {
   if (typeof r.name === 'string' && r.name.trim()) { ensureAgentName(r.name, Number(r.first)); ensureAgentName(r.name, Number(r.last)); }
  }
  for (const w of db.prepare('SELECT id,url FROM inventory_workers WHERE archived_reason IS NULL').all()) if (!config.workerUrls.includes(String(w.url))) db.prepare("UPDATE inventory_workers SET archived_reason='endpoint_removed' WHERE id=?").run(w.id);
 });
}
export function pruneInventory(at = Date.now()): void {
 db.prepare('DELETE FROM inventory_rollups WHERE hour < ?').run(Math.floor((at - config.workerRollupRetentionDays * 86400_000) / HOUR) * HOUR);
 db.prepare('DELETE FROM agent_worker_samples WHERE at < ?').run(at - 14 * 86400_000);
}
function windowBounds(days: number) {
 const now = Date.now();
 return { from: Math.floor((now - days * 24 * HOUR) / HOUR) * HOUR, to: Math.floor(now / HOUR) * HOUR + HOUR };
}
export function workerRollups(ref: string, days = 365) {
 const { from, to } = windowBounds(days);
 const agent = resolveAgent(ref);
 const rows = agent ? db.prepare('SELECT r.hour t,SUM(r.samples) samples,SUM(r.up) up,SUM(r.load_sum) loadSum,SUM(r.load_count) loadCount FROM inventory_rollups r JOIN inventory_workers w ON w.id=r.worker_id WHERE w.agent_id=? AND r.hour>=? AND r.hour<? GROUP BY r.hour ORDER BY r.hour').all(agent.id, from, to) : [];
 return { series: rows.map(r => ({ t: Number(r.t), samples: Number(r.samples), up: Number(r.up), loadSum: Number(r.loadSum), loadCount: Number(r.loadCount), uptimePct: Number(r.up) / Number(r.samples) * 100, avgLoadPct: Number(r.loadCount) ? Number(r.loadSum) / Number(r.loadCount) * 100 : null })), from, to, retentionDays: config.workerRollupRetentionDays, resolutionMs: HOUR, availabilityBasis: 'sampled_endpoint_checks' };
}
export function inventoryWorkerRows(hours: number, agentRef?: string) {
 syncInventory();
 const agent = agentRef ? resolveAgent(agentRef) : null;
 const { from, to } = windowBounds(hours / 24);
 const rows = (agentRef ? agent ? db.prepare('SELECT * FROM inventory_workers WHERE agent_id=? ORDER BY last_seen DESC').all(agent.id) : [] : db.prepare('SELECT * FROM inventory_workers ORDER BY last_seen DESC').all()) as Worker[];
 const mapped = rows.map(w => {
  const o = JSON.parse(w.snapshot) as Observation;
  const totals = db.prepare('SELECT SUM(samples) samples,SUM(up) up,SUM(load_sum) loadSum,SUM(load_count) loadCount FROM inventory_rollups WHERE worker_id=? AND hour>=? AND hour<?').get(w.id, from, to)!;
  const stale = Date.now() - w.last_seen > 30_000;
  return { url: w.url, ok: !w.archived_reason && !stale && o.ok, agentName: w.agent_id ? resolveAgent(w.agent_id)?.name ?? w.observed_name : w.observed_name,
   workerId: o.workerId && /^AW_[A-Za-z0-9_-]+$/.test(o.workerId) ? o.workerId : null, workerType: o.workerType ?? null, load: o.load ?? null, activeJobs: o.activeJobs ?? null, sdkVersion: o.sdkVersion ?? null, projectType: o.projectType ?? null, latencyMs: o.latencyMs ?? null, checkedAt: w.last_seen, error: o.error ?? null,
   uptimePct: Number(totals.samples) ? Number(totals.up) / Number(totals.samples) * 100 : null, avgLoadPct: Number(totals.loadCount) ? Number(totals.loadSum) / Number(totals.loadCount) * 100 : null, outages: [], failedChecks: Number(totals.samples) - Number(totals.up), samples: Number(totals.samples),
   firstSeenAt: w.first_seen, lastOkAt: w.last_ok, lastCheckedAt: w.last_seen, lastSeenAt: o.lastSeenAt ?? null, lastInfoAt: o.lastInfoAt ?? null, consoleWorkerId: w.id, agentId: w.agent_id, observedAgentName: w.observed_name,
   state: w.archived_reason ? 'archived' : stale ? 'stale' : o.ok ? 'healthy' : 'unhealthy', identityBasis: w.native_id ? 'native_worker_id' : w.marker ? 'configured_instance' : 'endpoint_observation', nativeIdLastReportedAt: w.native_at, lastReportedWorkerId: w.native_id,
   infoAvailable: o.infoAvailable ?? false, registrationState: o.registrationState ?? 'unknown', readiness: o.readiness ?? 'unknown', metadata: JSON.parse(w.metadata), archivedReason: w.archived_reason, reason: w.archived_reason,
  };
 });
 return { configured: config.workerUrls.length > 0, workers: mapped.filter(w => !w.archivedReason), former: mapped.filter(w => !!w.archivedReason) };
}
export function agentWorkerJobs(ref: string) {
 const agent = resolveAgent(ref); if (!agent) return [];
 return db.prepare(`WITH known AS (SELECT id,native_id FROM inventory_workers WHERE agent_id=? AND native_id IS NOT NULL),
 links AS (
  SELECT w.id consoleWorkerId,w.native_id workerId,j.room_sid roomSid,j.job_id jobId,j.agent_name agentName,j.participant_sid participantSid,j.sdk_version sdkVersion
  FROM known w JOIN agent_live_jobs j ON j.worker_id=w.native_id WHERE j.agent_name IN (SELECT name FROM inventory_aliases WHERE agent_id=?)
  UNION
  SELECT w.id,w.native_id,j.room_sid,j.job_id,j.agent_name,j.participant_sid,j.sdk_version
  FROM known w JOIN agent_session_reports j ON j.worker_id=w.native_id WHERE j.agent_name IN (SELECT name FROM inventory_aliases WHERE agent_id=?)
 ) SELECT * FROM links ORDER BY roomSid,jobId,consoleWorkerId LIMIT 201`).all(agent.id, agent.id, agent.id);
}
