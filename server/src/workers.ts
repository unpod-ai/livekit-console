import { config } from './config.js';
import { db } from './db.js';

/**
 * Agent workers report on themselves: the LiveKit Agents framework runs a small HTTP server in every worker
 * (port 8081 by default). `/` answers 200 while the worker is healthy, and `/worker` returns its name, load,
 * active job count and SDK version. Polling that gives Cloud-style RUNNING status without sending any test jobs.
 */
export type WorkerStatus = {
  url: string;
  ok: boolean;
  agentName: string | null;
  workerType: string | null;
  load: number | null; // 0..1
  activeJobs: number | null;
  sdkVersion: string | null;
  projectType: string | null;
  latencyMs: number | null;
  checkedAt: number;
  error: string | null;
};

const TIMEOUT_MS = 3000;
let latest: WorkerStatus[] = [];
const knownNames = new Map<string, string>(); // so a worker that goes down keeps its agent name

const insert = db.prepare('INSERT INTO agent_worker_samples (url, agent_name, at, ok, load, active_jobs, latency_ms) VALUES (?,?,?,?,?,?,?)');

async function probe(url: string): Promise<WorkerStatus> {
  const started = Date.now();
  const status: WorkerStatus = { url, ok: false, agentName: knownNames.get(url) ?? null, workerType: null, load: null, activeJobs: null, sdkVersion: null, projectType: null, latencyMs: null, checkedAt: started, error: null };
  try {
    const [health, info] = await Promise.all([fetch(`${url}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) }), fetch(`${url}/worker`, { signal: AbortSignal.timeout(TIMEOUT_MS) })]);
    const j = info.ok ? ((await info.json()) as Record<string, unknown>) : null;
    if (j && typeof j.agent_name === 'string') knownNames.set(url, j.agent_name);
    return {
      ...status,
      ok: health.ok,
      agentName: (j?.agent_name as string | undefined) ?? status.agentName,
      workerType: (j?.worker_type as string | undefined) ?? null,
      load: typeof j?.worker_load === 'number' ? j.worker_load : null,
      activeJobs: typeof j?.active_jobs === 'number' ? j.active_jobs : null,
      sdkVersion: (j?.sdk_version as string | undefined) ?? null,
      projectType: (j?.project_type as string | undefined) ?? null,
      latencyMs: Date.now() - started,
      error: health.ok ? null : `status endpoint answered ${health.status}`,
    };
  } catch (err) {
    return { ...status, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function pollWorkers(): Promise<void> {
  latest = await Promise.all(config.workerUrls.map(probe));
  for (const w of latest) insert.run(w.url, w.agentName, w.checkedAt, w.ok ? 1 : 0, w.load, w.activeJobs, w.latencyMs);
}

export const workerStatuses = (): WorkerStatus[] => latest;

export function startWorkerPolling(): void {
  if (!config.workerUrls.length) return;
  const run = () => pollWorkers().catch((err) => console.error('worker poll failed', err));
  run();
  setInterval(run, 10_000).unref();
  // keep two weeks of samples; that is plenty for uptime/load over the longest range shown
  setInterval(() => db.prepare('DELETE FROM agent_worker_samples WHERE at < ?').run(Date.now() - 14 * 86400_000), 6 * 3600_000).unref();
}
