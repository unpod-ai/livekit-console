import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRange } from '../lib/range';
import { useApi } from '../lib/hooks';
import { useMe, can } from '../lib/me';
import { latencySummary, fromMsPrecise } from '../lib/format';
import { Alert, Badge, KV, Kpi, Kpis, Empty, PageHeader, Panel, Tabs } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { Drawer } from '../components/Drawer';
import { ModelUsage, type Usage } from '../components/ModelUsage';
import '../components/metrics.css';
import { PerformanceChart } from '../components/PerformanceChart';
const METRICS:Record<string,string>={e2e_latency:'Response latency',llm_node_ttft:'LLM first token',tts_node_ttfb:'TTS first audio',transcription_delay:'Transcription delay',end_of_turn_delay:'End-of-turn delay', on_user_turn_completed_delay: 'Turn callback delay',stt_duration:'STT node duration',llm_duration:'LLM node duration',tts_duration:'TTS node duration',tool_duration:'Tool duration'};
type Group={agentName:string;count:number;p50:number|null;p90:number|null;p95:number|null;p99:number|null};
type Sample={id:string;roomSid:string;jobId:string;agentName:string;itemId:string;recordId?:string|null;at:number;valueMs:number;metric:string;source:string;traceId:string|null;spanId:string|null;turnId:string|null;interrupted:boolean;isError:boolean};
type Data={from:number;to:number;bucketMs:number;metric:string;metricLabel:string;agents:string[];groups:Group[];series:(Group&{t:number})[];stages:{metric:string;label:string;groups:Group[]}[];models:Usage[];usageCoverage:{totalReports:number;usageReports:number;expiredReports:number;missingUsageReports:number;omittedUsage?:number};modelsByAgent:{agentName:string;models:Usage[]}[];totalSamples:number;totalContributors:number;rows:Sample[];page:number;pageSize:number;selected:Sample|null;bucket:number|null};
const fmt=(n:number|null)=>n===null?'Unavailable':`${n.toFixed(2)} ms`;
const local=(at:number)=>{const d=new Date(at);if(!Number.isFinite(d.getTime()))return '';return new Date(at-d.getTimezoneOffset()*60000).toISOString().slice(0,19);};
const link=(s:Sample)=>`/sessions/${encodeURIComponent(s.roomSid)}?${new URLSearchParams({tab:'insights',insightView:s.source==='final_report'?'transcript':'traces',reportJob:s.jobId,mediaAt:String(s.at),...(s.source==='final_report'?{reportItem:s.itemId}:{selectedRecord:s.recordId??s.itemId,...(s.source==='native_span'?{selectedSpan:s.spanId??s.itemId}:{})}),...(s.traceId?{liveTrace:s.traceId}:{}),...(s.turnId?{liveTurn:s.turnId}:{})})}`;
export function Performance({initialAgent}:{initialAgent?:string}) {
 const me=useMe(),admin=can(me.data, 'transcripts'),{hours}=useRange(),[params,setParams]=useSearchParams();
 const anchor=useMemo(()=>Date.now(),[hours]);
 const from=Number(params.get('perfFrom')??anchor-hours*3600000),to=Number(params.get('perfTo')??anchor);
 const selectedAgents=params.get('perfAgents')??JSON.stringify(initialAgent?[initialAgent]:[]),metric=params.get('perfMetric')??'e2e_latency';
 const relative=!params.has('perfFrom')&&!params.has('perfTo');
 const [rangeDirty,setRangeDirty]=useState(false);
 const page=params.get('perfPage')??'1',bucket=params.get('perfBucket'),sample=params.get('perfSample');
 const [draftFrom,setDraftFrom]=useState(local(from)),[draftTo,setDraftTo]=useState(local(to));
 useEffect(()=>{if(Number.isFinite(from)&&Number.isFinite(to)){setDraftFrom(local(from));setDraftTo(local(to));}},[from,to]);
 const query=new URLSearchParams({from:String(from),to:String(to),agents:selectedAgents,metric,page,...(bucket?{bucket}:{}),...(sample?{sample}:{})});
 const result=useApi<Data>(['performance',query.toString()],()=>{const next=new URLSearchParams(query);if(relative){const end=Date.now();next.set('from',String(end-hours*3600000));next.set('to',String(end));}return `/agent-insights/analytics?${next}`;},{enabled:admin});
 useEffect(()=>{if(relative&&!rangeDirty&&result.data){setDraftFrom(local(result.data.from));setDraftTo(local(result.data.to));}},[relative,rangeDirty,result.data?.from,result.data?.to]);
 function update(values:Record<string,string|null>,clear=true){setParams(old=>{const next=new URLSearchParams(old);if(clear)for(const key of ['perfPage','perfBucket','perfSample','perfContributors'])next.delete(key);for(const[k,v]of Object.entries(values))v===null?next.delete(k):next.set(k,v);return next;});}
 function range(a:number,b:number){setRangeDirty(false);update({perfFrom:String(a),perfTo:String(b)});}
 let agents:string[]=[];try{const parsed=JSON.parse(selectedAgents);if(Array.isArray(parsed))agents=parsed.filter(v=>typeof v==='string');}catch{/* The server returns an explicit invalid-filter error. */}
 if(me.isLoading)return <Alert>Checking access…</Alert>;
 if(!admin)return <Alert>Measured agent analytics requires transcripts access.</Alert>;
 const data=result.data;
 const view=params.get('perfView')==='usage'?'usage':'latency';
 return <>
  {!initialAgent&&<PageHeader crumbs={[{label:'Console'},{label:'Agent analytics'}]} title="Agent performance" sub="Measured turn timings, stage durations and final-report usage" range/>}
  <div className="metrics-toolbar"><label>Measurement <select className="select" aria-label="Performance metric" value={metric} onChange={e=>update({perfMetric:e.target.value})}>{Object.entries(METRICS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><span className="muted">{relative?'Using header range':'Custom time range'}</span><button className="btn secondary sm" onClick={()=>update({perfContributors:'1',...(data?{perfFrom:String(data.from),perfTo:String(data.to)}:{})},false)}>View contributing measurements</button></div>
  <details className="metrics-help"><summary>Advanced filters</summary><Panel title="Exact range and agent comparison">
   <form onSubmit={e=>{e.preventDefault();const a=new Date(draftFrom).getTime(),b=new Date(draftTo).getTime();if(Number.isFinite(a)&&Number.isFinite(b))range(a,b);}} style={{padding:14,display:'flex',gap:12,flexWrap:'wrap'}}>
    <label style={{flex:'1 1 200px',minWidth:0}}>From<input className="input" aria-label="Performance from" type="datetime-local" step="1" required value={draftFrom} onChange={e=>{setRangeDirty(true);setDraftFrom(e.target.value);}}/></label>
    <label style={{flex:'1 1 200px',minWidth:0}}>To<input className="input" aria-label="Performance to" type="datetime-local" step="1" required value={draftTo} onChange={e=>{setRangeDirty(true);setDraftTo(e.target.value);}}/></label>
    <button className="btn secondary sm" style={{alignSelf:'end'}}>Apply range</button><button type="button" className="btn secondary sm" style={{alignSelf:'end'}} onClick={()=>{setRangeDirty(false);update({perfFrom:null,perfTo:null});}}>Use header range</button><button type="button" className="btn secondary sm" style={{alignSelf:'end'}} onClick={()=>{setRangeDirty(false);update({perfAgents:'[]',perfMetric:'e2e_latency',perfFrom:null,perfTo:null});}}>Reset filters</button>
   </form>
   <div style={{padding:'0 14px 14px',display:'flex',gap:12,flexWrap:'wrap'}}><span className="muted">Compare up to four agents; leave all clear for the server.</span>{(data?.agents??agents).map(name=><label key={name} style={{overflowWrap:'anywhere'}}><input type="checkbox" checked={agents.includes(name)} disabled={!agents.includes(name)&&agents.length>=4} onChange={e=>update({perfAgents:JSON.stringify(e.target.checked?[...agents,name]:agents.filter(a=>a!==name))})}/> {name}</label>)}</div>
  </Panel></details>
  {result.error&&<Alert kind="bad">{(result.error as Error).message}</Alert>}
  {!data&&!result.error&&<Alert>Loading measured analytics…</Alert>}
  {data&&<>
   <Tabs value={view} onChange={v=>update({perfView:v,perfContributors:null})} tabs={[{id:'latency',label:'Latency'},{id:'usage',label:'Model usage'}]}/>
   <details className="metrics-help"><summary>Measurement methodology</summary><p>Timing percentiles use nearest rank over retained measured samples, including marked interrupted/error turns. Message metrics prefer final reports over live updates; stage durations use native node spans. Missing/expired measurements are excluded. Usage is attributed by report time; no provider cost is inferred. Each stage has its own sample population; stage percentiles are never combined.</p></details>
   {view==='latency'&&(data.totalSamples>0?<>
   <Kpis>{data.groups.filter(g=>g.count>0).slice(0,4).flatMap(group=>[<Kpi key={group.agentName+'/p50'} label={`${group.agentName} · ${data.metricLabel} p50`} value={latencySummary(group.p50)} foot={`${group.count} measured samples`}/>,<Kpi key={group.agentName+'/p95'} label={`${group.agentName} · p95`} value={latencySummary(group.p95)}/>])}</Kpis>
   <Panel title="Latency over time"><PerformanceChart rows={data.series} from={data.from} to={data.to} bucketMs={data.bucketMs} bucket={data.bucket} onBucket={t=>update({perfBucket:String(t),perfFrom:String(data.from),perfTo:String(data.to)},true)} onRange={range}/></Panel>
   <Panel title={`${data.metricLabel} comparison`}><DataTable rows={data.groups} search={false} pageSize={false} rowKey={r=>r.agentName} empty={{title:'No measured samples for these agents and range'}} cols={[
    {key:'agent',header:'Agent',wrap:true,cell:r=><Link className="rowlink" to={`/agents/${encodeURIComponent(r.agentName)}`}>{r.agentName}</Link>},{key:'count',header:'Samples',cell:r=>r.count},...(['p50','p90','p95','p99'] as const).map(key=>({key,header:key,cell:(r:Group)=>fmt(r[key])})),
   ]}/></Panel>
   <Panel title="Stage and response breakdown"><DataTable rows={data.stages.flatMap(stage=>stage.groups.map(group=>({...group,metric:stage.metric,label:stage.label})))} search={false} pageSize={false} rowKey={r=>r.agentName+'/'+r.metric} empty={{title:'No measured stages available'}} cols={[
    {key:'agent',header:'Agent',wrap:true,cell:r=>r.agentName},{key:'stage',header:'Measurement',cell:r=><button className="btn secondary sm" onClick={()=>update({perfMetric:r.metric})}>{r.label}</button>},{key:'count',header:'Samples',cell:r=>r.count},{key:'p50',header:'p50',cell:r=>fmt(r.p50)},{key:'p95',header:'p95',cell:r=>fmt(r.p95)},
   ]}/></Panel>
   <Drawer wide open={params.get('perfContributors')==='1'||!!bucket||!!sample||params.has('perfPage')} title={sample?'Contributing measurement':data.bucket===null?'Exact contributing measurements':`Contributors: ${fromMsPrecise(data.bucket)} bucket`} onClose={()=>update({perfContributors:null,perfBucket:null,perfSample:null,perfPage:null},false)}>
    {sample?<><button className="btn secondary sm" onClick={()=>update({perfSample:null,perfContributors:'1'},false)}>Back to contributors</button>{data.selected?<>
      <KV items={[["Agent",data.selected.agentName],["Metric",data.metricLabel],["Value",fmt(data.selected.valueMs)],["Time",fromMsPrecise(data.selected.at)],["Source",data.selected.source],["Job",data.selected.jobId],["Native item",data.selected.itemId],["Trace",data.selected.traceId??'Not reported'],["Span",data.selected.spanId??'Not reported'],["Turn",data.selected.turnId??'Not reported']]}/><Link className="btn secondary" to={link(data.selected)}>Open session at measurement</Link>
    </>:<Alert>This sample is unavailable in the selected range/filter or its content has expired.</Alert>}</>:<>
    {data.bucket!==null&&<button className="btn secondary sm" onClick={()=>update({perfBucket:null,perfContributors:'1'},false)}>Clear bucket</button>}
    <DataTable rows={data.rows} pageSize={false} search={false} rowKey={r=>r.id} empty={{title:'No samples contributed to this selection'}} cols={[
     {key:'agent',header:'Agent',wrap:true,cell:r=>r.agentName},{key:'at',header:'Measured at',cell:r=>fromMsPrecise(r.at)},{key:'value',header:'Latency',cell:r=><button className="btn secondary sm" onClick={()=>update({perfSample:r.id,perfFrom:String(data.from),perfTo:String(data.to)},false)}>{fmt(r.valueMs)}</button>},
     {key:'source',header:'Source',cell:r=><div className="badges"><Badge>{r.source.replace(/_/g,' ')}</Badge>{r.interrupted&&<Badge tone="warn">Interrupted</Badge>}{r.isError&&<Badge tone="bad">Error</Badge>}</div>},{key:'session',header:'Session',wrap:true,cell:r=><Link className="rowlink mono" to={link(r)}>{r.roomSid}</Link>},
    ]}/>
    <div style={{padding:12,display:'flex',gap:12,flexWrap:'wrap',justifyContent:'flex-end'}}><span>{data.totalContributors} contributors · Page {data.page} of {Math.max(1,Math.ceil(data.totalContributors/data.pageSize))}</span><button className="btn secondary sm" disabled={data.page<=1} onClick={()=>update({perfPage:String(data.page-1)},false)}>Previous measurements</button><button className="btn secondary sm" disabled={data.page*data.pageSize>=data.totalContributors} onClick={()=>update({perfPage:String(data.page+1)},false)}>Next measurements</button></div>
   </>}
   </Drawer>
   </>:<Empty title="No measured agent latency">No retained turn measurements match this metric, agents and range. Model usage is available separately when reported.</Empty>)}
   {view==='usage'&&<>
   {(data.usageCoverage.expiredReports>0||data.usageCoverage.missingUsageReports>0)&&<Alert kind="warn">Usage coverage is incomplete: {data.usageCoverage.expiredReports} expired reports · {data.usageCoverage.missingUsageReports} reports without usage. Missing data is excluded, not counted as zero.</Alert>}
   <p className="muted">{data.usageCoverage.usageReports} reports with usage / {data.usageCoverage.totalReports} in range · {data.usageCoverage.expiredReports} expired · {data.usageCoverage.missingUsageReports} not reported</p>
   <ModelUsage title="Final-report model usage" usage={data.models} omitted={data.usageCoverage.omittedUsage} scope="server"/>
   {data.modelsByAgent.length>1&&<details className="context-help"><summary>Usage by agent</summary>{data.modelsByAgent.map(agent=><ModelUsage key={agent.agentName} title={`Model usage · ${agent.agentName}`} usage={agent.models} scope="agent"/>)}</details>}
   </>}
  </>}
 </>;
}
