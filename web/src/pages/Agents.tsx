import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useInitialQuery } from '../lib/useTab';
import { type Json } from '../lib/api';
import { useApi, useLkList } from '../lib/hooks';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Kpi, Kpis, PageHeader, Panel } from '../components/ui';

type Row = { name: string; rules: Json[] };

/** A self-hosted server doesn't track agent workers, so this lists the agents your dispatch rules send to calls. */
export function Agents() {
  const rules = useLkList('sip', 'ListSIPDispatchRule');
  const initialQuery = useInitialQuery();
  const insights = useApi<Json>(['insights', 168], '/history/insights?hours=168');
  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    (rules.data ?? []).forEach((r) => (r.roomConfig?.agents ?? []).forEach((a: Json) => {
      if (!m.has(a.agentName)) m.set(a.agentName, { name: a.agentName, rules: [] });
      m.get(a.agentName)!.rules.push(r);
    }));
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rules.data]);
  const cols: Col<Row>[] = [
    { key: 'name', header: 'Agent name', cell: (a) => <b>{a.name}</b>, text: (a) => a.name, sort: (a) => a.name },
    { key: 'count', header: 'Dispatch rules', cell: (a) => a.rules.length, sort: (a) => a.rules.length },
    { key: 'rules', header: 'Rules', cell: (a) => <div className="badges">{a.rules.slice(0, 4).map((r) => <Link key={r.sipDispatchRuleId} className="badge" to={`/telephony/dispatch?q=${r.sipDispatchRuleId}`}>{r.name || r.sipDispatchRuleId}</Link>)}{a.rules.length > 4 && <Badge>+{a.rules.length - 4}</Badge>}</div>, text: (a) => a.rules.map((r) => r.name).join(' ') },
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Agents' }]} title="Agents" sub="Agents your dispatch rules send to inbound calls" />
      <Kpis>
        <Kpi label="Agents referenced" value={rows.length} />
        <Kpi label="Agent sessions (7d)" value={insights.data?.sessionsWithAgents?.toLocaleString() ?? '…'} />
        <Kpi label="Agent session minutes (7d)" value={insights.data?.agentSessionMinutes?.toLocaleString() ?? '…'} />
      </Kpis>
      <Panel>
        <DataTable rows={rows} cols={cols} rowKey={(a) => a.name} loading={rules.isLoading} error={rules.error} storageKey="agents" initialQuery={initialQuery} empty={{ title: 'No agents in dispatch rules', hint: <>Add an agent name to a <Link to="/telephony/dispatch">dispatch rule</Link> so inbound calls are answered.</> }} />
      </Panel>
      <Alert>Deploying, versioning and monitoring agent workers is a LiveKit Cloud feature. Here, agents are your own processes; you can also dispatch one into a live room from the room's page.</Alert>
    </>
  );
}
