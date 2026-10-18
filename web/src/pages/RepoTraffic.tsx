import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { BarsChart, PALETTE } from '../components/Charts';
import { Dropdown } from '../components/Dropdown';
import { Alert, Kpi, Kpis, PageHeader, Panel, errText } from '../components/ui';
import { fromMs } from '../lib/format';

// The repository is a different thing from the project, so it has its own range instead of the global one.
const DAY = 86400000;
const OPTIONS: [number, string][] = [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days'], [60, 'Last 2 months'], [90, 'Last 3 months'], [180, 'Last 6 months'], [365, 'Last year'], [0, 'All time']];
const KEY = 'lkc.repoRange';
const FIELDS = ['clones', 'uniqueCloners', 'views', 'uniqueVisitors'] as const;

/** Longer ranges are grouped so the bars stay readable: days up to 3 months, then weeks, then months. */
function bucketise(rows: Json[], days: number): { rows: Json[]; bucketMs: number; unit: string } {
  if (days <= 90) return { rows, bucketMs: DAY, unit: 'day' };
  const monthly = days > 365 || days === 0;
  const start = (t: number) => (monthly ? Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1) : Math.floor(t / (7 * DAY)) * 7 * DAY);
  const out = new Map<number, Json>();
  for (const r of rows) {
    const k = start(r.t);
    const b = out.get(k) ?? { t: k, clones: 0, uniqueCloners: 0, views: 0, uniqueVisitors: 0 };
    for (const f of FIELDS) b[f] += r[f] ?? 0;
    out.set(k, b);
  }
  return { rows: [...out.values()].sort((a, b) => a.t - b.t), bucketMs: monthly ? 31 * DAY : 7 * DAY, unit: monthly ? 'month' : 'week' };
}

/** Daily GitHub clone and view counts. GitHub keeps 14 days; the server copies them into its database so history keeps growing. */
export function RepoTraffic() {
  const [days, setDays] = useState(() => {
    const saved = localStorage.getItem(KEY);
    return OPTIONS.find(([d]) => String(d) === saved)?.[0] ?? 30;
  });
  const choose = (d: number) => { localStorage.setItem(KEY, String(d)); setDays(d); };
  const { data, error, isPending } = useApi<Json>(['repo-traffic', days], `/history/repo-traffic?days=${days || 3650}`);
  const series: Json[] = data?.series ?? [];
  const first = series[0]?.t as number | undefined;
  const from = days ? Date.now() - days * DAY : first ?? Date.now() - 30 * DAY;
  const to = Date.now();
  const grouped = useMemo(() => bucketise(series, days), [series, days]);
  const n = (v?: number) => (v == null ? '…' : v.toLocaleString());
  const t = data?.totals;
  // GitHub counts per UTC day, and today's bucket keeps growing, so show it on its own
  const todayStart = Math.floor(Date.now() / DAY) * DAY;
  const today = series.find((r) => r.t === todayStart);
  const covered = first && days ? first > from + DAY : false; // asked for more history than has been recorded
  return (
    <>
      <PageHeader crumbs={[{ label: 'Tools' }, { label: 'Repo traffic' }]} title="Repo traffic"
        sub={data ? `${data.repo} · clones and views per ${grouped.unit} (UTC) · syncs hourly${data.lastSyncAt ? `, last ${fromMs(data.lastSyncAt)}` : ''}` : 'Clones and views'}
        actions={<Dropdown title="Repo traffic range" icon={<Clock size={14} aria-hidden />} label={OPTIONS.find(([d]) => d === days)?.[1]} value={days} onSelect={(d) => choose(Number(d))} items={OPTIONS.map(([id, label]) => ({ id, label }))} />} />
      {isPending && <div className="empty" role="status">Loading repository traffic…</div>}
      {error && <Alert kind="bad">Could not load repository traffic: {errText(error)}. {data && 'Showing the last loaded data. '}Use Refresh now to retry.</Alert>}
      {data && !data.configured && <Alert kind="warn">Not recording yet. Set <span className="mono">GITHUB_TOKEN</span> (a token with push access to the repository) in the console's environment; <span className="mono">GITHUB_REPO</span> defaults to <span className="mono">unpod-ai/livekit-console</span>.</Alert>}
      {data?.lastError && <Alert kind="bad">Last sync failed: {data.lastError}</Alert>}
      {covered && <Alert>History starts {fromMs(first)}: GitHub only keeps 14 days, so the console has only been able to record from when it started syncing.</Alert>}
      {data && <>
      <Kpis>
        <Kpi label="Clones" value={n(t?.clones)} foot={`Today: ${(today?.clones ?? 0).toLocaleString()}`} />
        <Kpi label="Unique cloners" help="Summed per day, so someone cloning on two days counts twice" value={n(t?.uniqueCloners)} foot={`Today: ${(today?.uniqueCloners ?? 0).toLocaleString()}`} />
        <Kpi label="Views" value={n(t?.views)} foot={`Today: ${(today?.views ?? 0).toLocaleString()}`} />
        <Kpi label="Unique visitors" help="Summed per day, so someone visiting on two days counts twice" value={n(t?.uniqueVisitors)} foot={`Today: ${(today?.uniqueVisitors ?? 0).toLocaleString()}`} />
      </Kpis>
      <div className="grid-2">
        <Panel title="Clones">
          <BarsChart data={grouped.rows} series={[{ key: 'clones', label: 'Clones', color: PALETTE.cyan }, { key: 'uniqueCloners', label: 'Unique', color: PALETTE.purple }]} bucketMs={grouped.bucketMs} from={from} to={to} />
        </Panel>
        <Panel title="Views">
          <BarsChart data={grouped.rows} series={[{ key: 'views', label: 'Views', color: PALETTE.green }, { key: 'uniqueVisitors', label: 'Unique', color: PALETTE.amber }]} bucketMs={grouped.bucketMs} from={from} to={to} />
        </Panel>
      </div>
      </>}
    </>
  );
}
