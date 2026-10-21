import { recordCollector, workerSource } from './operations-observability.js';
import { config } from './config.js';
import { inventoryWorkerRows, lastWorkerObservation, pruneInventory, recordWorkerObservation, syncInventory, type Observation } from './inventory-store.js';

export type WorkerStatus = Observation & {
 workerId: string | null; workerType: string | null; load: number | null; activeJobs: number | null;
 sdkVersion: string | null; projectType: string | null; latencyMs: number | null; error: string | null;
};
const TIMEOUT_MS = 3000;
const INFO_MAX_BYTES = 65536;
const textField = (v: unknown): string | null => typeof v === 'string' && v.length <= 512 && !/[\x00-\x1f]/.test(v) ? v : null;
const finite = (v: unknown, max = Infinity): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
async function workerInfo(response: Response): Promise<Record<string, unknown>> {
 if (!response.ok) throw new Error(`worker info answered ${response.status}`);
 if (Number(response.headers.get('content-length')) > INFO_MAX_BYTES) { await response.body?.cancel(); throw new Error('Worker info exceeds size limit'); }
 const reader = response.body?.getReader();
 if (!reader) throw new Error('Worker info is empty');
 let size = 0; const chunks: Uint8Array[] = [];
 try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > INFO_MAX_BYTES) throw new Error('Worker info exceeds size limit'); chunks.push(value); } }
 finally { await reader.cancel().catch(() => {}); }
 const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid worker info');
 if (parsed.agent_name !== undefined && (!textField(parsed.agent_name) || !parsed.agent_name.trim())) throw new Error('Invalid agent name');
 for (const field of ['worker_load', 'active_jobs']) if (parsed[field] !== undefined && (finite(parsed[field], field === 'worker_load' ? 1 : Number.MAX_SAFE_INTEGER) === null || field === 'active_jobs' && !Number.isInteger(parsed[field]))) throw new Error(`Invalid ${field}`);
 for (const field of ['worker_type', 'sdk_version', 'project_type']) if (parsed[field] !== undefined && textField(parsed[field]) === null) throw new Error(`Invalid ${field}`);
 return parsed;
}
async function probe(url: string): Promise<WorkerStatus> {
 const started = Date.now(); const prior = lastWorkerObservation(url);
 const result: WorkerStatus = { url, ok: false, agentName: prior?.observed_name ?? null, workerId: null, workerType: null, load: null, activeJobs: null, sdkVersion: null, projectType: null, latencyMs: null, checkedAt: started, error: null, infoAvailable: false, registrationState: 'unknown', readiness: 'unknown' };
 const [health, info] = await Promise.allSettled([
  fetch(`${url}/`, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' }).then(async r => { await r.body?.cancel(); return r; }),
  fetch(`${url}/worker`, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' }).then(workerInfo),
 ]);
 const errors: string[] = [];
 if (health.status === 'fulfilled') { result.ok = health.value.ok; if (!result.ok) errors.push(`status endpoint answered ${health.value.status}`); }
 else errors.push('Status endpoint unavailable');
 if (info.status === 'fulfilled') {
  const j = info.value; const id = textField(j.worker_id) ?? textField(j.id);
  Object.assign(result, { infoAvailable: true, agentName: textField(j.agent_name) ?? result.agentName, workerId: id && /^AW_[A-Za-z0-9_-]+$/.test(id) ? id : null, workerType: textField(j.worker_type), load: finite(j.worker_load, 1), activeJobs: finite(j.active_jobs, Number.MAX_SAFE_INTEGER), sdkVersion: textField(j.sdk_version), projectType: textField(j.project_type) });
  if (typeof j.registered === 'boolean') result.registrationState = j.registered ? 'registered' : 'unregistered';
  if (typeof j.ready === 'boolean') result.readiness = j.ready ? 'ready' : 'not_ready';
 } else errors.push('Worker info unavailable');
 result.error = errors.length ? errors.join('; ') : null; result.latencyMs = Date.now() - started;
 return result;
}
let running: Promise<void> | null = null;
export function pollWorkers(): Promise<void> {
 if (running) return running;
 running = (async () => {
  syncInventory();
  const observations = await Promise.all(config.workerUrls.map(probe));
  for (const observation of observations) {
   recordWorkerObservation(observation);
   recordCollector(workerSource(observation.url),{ok:observation.ok,...(!observation.ok?{error:'upstream' as const}:{})});
  }
 })().finally(() => { running = null; });
 return running;
}
export const workerStatuses = (): WorkerStatus[] => inventoryWorkerRows(24).workers;
let started = false;
export function startWorkerPolling(): void {
 if (started) return; started = true;
 syncInventory(); pruneInventory();
 const run = () => pollWorkers().catch(() => console.error('worker poll failed'));
 run(); setInterval(run, 10_000).unref();
 setInterval(() => pruneInventory(), 6 * 3600_000).unref();
}
