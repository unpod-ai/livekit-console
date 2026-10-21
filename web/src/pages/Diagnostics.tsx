import { useSearchParams } from 'react-router-dom';
import { useMe } from '../lib/me';
import { fromMsPrecise } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { Alert, Badge, Empty, Kpi, Kpis, PageHeader, Panel } from '../components/ui';
import { DiagnosticCoverage, DiagnosticMetricChart, DiagnosticPager, useDiagnostics } from '../components/ConnectionQuality';
import { SipDiagnostics } from '../components/SipDiagnostics';

export function Diagnostics() {
  const [params] = useSearchParams();
  const result = useDiagnostics('services'), { data, filter } = result;
  const rows = data?.rows ?? [];
  const instances = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const key = JSON.stringify([row.service, row.instanceId]);
    const prior = instances.get(key);
    if (!prior) instances.set(key, { ...row, lastReceivedAt: row.receivedAt });
    else prior.lastReceivedAt = Math.max(prior.lastReceivedAt, row.receivedAt);
  }
  const selected = params.get('instance') || instances.keys().next().value || '';
  const observations = rows.filter(r => JSON.stringify([r.service, r.instanceId]) === selected);
  const metrics = [...new Set(observations.flatMap(r => Object.keys(r.metrics ?? {})))].filter(key => !['cpuPct', 'memoryBytes', 'pids'].includes(key));
  if (result.checking) return <Alert>Checking access…</Alert>;
  if (!result.admin) return <Alert>Service diagnostics require an administrator account.</Alert>;
  return <>
    <PageHeader crumbs={[{ label: 'Console' }, { label: 'Diagnostics' }]} title="Service diagnostics" sub="Observed service health and capacity" range />
    <details className="context-help"><summary>How service health is observed</summary><p>Container running state does not establish application readiness. Stale means no observation received for over 2 minutes; this is a display threshold, not a service health check. Instance coverage is limited to retained observations in the chosen range and page.</p></details>
    <DiagnosticCoverage data={data} />
    {result.error && <Alert kind="bad">{(result.error as Error).message}</Alert>}
    <Kpis><Kpi label="Observed instances" value={instances.size}/><Kpi label="Reported unhealthy / stopped" value={[...instances.values()].filter(r=>['unhealthy','stopped'].includes(r.state)).length} help="Latest retained snapshot per instance on this page, not a readiness probe"/><Kpi label="Stale receipts" value={[...instances.values()].filter(r=>Date.now()-r.lastReceivedAt>120000).length}/></Kpis>
    <Panel title="Observed instances (latest snapshot on this page)"><DataTable rows={[...instances.values()]} loading={result.isLoading} search={false} pageSize={false} rowKey={r => JSON.stringify([r.service, r.instanceId])} cols={[
      { key: 'service', header: 'Service', cell: r => r.service }, { key: 'instance', header: 'Instance', cell: r => <button className="btn ghost sm mono" onClick={() => filter('instance', JSON.stringify([r.service, r.instanceId]))}>{r.instanceId}</button> },
      { key: 'state', header: 'Reported state', cell: r => <Badge tone={r.state === 'unhealthy' || r.state === 'stopped' ? 'bad' : undefined}>{r.state}</Badge> },
      { key: 'freshness', header: 'Freshness', cell: r => <Badge tone={Date.now() - r.lastReceivedAt > 120000 ? 'warn' : undefined}>{Date.now() - r.lastReceivedAt > 120000 ? 'Stale receipt' : 'Recent receipt'}{Date.now() - r.at > 120000 ? ' · old observation' : ''}</Badge> },
      { key: 'at', header: 'Observed at', cell: r => fromMsPrecise(r.at) }, { key: 'received', header: 'Last received (page)', cell: r => fromMsPrecise(r.lastReceivedAt) },
    ]} empty={{ title: 'No observed service instances', hint: 'No snapshots were submitted in this range. Check source configuration and collection status.' }} footer={<DiagnosticPager data={data} onChange={n => filter(result.offsetKey, String(n))} />} /></Panel>
    {instances.size>0&&<Panel title="Instance metrics"><div style={{ padding: 14 }}><label>Exact service instance<select className="select" value={selected} onChange={e => filter('instance', e.target.value)}>
      {!selected && <option value="">No observed instances on this page</option>}
      {selected && !instances.has(selected) && <option value={selected}>Selected instance has no observations on this page</option>}
      {[...instances].map(([key, row]) => <option key={key} value={key}>{row.service} · {row.instanceId}</option>)}
    </select></label></div></Panel>}
    {data&&!observations.some(r=>Object.keys(r.metrics??{}).length)&&<Empty title="No measured service metrics">Check collection coverage or select another observed instance.</Empty>}
    <div className="grid-2">
      <DiagnosticMetricChart rows={observations} keys={['cpuPct']} title="CPU" unit="%" />
      <DiagnosticMetricChart rows={observations} keys={['memoryBytes']} title="Memory" unit="bytes" />
      <DiagnosticMetricChart rows={observations} keys={['pids']} title="Processes" unit="count" />
      {metrics.map(key => <DiagnosticMetricChart key={key} rows={observations} keys={[key]} title={key} unit={key.endsWith('_bytes') ? 'bytes (counter)' : key === 'livekit_packet_total' ? 'packets (counter)' : key === 'livekit_sip_cpu_load' ? 'load' : 'reported value'} />)}
    </div>
    <details className="context-help"><summary>Raw instance snapshots</summary><Panel title="Selected instance measurements"><DataTable rows={observations} search={false} pageSize={false} rowKey={r => r.id} empty={{ title: 'No measurements on this page' }} cols={[
      { key: 'at', header: 'Time', cell: r => fromMsPrecise(r.at) }, { key: 'metrics', header: 'Measured values', wrap: true, cell: r => Object.entries(r.metrics ?? {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'No measurements reported' },
    ]} /></Panel></details>
  </>;
}

export function TelephonyDiagnostics() {
  const me = useMe();
  if (me.isPending) return <Alert>Checking access…</Alert>;
  if (me.data?.role !== 'admin') return <Alert>SIP diagnostics require an administrator account.</Alert>;
  return <><PageHeader crumbs={[{ label: 'Telephony' }, { label: 'Diagnostics' }]} title="SIP diagnostics" sub="SIP service attempts, failures and timelines" range /><SipDiagnostics /></>;
}
