import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useRange } from '../lib/range';
import { fromMs } from '../lib/format';
import { BarsChart, PALETTE } from '../components/Charts';
import { Alert, Kpi, Kpis, PageHeader, Panel } from '../components/ui';

/** Daily GitHub clone and view counts. GitHub keeps 14 days; the server copies them into its database so history keeps growing. */
export function RepoTraffic() {
  const { hours } = useRange();
  const days = Math.max(1, Math.ceil(hours / 24));
  const { data } = useApi<Json>(['repo-traffic', days], `/history/repo-traffic?days=${days}`);
  const n = (v?: number) => (v == null ? '…' : v.toLocaleString());
  const t = data?.totals;
  const from = Date.now() - days * 86400000;
  const to = Date.now();
  return (
    <>
      <PageHeader crumbs={[{ label: 'Tools' }, { label: 'Repo traffic' }]} title="Repo traffic" sub={data ? `${data.repo} · clones and views per day` : 'Clones and views per day'} range />
      {data && !data.configured && <Alert kind="warn">Not recording yet. Set <span className="mono">GITHUB_TOKEN</span> (a token with push access to the repository) in the console's environment; <span className="mono">GITHUB_REPO</span> defaults to <span className="mono">unpod-ai/livekit-console</span>.</Alert>}
      {data?.lastError && <Alert kind="bad">Last sync failed: {data.lastError}</Alert>}
      <Kpis>
        <Kpi label="Clones" value={n(t?.clones)} />
        <Kpi label="Unique cloners" help="Summed per day, so someone cloning on two days counts twice" value={n(t?.uniqueCloners)} />
        <Kpi label="Views" value={n(t?.views)} />
        <Kpi label="Unique visitors" value={n(t?.uniqueVisitors)} foot={data?.lastSyncAt ? `Synced ${fromMs(data.lastSyncAt)}` : undefined} />
      </Kpis>
      <div className="grid-2">
        <Panel title="Clones">
          <BarsChart data={data?.series ?? []} series={[{ key: 'clones', label: 'Clones', color: PALETTE.cyan }, { key: 'uniqueCloners', label: 'Unique', color: PALETTE.purple }]} bucketMs={data?.bucketMs ?? 86400000} from={from} to={to} />
        </Panel>
        <Panel title="Views">
          <BarsChart data={data?.series ?? []} series={[{ key: 'views', label: 'Views', color: PALETTE.green }, { key: 'uniqueVisitors', label: 'Unique', color: PALETTE.amber }]} bucketMs={data?.bucketMs ?? 86400000} from={from} to={to} />
        </Panel>
      </div>
    </>
  );
}
