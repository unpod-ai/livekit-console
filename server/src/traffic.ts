import { config } from './config.js';
import { db } from './db.js';

/**
 * GitHub only keeps 14 days of clone/view traffic, so this copies it into the console's database on a schedule
 * (every hour, since GitHub updates today's counts through the day; overlapping days are overwritten with the latest numbers). Needs GITHUB_TOKEN with push access.
 */
const KINDS = ['clones', 'views'] as const;
type Day = { timestamp: string; count: number; uniques: number };

let lastSyncAt: number | null = null;
let lastError: string | null = null;

const upsert = db.prepare(
  'INSERT INTO repo_traffic (day, kind, count, uniques) VALUES (?,?,?,?) ON CONFLICT(day, kind) DO UPDATE SET count = excluded.count, uniques = excluded.uniques',
);

export async function syncTraffic(): Promise<void> {
  if (!config.githubToken) return;
  try {
    for (const kind of KINDS) {
      const res = await fetch(`https://api.github.com/repos/${config.githubRepo}/traffic/${kind}`, {
        headers: { Authorization: `Bearer ${config.githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`GitHub ${kind}: ${res.status} ${(await res.text()).slice(0, 120)}`);
      const body = (await res.json()) as Record<string, Day[]>;
      for (const d of body[kind] ?? []) upsert.run(Date.parse(d.timestamp), kind, d.count, d.uniques);
    }
    lastSyncAt = Date.now();
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error('traffic sync failed:', lastError);
  }
}

export const trafficState = () => ({ configured: !!config.githubToken, repo: config.githubRepo, lastSyncAt, lastError });

export function startTrafficSync(): void {
  if (!config.githubToken) return;
  void syncTraffic();
  setInterval(() => void syncTraffic(), 3600_000).unref();
}
