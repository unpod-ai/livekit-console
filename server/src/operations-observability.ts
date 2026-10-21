import { createHash, randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { db } from './db.js';
import { config } from './config.js';
import { OperationsError } from './operations-policy.js';
import { canonicalMeasurements, type Input } from './turn-analytics.js';

db.exec(`CREATE TABLE IF NOT EXISTS operations_collectors(source TEXT PRIMARY KEY,last_receipt INTEGER,source_at INTEGER,last_success INTEGER,last_attempt INTEGER,failures INTEGER NOT NULL DEFAULT 0,receipts INTEGER NOT NULL DEFAULT 0,error TEXT);
 CREATE TABLE IF NOT EXISTS operations_collector_minutes(source TEXT NOT NULL,minute INTEGER NOT NULL,receipts INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(source,minute));
 CREATE TABLE IF NOT EXISTS operations_rules(id TEXT PRIMARY KEY,kind TEXT NOT NULL,source TEXT NOT NULL,threshold REAL NOT NULL,window_seconds INTEGER NOT NULL,enabled INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS operations_alerts(id TEXT PRIMARY KEY,rule_id TEXT NOT NULL,source TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,fingerprint TEXT NOT NULL,value REAL NOT NULL,window_seconds INTEGER NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,ack_at INTEGER,resolved_at INTEGER,UNIQUE(rule_id,fingerprint));`);
export const workerSource=(url:string)=>'worker-'+createHash('sha256').update(url).digest('hex').slice(0,16);
function sources(){return new Map<string,boolean>([['webhook',true],['reports',!!config.telemetryToken],['live',!!config.telemetryToken&&config.telemetryEventsEnabled],['logs',!!config.telemetryToken&&config.agentLogsEnabled],['diagnostics',!!config.telemetryToken&&config.diagnosticsEnabled],['reconcile',true],['egress',true],['traffic',!!config.githubToken],...config.workerUrls.map(url=>[workerSource(url),true] as [string,boolean])]);}
const errors=['authentication','validation','conflict','too_large','unavailable','storage','upstream','timeout'] as const;
type SafeError=typeof errors[number];
export function recordCollector(source:string, result:{ok:boolean;error?:SafeError;sourceAt?:number;receipt?:boolean},at=Date.now()){
 if(!sources().has(source))throw new OperationsError('Unknown collector source');
 if(result.error!==undefined&&!errors.includes(result.error))throw new OperationsError('Unknown collector error category');
 const sourceAt=typeof result.sourceAt==='number'&&Number.isSafeInteger(result.sourceAt)&&result.sourceAt>0&&result.sourceAt<=at+60000?result.sourceAt:null;
 db.prepare(`INSERT INTO operations_collectors(source,last_receipt,source_at,last_success,last_attempt,failures,receipts,error) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET
 last_receipt=COALESCE(excluded.last_receipt,last_receipt),source_at=COALESCE(excluded.source_at,source_at),last_success=COALESCE(excluded.last_success,last_success),last_attempt=excluded.last_attempt,failures=failures+excluded.failures,receipts=receipts+excluded.receipts,error=excluded.error`).run(source,result.ok&&result.receipt?at:null,sourceAt,result.ok?at:null,at,result.ok?0:1,result.ok&&result.receipt?1:0,result.ok?null:result.error??'unavailable');
 db.prepare('INSERT INTO operations_collector_minutes VALUES(?,?,?,?) ON CONFLICT(source,minute) DO UPDATE SET receipts=receipts+excluded.receipts,failures=failures+excluded.failures').run(source,Math.floor(at/60000)*60000,result.ok&&result.receipt?1:0,result.ok?0:1);
}
// Receipt counting belongs to middleware; this hook only adds a validated source timestamp.
export function noteSourceTimestamp(source:string,sourceAt:number){
 try{recordCollector(source,{ok:true,sourceAt});}catch{console.error('Could not persist collector source timestamp');}
}
export function collectorStates(at=Date.now()){
 return [...sources()].map(([source,enabled])=>{
  const row=db.prepare('SELECT * FROM operations_collectors WHERE source=?').get(source);
  const receipts=Number(row?.receipts??0),lastReceipt=row?.last_receipt as number|null??null,sourceAt=row?.source_at as number|null??null;
  const recent=Number(db.prepare('SELECT COALESCE(SUM(receipts),0) n FROM operations_collector_minutes WHERE source=? AND minute>=?').get(source,at-3600000)!.n);
  return {source,enabled,state:!enabled?'disabled':!row?'unknown':row.error?'error':'ok',lastReceipt,sourceAt,lagMs:lastReceipt!==null&&sourceAt!==null?Math.max(0,lastReceipt-sourceAt):null,lastSuccess:row?.last_success??null,lastAttempt:row?.last_attempt??null,failures:Number(row?.failures??0),receipts,error:row?.error??null,recentReceipts:recent,receiptsPerMinute:recent/60};
 });
}
export function observeIngestion(source:string):RequestHandler {
 return (req,res,next)=>{
  const actual=source==='telemetry'?(req.path.includes('session-reports')?'reports':req.path.includes('logs')?'logs':req.path.includes('diagnostic')?'diagnostics':'live'):source;
  res.once('finish',()=>{
   if(!sources().has(actual))return;
   const status=res.statusCode,error:SafeError=status===401||status===403?'authentication':status===409?'conflict':status===413?'too_large':status<500?'validation':'storage';
   try{recordCollector(actual,{ok:status<400,receipt:status<400,...(status>=400?{error}:{})});}catch{console.error('Could not persist collector observation');}
  });next();
 };
}
export const ruleKinds=['worker_down','source_stale','ingestion_failures','failed_calls','failed_egress','latency_ms','quality_rtt_ms','quality_packet_loss_pct'] as const;
type Rule={id:string;kind:typeof ruleKinds[number];source:string;threshold:number;windowSeconds:number;enabled:boolean};
export function ruleRows():Rule[]{return db.prepare('SELECT id,kind,source,threshold,window_seconds AS windowSeconds,enabled FROM operations_rules ORDER BY id LIMIT 100').all().map(r=>({...r,enabled:!!r.enabled})) as Rule[];}
export function saveRule(value:unknown,id?:string):Rule{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationsError('Invalid alert rule');
 const existing=id?ruleRows().find(r=>r.id===id):undefined;if(id&&!existing)throw new OperationsError('Rule not found',404);
 const patch=value as Record<string,unknown>;
 if(Object.keys(patch).some(k=>!['kind','source','threshold','windowSeconds','enabled'].includes(k)))throw new OperationsError('Unknown alert rule field');
 const r={...existing,...patch,id:id??randomUUID()} as Rule;
 if(!ruleKinds.includes(r.kind)||!sources().has(r.source)||!Number.isFinite(r.threshold)||r.threshold<=0||r.threshold>1e12||!Number.isInteger(r.windowSeconds)||r.windowSeconds<10||r.windowSeconds>7*86400||typeof r.enabled!=='boolean')throw new OperationsError('Invalid rule kind, source, threshold, window or enablement');
 const allowed=r.kind==='worker_down'?r.source.startsWith('worker-'):r.kind.startsWith('quality_')||r.kind==='failed_calls'?r.source==='diagnostics':r.kind==='failed_egress'?r.source==='egress':r.kind==='latency_ms'?['reports','live'].includes(r.source):true;
 if(!allowed)throw new OperationsError('Rule source does not measure this condition');
 if(!id&&ruleRows().length>=100)throw new OperationsError('At most 100 alert rules');
 db.prepare('INSERT INTO operations_rules VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,source=excluded.source,threshold=excluded.threshold,window_seconds=excluded.window_seconds,enabled=excluded.enabled').run(r.id,r.kind,r.source,r.threshold,r.windowSeconds,Number(r.enabled));return r;
}
function latency(source:string,from:number,at:number):{value:number;fingerprint:string}|null{
 const reports=source==='reports'?db.prepare(`SELECT room_sid,job_id,agent_name,received_at,expires_at,json_extract(i.value,'$.id') item_id,json_extract(i.value,'$.role') role,json_extract(i.value,'$.at') at,json_extract(i.value,'$.metrics') metrics FROM agent_session_reports r,json_each(r.content,'$.items') i WHERE r.content IS NOT NULL AND r.expires_at>? AND json_extract(i.value,'$.at')>=? AND json_extract(i.value,'$.at')<=? LIMIT 10001`).all(at,from,at):db.prepare(`SELECT r.room_sid,r.job_id,j.agent_name,r.received_at,r.expires_at,r.id item_id,json_extract(r.content,'$.role') role,r.at,json_extract(r.content,'$.metrics') metrics,json_extract(r.content,'$.messageId') message_id FROM agent_live_records r JOIN agent_live_jobs j USING(room_sid,job_id) WHERE r.kind='message' AND r.content IS NOT NULL AND r.expires_at>? AND r.at>=? AND r.at<=? LIMIT 10001`).all(at,from,at);
 if(reports.length>10000)return null;
 const inputs=reports.map(r=>({kind:source==='reports'?'report':'message',roomSid:r.room_sid,jobId:r.job_id,agentName:r.agent_name,itemId:r.item_id,messageId:r.message_id,role:r.role,at:r.at,expiresAt:r.expires_at,receivedAt:r.received_at,metrics:r.metrics?JSON.parse(r.metrics as string):{}})) as Input[];
 const rows=canonicalMeasurements(inputs,at).filter(r=>r.metric==='e2e_latency');if(!rows.length)return null;
 const worst=rows.reduce((a,b)=>a.valueMs>=b.valueMs?a:b);return {value:worst.valueMs,fingerprint:createHash('sha256').update(worst.id+':'+worst.at+':'+worst.valueMs).digest('hex')};
}
function measurement(r:Rule,at:number):{value:number;fingerprint:string}|null{
 const from=at-r.windowSeconds*1000,c=db.prepare('SELECT * FROM operations_collectors WHERE source=?').get(r.source);
 if(r.kind==='source_stale')return c?.last_success?{value:(at-Number(c.last_success))/1000,fingerprint:String(c.last_success)}:null;
 if(r.kind==='worker_down'||r.kind==='ingestion_failures'){
  if(r.kind==='worker_down'&&(!c?.error||Number(c.last_attempt)<from))return null;
  // Counters are minute rollups; retain the first partial minute rather than omit valid failures.
  const m=db.prepare('SELECT SUM(failures) n,MAX(CASE WHEN failures>0 THEN minute END) at FROM operations_collector_minutes WHERE source=? AND minute>=? AND minute<=?').get(r.source,Math.floor(from/60000)*60000,Math.floor(at/60000)*60000)!;
  return m.at?{value:Number(m.n),fingerprint:String(m.at)+':'+m.n}:null;
 }
 if(r.kind==='latency_ms')return latency(r.source,from,at);
 if(r.kind==='failed_egress'){const m=db.prepare("SELECT COUNT(*) n,MAX(COALESCE(ended_at,started_at)) at FROM egress WHERE status IN ('EGRESS_FAILED','EGRESS_ABORTED','EGRESS_LIMIT_REACHED','4','5','6') AND COALESCE(ended_at,started_at)>=? AND COALESCE(ended_at,started_at)<=?").get(from,at)!;return m.at?{value:Number(m.n),fingerprint:String(m.at)+':'+m.n}:null;}
 if(r.kind==='failed_calls'){
  const m=db.prepare(`WITH outcomes AS (
   SELECT call_id,at,json_extract(content,'$.code') code,LOWER(json_extract(content,'$.stage')) stage,
    ROW_NUMBER() OVER(PARTITION BY call_id ORDER BY at DESC,received_at DESC,rowid DESC) position
   FROM diagnostic_records WHERE kind='sip' AND content IS NOT NULL AND expires_at>? AND at>=? AND at<=? AND call_id IS NOT NULL
    AND LOWER(json_extract(content,'$.stage')) IN ('rejected','failed','failure','error','denied','timeout','aborted','answered','success','completed')
   ) SELECT COUNT(*) value,MAX(at) at FROM outcomes WHERE position=1 AND stage IN ('rejected','failed','failure','error','denied','timeout','aborted') AND (code IS NULL OR code>=400 AND code NOT IN (401,407))`).get(at,from,at)!;
  return m.at!==null?{value:Number(m.value),fingerprint:String(m.at)+':'+m.value}:null;
 }
 const field=r.kind==='quality_rtt_ms'?'$.metrics.rttMs':'$.metrics.packetLossPct';
 const m=db.prepare(`SELECT MAX(json_extract(content,?)) value,MAX(at) at FROM diagnostic_records WHERE kind='quality' AND content IS NOT NULL AND expires_at>? AND at>=? AND at<=? AND json_type(content,?) IN ('integer','real')`).get(field,at,from,at,field)!;
 return m.at!==null&&m.value!==null?{value:Number(m.value),fingerprint:String(m.at)+':'+m.value}:null;
}
export function evaluateAlerts(at=Date.now()){
 const enabled=sources();
 for(const r of ruleRows())if(r.enabled&&enabled.get(r.source)){
  const m=measurement(r,at);if(!m||m.value<r.threshold)continue;
  const active=db.prepare("SELECT id FROM operations_alerts WHERE rule_id=? AND state IN ('open','acknowledged') LIMIT 1").get(r.id);
  if(active){db.prepare('UPDATE operations_alerts SET last_at=?,value=? WHERE id=?').run(at,m.value,active.id!);db.prepare('UPDATE OR IGNORE operations_alerts SET fingerprint=? WHERE id=?').run(m.fingerprint,active.id!);continue;}
  db.prepare("INSERT OR IGNORE INTO operations_alerts(id,rule_id,source,kind,state,fingerprint,value,window_seconds,first_at,last_at) VALUES(?,?,?,?,'open',?,?,?,?,?)").run(randomUUID(),r.id,r.source,r.kind,m.fingerprint,m.value,r.windowSeconds,at,at);
 }
 db.prepare('DELETE FROM operations_collector_minutes WHERE minute<?').run(at-30*86400000);
}
export function alertRows(){return db.prepare('SELECT id,rule_id AS ruleId,source,kind,state,value,window_seconds AS windowSeconds,first_at AS firstAt,last_at AS lastAt,ack_at AS ackAt,resolved_at AS resolvedAt FROM operations_alerts ORDER BY last_at DESC LIMIT 500').all();}
export function transitionAlert(id:string,state:'acknowledged'|'resolved'){
 const row=db.prepare('SELECT state FROM operations_alerts WHERE id=?').get(id);if(!row)throw new OperationsError('Alert not found',404);
 if(row.state==='resolved'&&state==='acknowledged')throw new OperationsError('Resolved alerts cannot be acknowledged');
 db.prepare(`UPDATE operations_alerts SET state=?,${state==='acknowledged'?'ack_at':'resolved_at'}=COALESCE(${state==='acknowledged'?'ack_at':'resolved_at'},?) WHERE id=?`).run(state,Date.now(),id);
 return alertRows().find(r=>r.id===id);
}
