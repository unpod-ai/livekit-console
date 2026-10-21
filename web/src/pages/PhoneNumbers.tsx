import { useMemo } from 'react';
import { Link } from '../lib/router';
import { useInitialQuery } from '../lib/useTab';
import { type Json } from '../lib/api';
import { useLkList } from '../lib/hooks';
import { DataTable, type Col } from '../components/DataTable';
import { Alert, Badge, PageHeader, Panel } from '../components/ui';

type Row = { number: string; inbound: Json[]; outbound: Json[]; rules: Json[] };

/** A self-hosted server has no number inventory: numbers belong to your carrier. This shows every number your trunks and rules reference. */
export function PhoneNumbers() {
  const inbound = useLkList('sip', 'ListSIPInboundTrunk');
  const outbound = useLkList('sip', 'ListSIPOutboundTrunk');
  const rules = useLkList('sip', 'ListSIPDispatchRule');
  const initialQuery = useInitialQuery();

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    const row = (n: string) => map.get(n) ?? (map.set(n, { number: n, inbound: [], outbound: [], rules: [] }), map.get(n)!);
    (inbound.data ?? []).forEach((t) => (t.numbers ?? []).forEach((n: string) => row(n).inbound.push(t)));
    (outbound.data ?? []).forEach((t) => (t.numbers ?? []).forEach((n: string) => row(n).outbound.push(t)));
    (rules.data ?? []).forEach((r) => (r.inboundNumbers ?? []).forEach((n: string) => row(n).rules.push(r)));
    for (const r of map.values()) {
      const ids = new Set(r.inbound.map((t) => t.sipTrunkId));
      (rules.data ?? []).filter((x) => (x.trunkIds ?? []).some((id: string) => ids.has(id)) && !r.rules.includes(x)).forEach((x) => r.rules.push(x));
    }
    return [...map.values()].sort((a, b) => a.number.localeCompare(b.number));
  }, [inbound.data, outbound.data, rules.data]);

  const cols: Col<Row>[] = [
    { key: 'number', header: 'Phone number', cell: (r) => <Link className="rowlink" to={`/telephony/calls?q=${encodeURIComponent(r.number)}`} title="View calls for this number"><b>{r.number}</b></Link>, text: (r) => r.number, sort: (r) => r.number },
    { key: 'dir', header: 'Direction', cell: (r) => <div className="badges">{r.inbound.length > 0 && <Badge tone="info">Inbound</Badge>}{r.outbound.length > 0 && <Badge>Outbound</Badge>}</div> },
    { key: 'in', header: 'Inbound trunks', cell: (r) => r.inbound.length ? <span className="badges">{r.inbound.map((t) => <Link key={t.sipTrunkId} className="badge" to={`/telephony/trunks?q=${t.sipTrunkId}`}>{t.name}</Link>)}</span> : '—', text: (r) => r.inbound.map((t) => t.name).join(' ') },
    { key: 'out', header: 'Outbound trunks', cell: (r) => r.outbound.length ? <span className="badges">{r.outbound.map((t) => <Link key={t.sipTrunkId} className="badge" to={`/telephony/trunks?q=${t.sipTrunkId}`}>{t.name}</Link>)}</span> : '—', text: (r) => r.outbound.map((t) => t.name).join(' ') },
    { key: 'rules', header: 'Dispatch rules', cell: (r) => r.rules.length ? <span className="badges">{r.rules.map((x) => <Link key={x.sipDispatchRuleId} className="badge" to={`/telephony/dispatch?q=${x.sipDispatchRuleId}`}>{x.name || x.sipDispatchRuleId}</Link>)}</span> : <span className="muted">None</span>, text: (r) => r.rules.map((x) => x.name).join(' ') },
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: 'Telephony' }, { label: 'Phone numbers' }]} title="Phone numbers" sub="Numbers referenced by your SIP trunks and dispatch rules" refresh={false} />
      <Alert>Numbers are rented from your SIP carrier, not from this server, so there is nothing to purchase here. This view is built from your trunks and rules.</Alert>
      <Panel>
        <DataTable rows={rows} cols={cols} rowKey={(r) => r.number} loading={inbound.isLoading || outbound.isLoading} error={inbound.error ?? outbound.error ?? rules.error} storageKey="numbers" initialQuery={initialQuery} empty={{ title: 'No numbers configured', hint: 'Add numbers to a trunk to see them here.' }} />
      </Panel>
    </>
  );
}
