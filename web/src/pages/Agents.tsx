import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Json } from '../lib/api';
import { useApi, useLkList } from '../lib/hooks';
import { useInitialQuery } from '../lib/useTab';
import { fmtMs, relTime } from '../lib/format';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Kpi, Kpis, PageHeader, Panel, RangeSelect } from '../components/ui';

type Row = { name: string; sessions: number; jobs: number; minutes: number; avgMs: number; activeNow: number; lastSeenAt: number | null; rules: Json[] };

/**
 * A self-hosted LiveKit server has no API for listing registered agent workers, so this page is built from what is
 * observable: agents that joined sessions (named in the participant's attributes) and agents named in dispatch rules.
 */
export function Agents() {
  const [hours, setHours] = useState(168);
  const initialQuery = useInitialQuery();
  const seen = useApi<Json[]>(['agents', hours], `/history/agents?hours=${hours}`);
  const rules = useLkList('sip', 'ListSIPDispatchRule');

  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    (seen.data ?? []).forEach((a) => m.set(a.name, { name: a.name, sessions: a.sessions, jobs: a.jobs, minutes: a.minutes, avgMs: a.avgMs, activeNow: a.activeNow, lastSeenAt: a.lastSeenAt, rules: [] as Json[] }));
    (rules.data ?? []).forEach((r) => (r.roomConfig?.agents ?? []).forEach((a: Json) => {
      const row = m.get(a.agentName) ?? { name: a.agentName, sessions: 0, jobs: 0, minutes: 0, avgMs: 0, activeNow: 0, lastSeenAt: null, rules: [] as Json[] };
      row.rules.push(r);
      m.set(a.agentName, row);
    }));
    return [...m.values()].sort((a, b) => b.activeNow - a.activeNow || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) || a.name.localeCompare(b.name));
  }, [seen.data, rules.data]);

  const cols: Col<Row>[] = [
    { key: 'name', header: 'Agent name', cell: (a) => <Link className="rowlink" to={`/sessions?agent=${encodeURIComponent(a.name)}`} title="View this agent's sessions"><b>{a.name}</b></Link>, text: (a) => a.name, sort: (a) => a.name },
    { key: 'status', header: 'Status', cell: (a) => (a.activeNow ? <Badge tone="ok" dot pulse>{a.activeNow} active</Badge> : a.sessions ? <Badge>Idle</Badge> : <Badge>No sessions yet</Badge>), sort: (a) => a.activeNow },
    { key: 'sessions', header: 'Sessions', cell: (a) => a.sessions.toLocaleString(), sort: (a) => a.sessions },
    { key: 'minutes', header: 'Agent minutes', cell: (a) => a.minutes.toLocaleString(), sort: (a) => a.minutes },
    { key: 'avg', header: 'Avg session', cell: (a) => (a.jobs ? fmtMs(a.avgMs) : '—'), sort: (a) => a.avgMs },
    { key: 'last', header: 'Last seen', cell: (a) => (a.lastSeenAt ? relTime(a.lastSeenAt) : '—'), sort: (a) => a.lastSeenAt ?? 0 },
    { key: 'rules', header: 'Dispatch rules', cell: (a) => (a.rules.length ? <div className="badges">{a.rules.slice(0, 3).map((r) => <Link key={r.sipDispatchRuleId} className="badge" to={`/telephony/dispatch?q=${r.sipDispatchRuleId}`}>{r.name || r.sipDispatchRuleId}</Link>)}{a.rules.length > 3 && <Badge>+{a.rules.length - 3}</Badge>}</div> : <span className="muted">None</span>), text: (a) => a.rules.map((r) => r.name).join(' ') },
  ];
  const total = (k: 'sessions' | 'minutes' | 'activeNow') => rows.reduce((n, r) => n + r[k], 0);

  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Agents' }]} title="Agents" sub="Agents that have joined sessions, plus agents named in dispatch rules" actions={<RangeSelect value={hours} onChange={setHours} />} />
      <Kpis>
        <Kpi label="Agents" value={rows.length} />
        <Kpi label="Active now" value={total('activeNow')} accent />
        <Kpi label="Agent sessions" value={total('sessions').toLocaleString()} />
        <Kpi label="Agent minutes" value={total('minutes').toLocaleString()} />
      </Kpis>
      <Panel>
        <DataTable rows={rows} cols={cols} rowKey={(a) => a.name} loading={seen.isLoading || rules.isLoading} error={seen.error} storageKey="agents" initialQuery={initialQuery}
          empty={{ title: 'No agents seen yet', hint: 'An agent shows up here after it joins a session (and webhooks reach this console), or when a dispatch rule names it.' }} />
      </Panel>
      <Alert>LiveKit Cloud lists deployed agent workers; a self-hosted server has no API for that, so a worker that is running but has not taken a call yet will not appear. "Active now" counts agents currently inside a session.</Alert>
    </>
  );
}
