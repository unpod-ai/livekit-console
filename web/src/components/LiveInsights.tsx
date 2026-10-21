import { can, useMe } from '../lib/me';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { fromMsPrecise } from '../lib/format';
import { Alert, Badge, Empty, KV, Panel } from './ui';
import { DataTable } from './DataTable';
import { TurnTimings } from './TurnTimings';
import { Drawer } from './Drawer';

type RecordRow = { id: string; jobId: string; kind: string; at: number; end?: number; name?: string; role?: string; text?: string;
  message?: string; state?: string; stage?: string; status?: string; callId?: string; messageId?: string;
  fromAgent?: string; toAgent?: string; interrupted?: boolean; isError?: boolean;
  turnId: string | null; traceId: string | null; spanId: string | null; parentSpanId?: string | null;
  metrics?: Record<string, number>; models?: unknown[] };
type Job = { jobId: string; agentName: string; state: string; reasons: string[]; mode: string; sdkLanguage: string;
  sdkVersion: string | null; participantSid: string | null; workerId: string | null; capabilities: string[];
  receivedCount: number; expectedCount: number | null; droppedCount: number; lastReceived: number | null; expiresAt: number | null };
type Data = { selected?: RecordRow|null; enabled: boolean; redaction: string; jobs: Job[]; rows: RecordRow[]; total: number; page: number; pageSize: number };
const colors: Record<string, string> = { llm: 'var(--accent)', tts: 'var(--chart-purple)', stt: 'var(--chart-green)', tool: 'var(--chart-amber)', turn: 'var(--chart-orange)', realtime: 'var(--purple)' };
function Timing({ metrics }: { metrics?: Record<string, number> }) {
  return <span>{Object.entries(metrics ?? {}).map(([k, v]) => <span key={k} style={{ display: 'block' }}>{k.replace(/_/g, ' ')}: {k.includes('tokens') || k === 'total_requests' ? v : `${(v * 1000).toFixed(1)} ms`}</span>)}</span>;
}
export function useLiveInsightsData(sid: string) {
  const me=useMe(),[params]=useSearchParams();
  const job=params.get('reportJob')??'',turn=params.get('liveTurn')??'',trace=params.get('liveTrace')??'',kind=params.get('liveKind')??'',page=params.get('livePage')??'1',record=params.get('selectedRecord')??'';
  const q=new URLSearchParams({page,...(job&&{jobId:job}),...(turn&&{turnId:turn}),...(trace&&{traceId:trace}),...(kind&&{kind}),...(record&&{recordId:record})});
  return useApi<Data>(['live-insights',sid,job,turn,trace,kind,page,record],`/agent-insights/sessions/${encodeURIComponent(sid)}/telemetry?${q}`,{enabled:can(me.data,'transcripts')&&can(me.data,'logs')});
}
export function LiveInsights({ sid, view = 'traces' }: { sid: string; view?: 'transcript'|'traces'|'collection'|'export' }) {
  const me = useMe();
  const allowed = can(me.data, 'transcripts') && can(me.data, 'logs');
  const [params, setParams] = useSearchParams();
  const job = params.get('reportJob') ?? '', turn = params.get('liveTurn') ?? '', trace = params.get('liveTrace') ?? '';
  const kind = params.get('liveKind') ?? '', page = params.get('livePage') ?? '1';
  const [draftTurn, setDraftTurn] = useState(turn), [draftTrace, setDraftTrace] = useState(trace);
  useEffect(() => { setDraftTurn(turn); setDraftTrace(trace); }, [turn, trace]);
  const validTrace = !draftTrace || /^[a-f0-9]{32}$/.test(draftTrace);
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  const result = useLiveInsightsData(sid);
  function filter(key: string, value: string) {
    setParams(old => { const next = new URLSearchParams(old); value ? next.set(key, value) : next.delete(key); if (key !== 'livePage') next.delete('livePage'); return next; });
  }
  async function download() {
    setExporting(true); setExportError('');
    try {
      const res = await fetch(`/api/agent-insights/sessions/${encodeURIComponent(sid)}/export${job ? `?jobId=${encodeURIComponent(job)}` : ''}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Export failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = `${sid}_agent-session.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
  }
  if (!allowed) return view==='export'?null:<Alert>Live telemetry and combined exports require transcript and log access.</Alert>;
  if(view==='export')return <div><button className="btn secondary sm" disabled={exporting} onClick={download}>{exporting?'Exporting…':'Export retained session data'}</button>{exportError&&<Alert kind="bad">{exportError}</Alert>}</div>;
  if (result.error) return <Alert kind="bad">{(result.error as Error).message}</Alert>;
  if (!result.data) return <Alert>Loading live telemetry…</Alert>;
  const data = result.data, selected = data.jobs.find(j => j.jobId === job);
  const spans = data.rows.filter(r => r.kind === 'span');
  const conversation=data.rows.filter(r=>['message','tool','handoff','error'].includes(r.kind));
  const selectedRecord=data.selected??data.rows.find(r=>r.id===params.get('selectedRecord')||!!r.spanId&&r.spanId===params.get('selectedSpan'));
  if(view==='transcript'&&!data.jobs.length&&!data.rows.length)return <Empty title="No agent conversation collected">{data.enabled?'This session has no retained conversation telemetry. Instrumented agents submit conversation reports after a session ends.':'Agent telemetry collection is disabled.'}</Empty>;
  const start = Math.min(...spans.map(s => s.at)), end = Math.max(...spans.map(s => s.end ?? s.at)), duration = Math.max(1, end - start);
  const collection=<>
    {!data.enabled && <Alert kind="warn">Live event collection is disabled. Retained content remains available until expiry.</Alert>}
    <Panel title="Collection details">
      <div style={{ padding: 14, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ flex: '1 1 240px', minWidth: 0 }}>Job <select className="select" aria-label="Telemetry job" value={job} onChange={e => filter('reportJob', e.target.value)}><option value="">All jobs</option>{data.jobs.map(j => <option key={j.jobId} value={j.jobId}>{j.agentName} · {j.jobId}</option>)}</select></label>
        <label style={{ flex: '1 1 140px' }}>Category <select className="select" aria-label="Telemetry category" value={kind} onChange={e => filter('liveKind', e.target.value)}><option value="">All categories</option>{['message','tool','handoff','state','error','metrics','usage','span','log','collection'].map(k => <option key={k}>{k}</option>)}</select></label>
        <form style={{ display: 'contents' }} onSubmit={e => { e.preventDefault(); if (!validTrace) return; setParams(old => { const next = new URLSearchParams(old); for (const [key, value] of [['liveTurn', draftTurn], ['liveTrace', draftTrace]]) value ? next.set(key, value) : next.delete(key); next.delete('livePage'); return next; }); }}>
          <label style={{ flex: '1 1 180px', minWidth: 0 }}>Turn <input className="input" aria-label="Telemetry turn" value={draftTurn} maxLength={200} onChange={e => setDraftTurn(e.target.value)} /></label>
          <label style={{ flex: '1 1 240px', minWidth: 0 }}>Trace <input className="input" aria-label="Telemetry trace" value={draftTrace} maxLength={32} aria-invalid={!validTrace} onChange={e => setDraftTrace(e.target.value)} />{!validTrace && <span className="muted">Use 32 lowercase hexadecimal characters.</span>}</label>
          <button className="btn secondary sm" type="submit" disabled={!validTrace} style={{ alignSelf: 'end' }}>Apply correlation</button>
        </form>
      </div>
      <div style={{ padding: '0 14px 14px' }}>{(selected ? [selected] : data.jobs).map(j => <div key={j.jobId} style={{ marginBottom: 14 }}>
        <div className="badges"><Badge tone={j.state === 'complete' ? 'ok' : j.state === 'incomplete' ? 'warn' : undefined}>{j.state}</Badge><span className="mono">{j.jobId}</span><Badge>{j.mode}</Badge></div>
        <KV items={[
          ['SDK', `${j.sdkLanguage} ${j.sdkVersion ?? 'version unavailable'}`], ['Received / expected', `${j.receivedCount} / ${j.expectedCount ?? 'Awaiting completion'}`],
          ['Dropped', j.droppedCount], ['Last received', fromMsPrecise(j.lastReceived)], ['Content expires', fromMsPrecise(j.expiresAt)],
          ['Participant', j.participantSid ?? 'Not reported'], ['Worker', j.workerId ?? 'Not reported'], ['Coverage', j.capabilities.join(', ')],
        ]} />
        {j.reasons.map(reason => <p className="muted" key={reason}>{reason}</p>)}
      </div>)}{!data.jobs.length && <p>No instrumented agent jobs have submitted telemetry for this session.</p>}
      <p className="muted">Privacy: {data.redaction}. Only submitted SDK measurements are shown. Realtime models may omit separate STT, LLM or TTS stages. Live usage records are cumulative snapshots; final reports supply usage totals.</p></div>
    </Panel>
  </>;
  if(view==='collection')return collection;
  return <>
    {view==='traces'&&<details className="insights-advanced"><summary>Advanced filters and collection details{(turn||trace||kind)&&' · filtered'}</summary>{collection}</details>}
    {view==='traces'&&<Panel title="Trace timeline">
      <div style={{ padding: 14 }}>
        {!spans.length ? <p className="muted">No retained spans match this page and its filters. Tracing must be attached before session start; older reports cannot reconstruct spans.</p> : <>
          <p className="muted">Measured window: {(duration / 1000).toFixed(3)} s. Bars use actual span start/end timestamps. Timeline follows the current page and filters.</p>
          {spans.map(s => <button key={s.id} className="btn secondary" aria-label={`Select trace ${s.name}`} aria-pressed={params.get('selectedSpan')===s.spanId} onClick={() => { setParams(old=>{const next=new URLSearchParams(old);next.set('liveTrace',s.traceId??'');next.set('mediaAt',String(s.at));next.set('selectedSpan',s.spanId??'');next.set('selectedRecord',s.id);next.set('insightView','traces');next.delete('livePage');return next;}); }} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 30%) 1fr', width: '100%', textAlign: 'left', marginBottom: 6, minWidth: 0, gap: 10 }}>
            <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{s.name} · {(((s.end ?? s.at) - s.at) / 1000).toFixed(3)} s{s.status === 'error' && ' · error'}{s.interrupted && ' · interrupted'}</span>
            <span style={{ position: 'relative', alignSelf: 'center', height: 14, background: 'var(--border)' }}><span style={{ display: 'block', position: 'absolute', left: `${(s.at - start) / duration * 100}%`, width: `${Math.max(.5, ((s.end ?? s.at) - s.at) / duration * 100)}%`, height: 14, background: colors[s.stage ?? ''] ?? 'var(--muted)' }} /></span>
          </button>)}
        </>}
      </div>
    </Panel>}
    {view==='transcript'?renderEvents():<details className="insights-advanced"><summary>Raw telemetry events</summary>{renderEvents()}</details>}
    <Drawer open={!!selectedRecord&&params.get('insightDetails')!=='collection'} title="Event details" onClose={()=>setParams(old=>{const next=new URLSearchParams(old);next.delete('selectedRecord');next.delete('selectedSpan');return next;})}>{selectedRecord&&<>
      <p className="insights-selected-text">{selectedRecord.text??selectedRecord.message??selectedRecord.name??selectedRecord.kind}</p>
      <KV items={[["Time",fromMsPrecise(selectedRecord.at)],["Job",selectedRecord.jobId],["Turn",selectedRecord.turnId??'Not reported'],["Trace",selectedRecord.traceId??'Not reported'],["Span",selectedRecord.spanId??'Not reported']]} /><Timing metrics={selectedRecord.metrics}/>
      <Link className="btn secondary sm" to={`/sessions/${encodeURIComponent(sid)}?${new URLSearchParams({tab:'insights',insightView:'logs',reportJob:selectedRecord.jobId,logJob:selectedRecord.jobId,...(selectedRecord.turnId?{logTurn:selectedRecord.turnId}:{}),...(selectedRecord.traceId?{logTrace:selectedRecord.traceId}:{}),...(selectedRecord.spanId?{logSpan:selectedRecord.spanId}:{})})}`}>Related logs</Link>
    </>}</Drawer>
  </>;
  function renderEvents(){return <Panel title={view==='transcript'?'Live conversation':'Telemetry events'}>
      <DataTable rows={view==='transcript'?conversation:data.rows} rowKey={r => r.id} search={false} pageSize={false} empty={{ title: view==='transcript'?'No conversation events on this page':'No retained telemetry matches these filters' }} cols={[
        { key: 'at', header: 'Time', cell: r => <button aria-label={`Seek to event ${r.id}`} aria-pressed={params.get('selectedRecord')===r.id} style={params.get('selectedRecord')===r.id?{borderColor:'var(--accent)'}:undefined} className="btn secondary sm mono" onClick={()=>setParams(old=>{const next=new URLSearchParams(old);next.set('mediaAt',String(r.at));next.set('selectedRecord',r.id);next.set('insightView',view);next.delete('selectedSpan');r.traceId?next.set('liveTrace',r.traceId):next.delete('liveTrace');r.turnId?next.set('liveTurn',r.turnId):next.delete('liveTurn');next.delete('livePage');return next;})}>{fromMsPrecise(r.at)}</button> },
        { key: 'kind', header: 'Event', cell: r => <div className="badges"><Badge>{r.role ?? r.kind}</Badge>{r.interrupted && <Badge tone="warn">Interrupted</Badge>}{(r.isError || r.kind === 'error' || r.status === 'error') && <Badge tone="bad">Error</Badge>}</div> },
        { key: 'content', header: 'Details', wrap: true, cell: r => <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><span>{r.text ?? r.message ?? (r.kind === 'handoff' ? `${r.fromAgent ?? 'Unknown'} → ${r.toAgent}` : r.name ?? r.state ?? r.stage ?? (r.kind === 'usage' ? 'Cumulative usage snapshot' : ''))}</span>{r.kind === 'message' && <TurnTimings role={r.role} metrics={r.metrics}/>}{r.kind === 'tool' && <p className="muted">{r.callId} · {r.status}</p>}{r.kind === 'usage' && <details><summary>Submitted model usage</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.models, null, 2)}</pre></details>}</div> },
      ]} />
      <div style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}><span>{data.total} records · Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button className="btn secondary sm" disabled={data.page <= 1} onClick={() => filter('livePage', String(data.page - 1))}>Previous events</button><button className="btn secondary sm" disabled={data.page * data.pageSize >= data.total} onClick={() => filter('livePage', String(data.page + 1))}>Next events</button></div>
    </Panel>; }
}
