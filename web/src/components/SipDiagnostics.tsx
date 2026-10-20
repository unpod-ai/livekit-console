import { Link, useSearchParams } from 'react-router-dom';
import { fromMsPrecise } from '../lib/format';
import { DataTable } from './DataTable';
import { Alert, Badge, KV, Panel } from './ui';
import { DiagnosticCoverage, DiagnosticPager, useDiagnostics } from './ConnectionQuality';

const hasPrefix = (value: unknown, prefix: string): value is string => typeof value === 'string' && value.startsWith(prefix);

export function SipDiagnostics({ roomSid, participantSid, callId }: { roomSid?: string; participantSid?: string; callId?: string }) {
  const [params] = useSearchParams();
  const fields = { roomSid: roomSid ?? params.get('roomSid') ?? '', participantSid: participantSid ?? params.get('participantSid') ?? '', callId: callId ?? params.get('callId') ?? '', q: params.get('q') ?? '' };
  const result = useDiagnostics('sip', fields), { data, filter } = result;
  if (result.checking) return <Alert>Checking access…</Alert>;
  if (!result.admin) return <Alert>SIP diagnostics require an administrator account.</Alert>;
  return <>
    <Alert>SIP service observations include attempts that fail before joining a room, when the SIP log source is configured and submitting records. Missing observations can reflect source coverage or retention. Links use exact room/participant SIDs or API-resolved durable call IDs.</Alert>
    <DiagnosticCoverage data={data} />
    {result.error && <Alert kind="bad">{(result.error as Error).message}</Alert>}
    <Panel title={fields.callId ? `SIP service timeline · ${fields.callId}` : 'SIP service attempts and events'}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 14 }}>
        {(['q', 'callId', 'roomSid', 'participantSid'] as const).map(key => <label key={key} style={{ minWidth: 0, flex: '1 1 180px' }}>{key === 'q' ? 'Search IDs / reason' : key}<input className="input" maxLength={256} value={fields[key]} readOnly={key === 'roomSid' ? !!roomSid : key === 'participantSid' ? !!participantSid : key === 'callId' ? !!callId : false} onChange={e => filter(key, e.target.value)} /></label>)}
        {(['from', 'to'] as const).map(key => <label key={key} style={{ minWidth: 0, flex: '1 1 180px' }}>{key === 'from' ? 'From' : 'To'} (Unix ms, optional)<input className="input" inputMode="numeric" value={params.get(key) ?? ''} onChange={e => filter(key, e.target.value)} placeholder="Global time range" /></label>)}
      </div>
      <DataTable rows={data?.rows} loading={result.isLoading} search={false} pageSize={false} rowKey={r => r.id} empty={{ title: 'No retained SIP service observations match', hint: 'Configure the SIP log source to see pre-room failures; collection availability is shown above.' }} cols={[
        { key: 'at', header: 'Time (newest first)', cell: r => <span className="nowrap">{fromMsPrecise(r.at)}</span> },
        { key: 'call', header: 'Call ID', wrap: true, cell: r => <Link className="rowlink mono" to={`/telephony/diagnostics?${(() => { const next = new URLSearchParams(params); next.set('callId', r.callId); next.delete('sipOffset'); return next; })()}`}>{r.callId}</Link> },
        { key: 'stage', header: 'Stage / response', cell: r => <>{r.stage ?? 'Not reported'} · {r.code ?? 'No code'}</> },
        { key: 'reason', header: 'Reason', wrap: true, cell: r => r.reason ?? 'Not reported' },
        { key: 'direction', header: 'Direction / source', cell: r => <><Badge>{r.direction ?? 'Unknown'}</Badge><div className="muted">SIP service</div></> },
        { key: 'links', header: 'Linked session', wrap: true, cell: r => {
          const nativeRoom = hasPrefix(r.roomSid, 'RM_') ? r.roomSid : undefined;
          const linkedRoom = hasPrefix(r.linkedRoomSid, 'RM_') ? r.linkedRoomSid : undefined;
          const room = nativeRoom ?? linkedRoom;
          const candidate = nativeRoom ? r.participantSid ?? (nativeRoom === linkedRoom ? r.linkedParticipantSid : undefined) : r.linkedParticipantSid;
          const participant = hasPrefix(candidate, 'PA_') ? candidate : undefined;
          return room ? <><Link className="mono" to={`/sessions/${encodeURIComponent(room)}`}>{room}</Link>{participant && <div><Link to={`/sessions/${encodeURIComponent(room)}/participants/${encodeURIComponent(participant)}`}>{participant}</Link></div>}</> : 'No linked room (may be pre-room)';
        } },
        { key: 'details', header: 'Service log details', wrap: true, cell: r => <details><summary>Details</summary><KV items={[
          ['Observed at', fromMsPrecise(r.at)], ['Received at', fromMsPrecise(r.receivedAt)], ['Instance', r.instanceId], ['SIP call ID', r.sipCallId ?? 'Not reported'], ['Provider call ID', r.providerCallId ?? 'Not reported'],
          ['Trunk ID', r.trunkId ? <Link to={`/telephony/trunks?${new URLSearchParams({ q: r.trunkId })}`}>{r.trunkId}</Link> : 'Not reported'],
          ['Dispatch rule ID', r.ruleId ? <Link to={`/telephony/dispatch?${new URLSearchParams({ q: r.ruleId })}`}>{r.ruleId}</Link> : 'Not reported'], ['Sanitized message', r.message ?? 'Not reported'],
        ]} /></details> },
      ]} footer={<DiagnosticPager data={data} onChange={n => filter(result.offsetKey, String(n))} />} />
    </Panel>
    {fields.callId && <Panel title="Timeline (this page, chronological)"><DataTable rows={[...(data?.rows ?? [])].reverse()} search={false} pageSize={false} rowKey={r => r.id} empty={{ title: 'No timeline observations on this page' }} cols={[
      { key: 'at', header: 'Time', cell: r => fromMsPrecise(r.at) }, { key: 'stage', header: 'Stage', cell: r => r.stage ?? 'Not reported' }, { key: 'code', header: 'SIP response', cell: r => r.code ?? 'Not reported' }, { key: 'reason', header: 'Reason / message', wrap: true, cell: r => <>{r.reason ?? 'No reason reported'}<div>{r.message}</div></> },
    ]} /></Panel>}
  </>;
}
