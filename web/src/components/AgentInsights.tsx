import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMe, can } from '../lib/me';
import { useApi } from '../lib/hooks';
import { fromMs, fromMsPrecise } from '../lib/format';
import { Alert, Badge, Empty, KV, Panel, Tabs } from './ui';
import { Drawer } from './Drawer';
import { AgentLogs } from './AgentLogs';
import { type Usage } from './ModelUsage';
import { SessionMetrics } from './SessionMetrics';
import { LiveInsights, useLiveInsightsData } from './LiveInsights';
import { TurnTimings, SessionTimingSummary } from './TurnTimings';
import { SessionRecordings } from './SessionRecordings';

type Item = {
  id: string; type: string; at: number | null; role?: string; text?: string; interrupted?: boolean;
  metrics?: Record<string, number>; name?: string | null; callId?: string | null;
  traceId?: string | null; spanId?: string | null; turnId?: string | null;
  isError?: boolean; fromAgent?: string | null; toAgent?: string;
};
type Content = { schemaVersion: number; items: Item[]; omittedItems: number; usage?: Usage[] | null; omittedUsage?: number };
type Report = {
  roomSid: string; jobId: string; agentName: string; participantSid: string | null; workerId: string | null;
  sdkVersion: string | null; reportedAt: number; receivedAt: number; expiresAt: number; state: string;
};
type Reports = { enabled: boolean; retentionDays: number; total: number; reports: Report[]; selected: (Report & { content: Content | null }) | null };
const views = ['transcript', 'traces', 'logs', 'metrics'] as const;
type View = typeof views[number];
const ms = (value: number | undefined) => value == null ? '—' : `${Math.round(value * 1000).toLocaleString()} ms`;
const metricNames: Record<string, string> = { e2e_latency:'Response latency', llm_node_ttft:'LLM first token', tts_node_ttfb:'TTS first audio', transcription_delay:'Transcription delay', end_of_turn_delay:'End-of-turn delay' };
const text = (item: Item) => item.type === 'message' ? item.text || 'No text recorded' : item.type === 'agent_handoff' ? `${item.fromAgent ?? 'Unknown'} → ${item.toAgent}` : item.name ?? 'Tool';

export function AgentInsights({ sid }: { sid: string }) {
  const me = useMe(), allowed = can(me.data, 'transcripts');
  const [params, setParams] = useSearchParams();
  const jobId = params.get('reportJob') ?? '';
  const view: View = views.includes(params.get('insightView') as View) ? params.get('insightView') as View : params.has('selectedSpan')||params.has('selectedRecord') ? 'traces' : 'transcript';
  const query = useApi<Reports>(['agent-insights', sid, jobId], `/agent-insights/sessions/${encodeURIComponent(sid)}${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`, { enabled: allowed });
  useEffect(()=>{
    const selected=query.data?.selected?.jobId;
    if(!jobId&&selected)setParams(old=>{if(old.get('reportJob'))return old;const next=new URLSearchParams(old);next.set('reportJob',selected);return next;},{replace:true});
  },[jobId,query.data?.selected?.jobId,setParams]);
  const live = useLiveInsightsData(sid);
  function update(key:string,value:string|null) { setParams(old=>{const next=new URLSearchParams(old);value===null?next.delete(key):next.set(key,value);return next;}); }
  function selectJob(job:string) {setParams(old=>{const next=new URLSearchParams(old);job?next.set('reportJob',job):next.delete('reportJob');for(const key of ['reportItem','selectedRecord','selectedSpan','mediaAt','liveTurn','liveTrace','liveKind','livePage','logJob','logTurn','logTrace','logSpan','logPage','transcriptPage','transcriptQ','sessionMetricBand','sessionMetricPage'])next.delete(key);return next;});}
  if (me.isLoading) return <Alert>Checking access…</Alert>;
  if (!allowed) return <><SessionRecordings sid={sid} compact /><Alert>Transcript access is required to view agent reports.</Alert></>;
  const report = query.data?.selected, content = report?.content;
  const selectedItem = content?.items.find(item=>item.id===params.get('reportItem'));
  const transcriptQ=params.get('transcriptQ')??'';
  const transcript=(content?.items??[]).filter(item=>`${item.role??''} ${text(item)}`.toLowerCase().includes(transcriptQ.toLowerCase()));
  const requestedPage=Number(params.get('transcriptPage')??1),pages=Math.max(1,Math.ceil(transcript.length/50));
  const selectedIndex=selectedItem?transcript.indexOf(selectedItem):-1;
  const transcriptPage=selectedIndex>=0?Math.floor(selectedIndex/50)+1:Math.max(1,Math.min(pages,Number.isInteger(requestedPage)?requestedPage:1));
  const collectionOpen = params.get('insightDetails') === 'collection';
  const jobs = new Map((query.data?.reports??[]).map(r=>[r.jobId,r.agentName]));
  for(const job of live.data?.jobs??[])jobs.set(job.jobId,job.agentName);
  const liveJob = live.data?.jobs.find(j=>j.jobId===(jobId||report?.jobId))??(!jobId&&!report&&live.data?.jobs.length===1?live.data.jobs[0]:undefined);
  const status = liveJob?.state ?? report?.state;
  function selectItem(item:Item) {setParams(old=>{const next=new URLSearchParams(old);next.set('reportItem',item.id);next.set('insightView','transcript');next.delete('selectedSpan');next.delete('selectedRecord');if(item.at!==null)next.set('mediaAt',String(item.at));else next.delete('mediaAt');for(const [key,value] of [['liveTrace',item.traceId],['liveTurn',item.turnId]] as const)value?next.set(key,value):next.delete(key);next.delete('livePage');return next;});}
  function selectMetric(metric: string, item?: Item) { setParams(old => {
    const next = new URLSearchParams(old); next.set('insightView', 'metrics'); next.set('sessionMetric', metric);
    for (const key of ['sessionMetricBand', 'sessionMetricPage', 'selectedSpan', 'selectedRecord']) next.delete(key);
    if (item) {
      next.set('reportItem', item.id); item.at === null ? next.delete('mediaAt') : next.set('mediaAt', String(item.at));
      for (const [key, value] of [['liveTurn', item.turnId], ['liveTrace', item.traceId]] as const) value ? next.set(key, value) : next.delete(key);
    }
    return next;
  }); }
  function download() {
    if (!content) return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`${sid}_${report!.jobId}_agent-report.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="insights-workspace">
    <SessionRecordings sid={sid} compact />
    <div className="insights-toolbar">
      {jobs.size>1?<label>Agent job <select className="select" aria-label="Agent report" value={jobId||report?.jobId||''} onChange={e=>selectJob(e.target.value)}>{!report&&!jobId&&<option value="">All jobs</option>}{[...jobs].map(([id,name])=><option key={id} value={id}>{name} · {id}</option>)}</select></label>:<span className="muted">{report?.agentName??live.data?.jobs[0]?.agentName??'Agent insights'}</span>}
      {status&&<Badge tone={status==='incomplete'?'warn':status==='complete'?'ok':undefined}>{status}</Badge>}
      <div className="insights-toolbar-actions">
        <button className="btn secondary sm" onClick={()=>update('insightDetails','collection')}>Session details</button>
        {content&&<button className="btn secondary sm" onClick={download}>Download report</button>}
        {can(me.data,'logs')&&<LiveInsights sid={sid} view="export" />}
      </div>
    </div>
    <Tabs value={view} onChange={v=>update('insightView',v)} tabs={[{id:'transcript',label:'Transcript'},{id:'traces',label:'Traces'},{id:'logs',label:'Session logs'},{id:'metrics',label:'Metrics'}]} />
    {query.error&&<Alert kind="bad">{query.error.message}</Alert>}
    {query.isLoading&&<Alert>Loading agent reports…</Alert>}
    {(query.data&&!query.data.enabled||live.data&&!live.data.enabled)&&<Alert kind="warn">{[query.data&&!query.data.enabled?'Final report':null,live.data&&!live.data.enabled?'Live event':null].filter(Boolean).join(' and ')} collection is disabled. Retained content remains available until expiry.</Alert>}
    {report?.state==='expired'&&<Alert>Conversation content for this report has expired. Identifying metadata remains available in Session details.</Alert>}
    {liveJob?.state==='incomplete'&&<Alert kind="warn">Some session telemetry is missing.{liveJob.reasons.length>0?' '+liveJob.reasons.join(' '):''}</Alert>}
    {view==='transcript'&&content&&<SessionTimingSummary items={content.items} usage={content.usage} onSelect={metric=>selectMetric(metric)}/>}
    {view==='transcript'&&(content?<Panel title="Conversation" actions={<input className="input insights-search" aria-label="Search transcript" placeholder="Search transcript" value={transcriptQ} onChange={e=>setParams(old=>{const next=new URLSearchParams(old);e.target.value?next.set('transcriptQ',e.target.value):next.delete('transcriptQ');next.delete('transcriptPage');return next;})}/>}><div className="insights-transcript">
      {transcript.length?transcript.slice((transcriptPage-1)*50,transcriptPage*50).map((item,index)=><article key={`${item.id}/${index}`} className={`insights-turn ${item.role==='assistant'?'assistant':''} ${params.get('reportItem')===item.id?'selected':''}`}>
        <div className="insights-turn-head"><Badge>{item.role??item.type.replace(/_/g,' ')}</Badge>{item.interrupted&&<Badge tone="warn">Interrupted</Badge>}{item.isError&&<Badge tone="bad">Error</Badge>}<button className="btn ghost sm mono" aria-label={`Seek to report item ${item.id}`} onClick={()=>selectItem(item)}>{item.at===null?'View details':fromMsPrecise(item.at)}</button></div>
        <button className="insights-turn-text" aria-label={`Inspect report item ${item.id}`} onClick={()=>selectItem(item)}>{text(item)}</button>
        <TurnTimings metrics={item.metrics} role={item.role} onSelect={metric=>selectMetric(metric,item)}/>
      </article>):<Empty title={transcriptQ?'No matching conversation':'No conversation recorded'}/>}
    </div>{pages>1&&<div className="insights-pagination"><span className="muted">{transcript.length} items · Page {transcriptPage} of {pages}</span><button className="btn secondary sm" disabled={transcriptPage<=1} onClick={()=>update('transcriptPage',String(transcriptPage-1))}>Previous turns</button><button className="btn secondary sm" disabled={transcriptPage>=pages} onClick={()=>update('transcriptPage',String(transcriptPage+1))}>Next turns</button></div>}{content.omittedItems>0&&<p className="insights-note">{content.omittedItems} system, developer or unsupported items were excluded from collection.</p>}</Panel>:!query.isLoading&&!query.error?(can(me.data,'logs')?<LiveInsights sid={sid} view="transcript" />:<Empty title="No agent session report">{query.data?.enabled?'No final report has been received for this session.':'Agent report collection is disabled.'}</Empty>):null)}
    {view==='traces'&&<LiveInsights sid={sid} view="traces" />}
    {view==='logs'&&<AgentLogs sid={sid} compact />}
    {view==='metrics'&&(content?<>
      <SessionMetrics items={content.items} usage={content.usage} omittedUsage={content.omittedUsage}/>
    </>:<Empty title={report?.state==='expired'?'Session metrics expired':'No final session metrics yet'}>Metrics appear when an instrumented agent submits its final report. Retained live measurements are available in Traces.</Empty>)}
    <Drawer open={collectionOpen||!!selectedItem&&view==='transcript'} title={collectionOpen?'Session details':'Conversation details'} onClose={()=>update(collectionOpen?'insightDetails':'reportItem',null)}>
      {collectionOpen?<>
        {report&&<Panel title="Final report"><KV items={[
          ['Agent',report.agentName],['Job ID',report.jobId],['SDK',report.sdkVersion??'Not reported'],['Participant SID',report.participantSid??'Not reported'],['Worker ID',report.workerId??'Not reported'],['Reported',fromMs(report.reportedAt)],['Received',fromMs(report.receivedAt)],['Content expires',fromMs(report.expiresAt)],
        ]}/></Panel>}
        {query.data&&query.data.total>query.data.reports.length&&<Alert>Showing the latest {query.data.reports.length} of {query.data.total} reports.</Alert>}
        {can(me.data,'logs')&&<LiveInsights sid={sid} view="collection"/>}
        <p className="muted">Final reports supply conversation and model totals. Live telemetry supplies events and spans. Missing stages are unavailable; no measurements are reconstructed.</p>
      </>:selectedItem&&<>
        <p className="insights-selected-text">{text(selectedItem)}</p>
        <KV items={[
          ['Time',fromMsPrecise(selectedItem.at)],['Job',report?.jobId],['Turn',selectedItem.turnId??'Not reported'],['Trace',selectedItem.traceId??'Not reported'],['Span',selectedItem.spanId??'Not reported'],['Tool call',selectedItem.callId??'Not applicable'],
          ...Object.entries(selectedItem.metrics??{}).map(([key,value]):[string,string]=>[metricNames[key]??key.replace(/_/g,' '),key.includes('tokens')?value.toLocaleString():ms(value)]),
        ]}/>
        {can(me.data,'logs')&&<Link className="btn secondary sm" to={`/sessions/${encodeURIComponent(sid)}?${new URLSearchParams({tab:'insights',insightView:'logs',reportJob:report!.jobId,logJob:report!.jobId,...(selectedItem.turnId?{logTurn:selectedItem.turnId}:{}),...(selectedItem.traceId?{logTrace:selectedItem.traceId}:{})})}`}>Related logs</Link>}
      </>}
    </Drawer>
  </div>;
}
