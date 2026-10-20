import { Router } from 'express';
import { db } from './db.js';
import { canonicalMeasurements, summarizeMeasurements, METRICS, MeasurementLimitError, type Input, type Metric } from './turn-analytics.js';
import { aggregateAgentUsage, type UsageReport } from './agent-usage.js';
export const performance=Router();
class QueryError extends Error { constructor(message:string,public status=422){super(message);} }
const integer=(v:unknown,fallback:number)=>{if(v===undefined)return fallback;if(typeof v!=='string'||!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v)))throw new QueryError('Invalid range or page');return Number(v);};
performance.get('/analytics',(req,res)=>{
 try{
  const now=Date.now(),to=integer(req.query.to,now),from=integer(req.query.from,to-86400000),pageRequested=integer(req.query.page,1);
  if(from<0||to<=from||to-from>90*86400000||to>now+60000||pageRequested<1||pageRequested>1000000)throw new QueryError('Choose a valid range of at most 90 days');
  const metric=(req.query.metric??'e2e_latency') as Metric;if(typeof metric!=='string'||!Object.hasOwn(METRICS,metric))throw new QueryError('Unknown measured metric');
  let agents:string[]=[];
  if(req.query.agents!==undefined){if(typeof req.query.agents!=='string'||req.query.agents.length>2000)throw new QueryError('Invalid agents');try{agents=JSON.parse(req.query.agents);}catch{throw new QueryError('Invalid agents');}if(!Array.isArray(agents)||agents.length>4||agents.some(a=>typeof a!=='string'||!a||a.length>200))throw new QueryError('Compare at most four agent names');agents=[...new Set(agents)];}
  const availableAgents=(db.prepare('SELECT agent_name FROM agent_session_reports UNION SELECT agent_name FROM agent_live_jobs ORDER BY agent_name LIMIT 1000').all() as {agent_name:string}[]).map(r=>r.agent_name);
  if (!agents.length && availableAgents.length>100) throw new QueryError('Select up to four agents to investigate this larger project',413);
  const clause=agents.length?` AND agent_name IN (${agents.map(()=>'?').join(',')})`:'';
  function* inputs():Iterable<Input>{
   let count=0;
   const reports=db.prepare(`SELECT r.room_sid,r.job_id,r.agent_name,r.expires_at,r.received_at,json_extract(i.value,'$.id') AS item_id,json_extract(i.value,'$.role') AS role,json_extract(i.value,'$.at') AS at,json_extract(i.value,'$.metrics') AS metrics,json_extract(i.value,'$.interrupted') AS interrupted
     FROM agent_session_reports r,json_each(r.content,'$.items') i WHERE r.content IS NOT NULL AND r.expires_at>? AND json_extract(i.value,'$.at')>=? AND json_extract(i.value,'$.at')<?${clause} LIMIT 100001`).iterate(now,from,to,...agents);
   for(const r of reports){if(++count>100000)throw new QueryError('Too many source records; narrow the range or selected agents',413);yield {kind:'report',roomSid:r.room_sid as string,jobId:r.job_id as string,agentName:r.agent_name as string,itemId:r.item_id as string,role:r.role as string,at:r.at as number,expiresAt:r.expires_at as number,receivedAt:r.received_at as number,metrics:r.metrics?JSON.parse(r.metrics as string):{},interrupted:!!r.interrupted};}
   const liveClause=clause.replace(/agent_name/g,'j.agent_name');
   const live=db.prepare(`SELECT r.room_sid,r.job_id,j.agent_name,r.id,r.kind,r.at,r.received_at,r.expires_at,r.trace_id,r.span_id,r.turn_id,
      json_extract(r.content,'$.messageId') AS message_id,json_extract(r.content,'$.role') AS role,json_extract(r.content,'$.name') AS span_name,json_extract(r.content,'$.end') AS end,
      json_extract(r.content,'$.metrics') AS metrics,json_extract(r.content,'$.interrupted') AS interrupted,json_extract(r.content,'$.status') AS status
      FROM agent_live_records r JOIN agent_live_jobs j ON j.room_sid=r.room_sid AND j.job_id=r.job_id WHERE r.content IS NOT NULL AND r.expires_at>? AND r.at>=? AND r.at<? AND r.kind IN ('message','span')${liveClause} ORDER BY r.received_at,r.rowid LIMIT 100001`).iterate(now,from,to,...agents);
   count=0;for(const r of live){if(++count>100000)throw new QueryError('Too many live records; narrow the range or selected agents',413);yield {kind:r.kind as string,roomSid:r.room_sid as string,jobId:r.job_id as string,agentName:r.agent_name as string,itemId:r.id as string,messageId:r.message_id as string|null,role:r.role as string,at:r.at as number,end:r.end as number|null,expiresAt:r.expires_at as number,receivedAt:r.received_at as number,metrics:r.metrics?JSON.parse(r.metrics as string):{},spanName:r.span_name as string,traceId:r.trace_id as string|null,spanId:r.span_id as string|null,turnId:r.turn_id as string|null,interrupted:!!r.interrupted,isError:r.status==='error'};}
  }
  const measurements=canonicalMeasurements(inputs(),now),span=to-from,bucketMs=span<=300000?1000:span<=1800000?10000:span<=7200000?60000:span<=43200000?300000:span<=172800000?3600000:86400000;
  const summary=summarizeMeasurements(measurements,{from,to,metric,agents,bucketMs});
  const bucketFrom=req.query.bucket===undefined?null:integer(req.query.bucket,from);
  if(bucketFrom!==null&&(bucketFrom<Math.floor(from/bucketMs)*bucketMs||bucketFrom>=to||bucketFrom%bucketMs!==0))throw new QueryError('Invalid chart bucket');
  const samples=bucketFrom===null?summary.samples:summary.samples.filter(s=>s.at>=bucketFrom&&s.at<bucketFrom+bucketMs);
  const pageSize=50,page=Math.min(pageRequested,Math.max(1,Math.ceil(samples.length/pageSize)));
  const usageRows=db.prepare(`SELECT room_sid,job_id,agent_name,reported_at,expires_at,(content IS NOT NULL AND expires_at>?) AS retained,
    CASE WHEN expires_at>? THEN json_extract(content,'$.usage') END AS usage,CASE WHEN expires_at>? THEN COALESCE(json_extract(content,'$.omittedUsage'),0) ELSE 0 END AS omitted
    FROM agent_session_reports WHERE reported_at>=? AND reported_at<?${clause} ORDER BY reported_at DESC LIMIT 50001`).all(now,now,now,from,to,...agents);
  if(usageRows.length>50000)throw new QueryError('Too many usage reports; narrow the range',413);
  const usage=usageRows.map(r=>({roomSid:r.room_sid as string,jobId:r.job_id as string,agentName:r.agent_name as string,reportedAt:r.reported_at as number,expiresAt:r.expires_at as number,retained:!!r.retained,sessionAvailable:true,usage:r.usage?JSON.parse(r.usage as string):null,omittedUsage:r.omitted as number}));
  const usageSummary=aggregateAgentUsage(usage,from,to,null,1);
  const compareAgents=agents.length?agents:[...new Set([...measurements.map(s=>s.agentName),...usage.map(u=>u.agentName)])].sort();
  const stages=Object.keys(METRICS).map(m=>({metric:m,label:METRICS[m as Metric],groups:summarizeMeasurements(measurements,{from,to,metric:m as Metric,agents,bucketMs}).groups}));
  const selected=typeof req.query.sample==='string'&&req.query.sample.length<=2000?samples.find(s=>s.id===req.query.sample)??null:null;
  const groups=compareAgents.map(agentName=>summary.groups.find(g=>g.agentName===agentName)??{agentName,count:0,p50:null,p90:null,p95:null,p99:null});
  res.json({from,to,bucketMs,metric,metricLabel:METRICS[metric],percentileMethod:'nearest rank',agents:availableAgents,selectedAgents:agents,groups,series:summary.series,stages,
   models:usageSummary.models,usageCoverage:usageSummary.coverage,modelsByAgent:compareAgents.map(agentName=>({agentName,...aggregateAgentUsage(usage.filter(u=>u.agentName===agentName) as UsageReport[],from,to,null,1)})),
   totalSamples:summary.samples.length,totalContributors:samples.length,rows:samples.slice((page-1)*pageSize,page*pageSize),page,pageSize,selected,bucket:bucketFrom});
 }catch(error){const known=error instanceof QueryError||error instanceof MeasurementLimitError;res.status(error instanceof MeasurementLimitError?413:error instanceof QueryError?error.status:500).json({error:known?error.message:'Could not calculate measured analytics'});}
});
