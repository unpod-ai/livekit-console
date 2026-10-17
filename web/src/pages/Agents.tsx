import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { api, type Json } from '../lib/api';
import { useApi, useLkList, useMutate } from '../lib/hooks';
import { useConfirm } from '../lib/confirm';
import { useToast } from '../lib/toast';
import { useInitialQuery } from '../lib/useTab';
import { durationMs, fmtMs, fromMs, relTime } from '../lib/format';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, Kpi, Kpis, PageHeader, Panel, RangeSelect } from '../components/ui';

type Ping = { name: string; at: number; ok: number; latencyMs: number | null; error: string | null; byUser: string | null };
type Row = { name: string; sessions: number; jobs: number; minutes: number; avgMs: number; running: number; lastSeenAt: number | null; rules: Json[]; ping?: Ping };

const STATE_TONE: Record<string, 'ok' | 'warn' | 'info' | undefined> = { listening: 'ok', speaking: 'info', thinking: 'warn', initializing: 'warn' };

/**
 * A self-hosted LiveKit server has no API for listing registered agent workers. Instead this shows what can be observed:
 * agents running inside live rooms right now, agents that joined past sessions, agents named in dispatch rules, and the
 * result of an on-demand ping (a test job dispatched to the agent in a throwaway room).
 */
export function Agents() {
  const [hours, setHours] = useState(168);
  const initialQuery = useInitialQuery();
  const seen = useApi<Json[]>(['agents', hours], `/history/agents?hours=${hours}`);
  const live = useApi<Json[]>(['agents-live'], '/agents/live');
  const pings = useApi<Ping[]>(['agent-pings'], '/history/agent-pings', { live: false });
  const rules = useLkList('sip', 'ListSIPDispatchRule');
  const confirm = useConfirm();
  const toast = useToast();
  const [pinging, setPinging] = useState<string | null>(null);
  const ping = useMutate((name: string) => api<{ ok: boolean; latencyMs: number; error: string | null }>('/agents/ping', { method: 'POST', body: { agentName: name } }), { invalidate: [['agent-pings']] });

  const runPing = async (name: string) => {
    const go = await confirm({
      title: `Ping ${name}?`,
      message: 'This dispatches a short test job to the agent in a temporary empty room named lkc-ping-…. If a worker is running it will accept the job and join the room; the room is removed straight after (up to 15 seconds).',
      confirmLabel: 'Ping agent',
    });
    if (!go) return;
    setPinging(name);
    ping.mutate(name, {
      onSuccess: (r) => toast(r.ok ? 'ok' : 'bad', r.ok ? `${name} responded in ${fmtMs(r.latencyMs)}` : r.error ?? 'No response'),
      onSettled: () => setPinging(null),
    });
  };

  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    const blank = (name: string): Row => ({ name, sessions: 0, jobs: 0, minutes: 0, avgMs: 0, running: 0, lastSeenAt: null, rules: [] as Json[] });
    (seen.data ?? []).forEach((a) => m.set(a.name, { ...blank(a.name), sessions: a.sessions, jobs: a.jobs, minutes: a.minutes, avgMs: a.avgMs, running: a.activeNow, lastSeenAt: a.lastSeenAt }));
    (rules.data ?? []).forEach((r) => (r.roomConfig?.agents ?? []).forEach((a: Json) => {
      const row = m.get(a.agentName) ?? blank(a.agentName);
      row.rules.push(r);
      m.set(a.agentName, row);
    }));
    // Authoritative "running now" comes from LiveKit; fall back to history only until it loads.
    if (live.data) {
      m.forEach((row) => (row.running = 0));
      live.data.forEach((l) => {
        const row = m.get(l.agentName) ?? blank(l.agentName);
        row.running++;
        m.set(l.agentName, row);
      });
    }
    (pings.data ?? []).forEach((p) => { const row = m.get(p.name); if (row) row.ping = p; });
    return [...m.values()].sort((a, b) => b.running - a.running || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0) || a.name.localeCompare(b.name));
  }, [seen.data, rules.data, live.data, pings.data]);

  const cols: Col<Row>[] = [
    { key: 'name', header: 'Agent name', cell: (a) => <Link className="rowlink" to={`/sessions?agent=${encodeURIComponent(a.name)}`} title="View this agent's sessions"><b>{a.name}</b></Link>, text: (a) => a.name, sort: (a) => a.name },
    { key: 'status', header: 'Status', cell: (a) => a.running
        ? <Badge tone="ok" dot pulse>Running · {a.running} in {a.running === 1 ? 'a call' : 'calls'}</Badge>
        : a.ping ? (a.ping.ok ? <Badge tone="ok" dot>Responding</Badge> : <Badge tone="bad" dot>Not responding</Badge>)
        : a.sessions ? <Badge>Idle · not pinged</Badge> : <Badge>No sessions yet</Badge>,
      sort: (a) => a.running * 2 + (a.ping?.ok ? 1 : 0) },
    { key: 'ping', header: 'Last ping', cell: (a) => (a.ping
        ? <span title={a.ping.error ?? `by ${a.ping.byUser ?? 'unknown'}`}>{a.ping.ok ? `OK · ${fmtMs(a.ping.latencyMs)}` : 'Failed'} <span className="muted">· {relTime(a.ping.at)}</span></span>
        : <span className="muted">Never</span>), sort: (a) => a.ping?.at ?? 0 },
    { key: 'sessions', header: 'Sessions', cell: (a) => a.sessions.toLocaleString(), sort: (a) => a.sessions },
    { key: 'minutes', header: 'Agent minutes', cell: (a) => a.minutes.toLocaleString(), sort: (a) => a.minutes },
    { key: 'avg', header: 'Avg session', hidden: true, cell: (a) => (a.jobs ? fmtMs(a.avgMs) : '—'), sort: (a) => a.avgMs },
    { key: 'last', header: 'Last seen in a call', cell: (a) => (a.lastSeenAt ? relTime(a.lastSeenAt) : '—'), sort: (a) => a.lastSeenAt ?? 0 },
    { key: 'rules', header: 'Dispatch rules', hidden: true, cell: (a) => (a.rules.length ? <div className="badges">{a.rules.slice(0, 3).map((r) => <Link key={r.sipDispatchRuleId} className="badge" to={`/telephony/dispatch?q=${r.sipDispatchRuleId}`}>{r.name || r.sipDispatchRuleId}</Link>)}{a.rules.length > 3 && <Badge>+{a.rules.length - 3}</Badge>}</div> : <span className="muted">None</span>), text: (a) => a.rules.map((r) => r.name).join(' ') },
  ];
  const total = (k: 'sessions' | 'minutes' | 'running') => rows.reduce((n, r) => n + r[k], 0);

  const liveCols: Col<Json>[] = [
    { key: 'agent', header: 'Agent', cell: (l) => <Link className="rowlink" to={`/sessions?agent=${encodeURIComponent(l.agentName)}`}><b>{l.agentName}</b></Link>, text: (l) => l.agentName },
    { key: 'state', header: 'State', cell: (l) => (l.state ? <Badge tone={STATE_TONE[l.state]}>{l.state}</Badge> : '—') },
    { key: 'room', header: 'Room', cell: (l) => <Link className="rowlink" to={`/rooms/${encodeURIComponent(l.roomName)}`}>{l.roomName}</Link>, text: (l) => l.roomName },
    { key: 'session', header: 'Session', cell: (l) => <Link className="rowlink mono" to={`/sessions/${l.roomSid}`}>{l.roomSid}</Link> },
    { key: 'joined', header: 'Joined', cell: (l) => fromMs(l.joinedAt) },
    { key: 'dur', header: 'Running for', cell: (l) => durationMs(l.joinedAt, null) },
  ];

  return (
    <>
      <PageHeader crumbs={[{ label: 'Project' }, { label: 'Agents' }]} title="Agents" sub="Running agents, agents seen in sessions, and agents named in dispatch rules" actions={<RangeSelect value={hours} onChange={setHours} />} />
      <Kpis>
        <Kpi label="Agents" value={rows.length} />
        <Kpi label="Running now" value={live.data ? total('running') : '…'} accent foot={live.isError ? 'Could not reach LiveKit' : 'Agents inside live rooms'} />
        <Kpi label="Agent sessions" value={total('sessions').toLocaleString()} />
        <Kpi label="Agent minutes" value={total('minutes').toLocaleString()} />
      </Kpis>
      <Panel title="Running now" icon={<Radio size={15} />}>
        <DataTable rows={live.data} cols={liveCols} rowKey={(l) => `${l.roomSid}-${l.identity}`} loading={live.isLoading} error={live.error} search={false} pageSize={false}
          empty={{ title: 'No agent is in a call right now', hint: 'Agents appear here while they are inside a room. Use Ping below to check that an idle agent is up.' }} />
      </Panel>
      <Panel title="All agents">
        <DataTable rows={rows} cols={cols} rowKey={(a) => a.name} loading={seen.isLoading || rules.isLoading} error={seen.error} storageKey="agents" initialQuery={initialQuery}
          empty={{ title: 'No agents seen yet', hint: 'An agent shows up here after it joins a session (and webhooks reach this console), or when a dispatch rule names it.' }}
          rowActions={(a) => a.name === 'unknown' ? null : <button className="btn secondary sm" disabled={pinging === a.name} onClick={() => runPing(a.name)}>{pinging === a.name ? 'Pinging…' : 'Ping'}</button>} />
      </Panel>
      <Alert>LiveKit Cloud lists deployed agent workers; a self-hosted server has no API for that. "Running" means an agent is inside a live room. "Responding" comes from a ping: a test job accepted by a worker, so an idle but healthy agent can be checked on demand.</Alert>
    </>
  );
}
