import { statSync } from 'node:fs';
import { db } from './db.js';
import { config } from './config.js';
import { redactContent } from './telemetry-privacy.js';
import { operationsStores } from './operations-stores.js';

const DAY = 86400000;
export const categoryNames = ['reports','live','logs','diagnostics','history','workers','traffic','recordings'] as const;
export type Category = typeof categoryNames[number];
export class OperationsError extends Error { constructor(message: string, public status = 422) { super(message); } }
type CategoryPolicy = { retentionDays: number | null; accessEnabled?: boolean };
type Policy = { categories: Record<Category, CategoryPolicy>; redaction: 'off'|'standard'|'strict'; redactTerms: string[] };
export const bounds = { minDays:1,maxDays:3650,maxTerms:50,maxTermLength:200,exportRows:10000,exportBytes:8*1024*1024 };
db.exec(`CREATE TABLE IF NOT EXISTS operations_policy(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS operations_deleted_jobs(category TEXT NOT NULL,room_sid TEXT NOT NULL,job_id TEXT NOT NULL,PRIMARY KEY(category,room_sid,job_id));`);
const defaults = (): Policy => ({ categories: {
 reports:{retentionDays:config.telemetryRetentionDays},live:{retentionDays:config.liveRetentionDays},logs:{retentionDays:config.logRetentionDays},
 diagnostics:{retentionDays:config.diagnosticsRetentionDays},history:{retentionDays:config.historyRetentionDays},workers:{retentionDays:config.workerRollupRetentionDays},traffic:{retentionDays:config.trafficRetentionDays},recordings:{retentionDays:config.recordingStorage.retentionDays,accessEnabled:true},
},redaction:config.telemetryRedaction,redactTerms:config.telemetryRedactTerms });
let policy: Policy = JSON.parse(String(db.prepare('SELECT value FROM operations_policy WHERE id=1').get()?.value ?? JSON.stringify(defaults())));
function applyConfig() {
 config.telemetryRetentionDays=policy.categories.reports.retentionDays!;config.liveRetentionDays=policy.categories.live.retentionDays!;config.logRetentionDays=policy.categories.logs.retentionDays!;
 config.diagnosticsRetentionDays=policy.categories.diagnostics.retentionDays!;config.workerRollupRetentionDays=policy.categories.workers.retentionDays!;
 config.historyRetentionDays=policy.categories.history.retentionDays;config.trafficRetentionDays=policy.categories.traffic.retentionDays;
 config.recordingStorage.retentionDays=policy.categories.recordings.retentionDays!;config.telemetryRedaction=policy.redaction;config.telemetryRedactTerms=[...policy.redactTerms];
}
applyConfig();
export function getPolicy(): Policy { return structuredClone(policy); }
export function category(value: string): Category { if(!categoryNames.includes(value as Category))throw new OperationsError('Unknown data category');return value as Category; }
export function contentExpiry(kind: Category, anchor: number, room?: string, job?: string): number {
 if(room && job && db.prepare('SELECT 1 FROM operations_deleted_jobs WHERE category=? AND room_sid=? AND job_id=?').get(kind,room,job))return 0;
 return anchor+(policy.categories[kind].retentionDays??3650)*DAY;
}
function object(value: unknown): Record<string,any> { if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationsError('Expected an object');return value as Record<string,any>; }
export function updatePolicy(value: unknown): Policy {
 const patch=object(value), next=getPolicy();
 if(Object.keys(patch).some(k=>!['categories','redaction','redactTerms'].includes(k)))throw new OperationsError('Unknown policy field');
 if(patch.categories!==undefined)for(const [name,raw] of Object.entries(object(patch.categories))){
  const kind=category(name),entry=object(raw);
  if(Object.keys(entry).some(k=>k!=='retentionDays'&&(kind!=='recordings'||k!=='accessEnabled')))throw new OperationsError('Unknown category policy field');
  if(entry.retentionDays!==undefined){const d=entry.retentionDays;if(!(d===null&&['history','traffic'].includes(kind))&&(!Number.isInteger(d)||d<(kind==='workers'?14:1)||d>3650))throw new OperationsError('Invalid retention days');next.categories[kind].retentionDays=d;}
  if(entry.accessEnabled!==undefined){if(typeof entry.accessEnabled!=='boolean')throw new OperationsError('Invalid recording access');next.categories[kind].accessEnabled=entry.accessEnabled;}
 }
 if(patch.redaction!==undefined){if(!['off','standard','strict'].includes(patch.redaction))throw new OperationsError('Invalid redaction mode');next.redaction=patch.redaction;}
 if(patch.redactTerms!==undefined){if(!Array.isArray(patch.redactTerms)||patch.redactTerms.length>50||patch.redactTerms.some((t:unknown)=>typeof t!=='string'||!t.trim()||t.length>200||/[\x00-\x1f]/.test(t)))throw new OperationsError('Invalid redaction terms');next.redactTerms=patch.redactTerms;}
 const before=policy;db.exec('BEGIN IMMEDIATE');
 try {policy=next;applyConfig();db.prepare('INSERT INTO operations_policy VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(policy));maintainOperations();scrub();db.exec('COMMIT');}
 catch(error){db.exec('ROLLBACK');policy=before;applyConfig();throw error;}
 return getPolicy();
}
function scrub(){
 for(const store of operationsStores())store.scrub();
 for(const table of ['agent_session_reports','agent_live_records','diagnostic_records'])for(const row of db.prepare(`SELECT rowid,content FROM ${table} WHERE content IS NOT NULL`).iterate()){
  const mode=table==='diagnostic_records'&&policy.redaction==='off'?'standard':policy.redaction;
  const value=JSON.parse(row.content as string);
  const safe=redactContent(value,mode,policy.redactTerms);
  if(table==='diagnostic_records' && typeof value.reason==='string')safe.reason=redactContent({text:value.reason},mode,policy.redactTerms).text;
  const content=JSON.stringify(safe);db.prepare(`UPDATE ${table} SET content=? WHERE rowid=?`).run(content,row.rowid!);
 }
 for(const row of db.prepare('SELECT rowid,message,logger FROM agent_log_entries WHERE message IS NOT NULL').iterate()){
  const safe=redactContent(row,policy.redaction,policy.redactTerms);db.prepare('UPDATE agent_log_entries SET message=?,logger=? WHERE rowid=?').run(safe.message!,safe.logger!,row.rowid!);
 }
}
const changes=(sql:string,...args:(string|number)[])=>Number(db.prepare(sql).run(...args).changes);
export function maintainOperations(at=Date.now()) {
 for(const store of operationsStores())store.maintain(at);
 for(const [table,kind,anchor,where] of [
  ['agent_session_reports','reports','received_at','1'],['agent_live_jobs','live','first_received','1'],['agent_live_records','live','received_at',"kind!='log'"],['agent_live_records','logs','received_at',"kind='log'"],['agent_log_entries','logs','received_at','1'],['diagnostic_records','diagnostics','at','1'],
 ] as const) db.prepare(`UPDATE ${table} SET expires_at=MIN(expires_at,${anchor}+?) WHERE (${where}) AND expires_at>${anchor}+?`).run(policy.categories[kind].retentionDays!*DAY,policy.categories[kind].retentionDays!*DAY);
 db.prepare('UPDATE agent_session_reports SET content=NULL WHERE content IS NOT NULL AND expires_at<=?').run(at);
 db.prepare('UPDATE agent_live_records SET content=NULL,turn_id=NULL,trace_id=NULL,span_id=NULL WHERE content IS NOT NULL AND expires_at<=?').run(at);
 db.prepare('UPDATE agent_log_entries SET message=NULL,logger=NULL,turn_id=NULL,trace_id=NULL,span_id=NULL WHERE message IS NOT NULL AND expires_at<=?').run(at);
 db.prepare('UPDATE diagnostic_records SET content=NULL,room_sid=NULL,participant_sid=NULL,track_sid=NULL,call_id=NULL,sip_call_id=NULL,provider_call_id=NULL,instance_id=NULL WHERE content IS NOT NULL AND expires_at<=?').run(at);
 if(policy.categories.history.retentionDays!==null){const cutoff=at-policy.categories.history.retentionDays*DAY;
  for(const table of ['events','participants'])db.prepare(`DELETE FROM ${table} WHERE room_sid IN (SELECT room_sid FROM sessions WHERE ended_at IS NOT NULL AND ended_at<?)`).run(cutoff);
  db.prepare('DELETE FROM sessions WHERE ended_at IS NOT NULL AND ended_at<?').run(cutoff);
  db.prepare("DELETE FROM egress WHERE ended_at IS NOT NULL AND ended_at<? AND status IN ('3','4','5','6','EGRESS_COMPLETE','EGRESS_FAILED','EGRESS_ABORTED','EGRESS_LIMIT_REACHED')").run(cutoff);
 }
 if(policy.categories.traffic.retentionDays!==null)db.prepare('DELETE FROM repo_traffic WHERE day<?').run(at-policy.categories.traffic.retentionDays*DAY);
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='inventory_rollups'").get())db.prepare('DELETE FROM inventory_rollups WHERE hour<?').run(at-policy.categories.workers.retentionDays!*DAY);
 db.prepare('DELETE FROM agent_worker_samples WHERE at<?').run(at-14*DAY);
}
export function deleteCategory(name:string) {
 const kind=category(name);let rows=0;const tables:Record<string,number>={};
 const run=(table:string,sql:string,...args:(string|number)[])=>{const n=changes(sql,...args);tables[table]=(tables[table]??0)+n;rows+=n;};
 db.exec('BEGIN IMMEDIATE');try{
  if(['reports','live','logs'].includes(kind)){
   const source=kind==='reports'?'agent_session_reports':kind==='live'?'agent_live_jobs':'agent_log_entries';
   db.prepare(`INSERT OR IGNORE INTO operations_deleted_jobs SELECT ?,room_sid,job_id FROM ${source}`).run(kind);
   if(kind==='logs')db.prepare("INSERT OR IGNORE INTO operations_deleted_jobs SELECT 'logs',room_sid,job_id FROM agent_live_records WHERE kind='log'").run();
  }
  if(kind==='reports')run('agent_session_reports','UPDATE agent_session_reports SET content=NULL,expires_at=MIN(expires_at,?) WHERE content IS NOT NULL',Date.now());
  if(kind==='live'){run('agent_live_records',"UPDATE agent_live_records SET content=NULL,turn_id=NULL,trace_id=NULL,span_id=NULL,expires_at=MIN(expires_at,?) WHERE kind!='log' AND content IS NOT NULL",Date.now());run('agent_live_jobs','UPDATE agent_live_jobs SET expires_at=MIN(expires_at,?)',Date.now());}
  if(kind==='logs'){run('agent_log_entries','UPDATE agent_log_entries SET message=NULL,logger=NULL,turn_id=NULL,trace_id=NULL,span_id=NULL,expires_at=MIN(expires_at,?) WHERE message IS NOT NULL',Date.now());run('agent_live_records',"UPDATE agent_live_records SET content=NULL,turn_id=NULL,trace_id=NULL,span_id=NULL,expires_at=MIN(expires_at,?) WHERE kind='log' AND content IS NOT NULL",Date.now());}
  if(kind==='diagnostics')run('diagnostic_records','UPDATE diagnostic_records SET content=NULL,room_sid=NULL,participant_sid=NULL,track_sid=NULL,call_id=NULL,sip_call_id=NULL,provider_call_id=NULL,instance_id=NULL,expires_at=MIN(expires_at,?) WHERE content IS NOT NULL',Date.now());
  if(kind==='history')for(const table of ['events','participants','sessions','egress'])run(table,`DELETE FROM ${table}`);
  if(kind==='workers')for(const table of ['agent_worker_samples','inventory_rollups'])if(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table))run(table,`DELETE FROM ${table}`);
  if(kind==='traffic')run('repo_traffic','DELETE FROM repo_traffic');
  if(kind==='recordings'){policy.categories.recordings.accessEnabled=false;db.prepare('INSERT INTO operations_policy VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(policy));}
  for(const store of operationsStores())if(store.category===kind){const extra=store.delete();rows+=extra.rows;Object.assign(tables,extra.tables);}
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {category:kind,rows,tables,tombstonesRetained:true,upstreamDeleted:false,metadataMayBeRediscovered:['history','workers','traffic'].includes(kind)};
}
const coverage:Record<Category,string[]>={reports:['agent_session_reports'],live:['agent_live_jobs','agent_live_records'],logs:['agent_log_entries','agent_live_records'],diagnostics:['diagnostic_records'],history:['sessions','participants','events','egress'],workers:['agent_worker_samples','inventory_rollups'],traffic:['repo_traffic'],recordings:[]};
const where=(kind:Category,table:string)=>table==='agent_live_records'?(kind==='logs'?" WHERE kind='log'":" WHERE kind!='log'"):'';
export function exportCategory(name:string,content=false,maxBytes=bounds.exportBytes){
 const kind=category(name);maintainOperations();if(content&&!['reports','live','logs','diagnostics'].includes(kind))throw new OperationsError('Content export is unavailable for this category');
 const tables:Record<string,unknown[]>={};let count=0,bytes=0;
 for(const table of coverage[kind]){
  if(!db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table))continue;
  const columns=(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name);
  // Metadata exports are a small numeric/digest projection, never raw webhook/upstream/config payloads.
  const safe=columns.filter(c=>['digest','kind','type','status','level','at','ts','received_at','reported_at','expires_at','started_at','ended_at','day','hour','count','uniques','samples','up','load_sum','load_count','ok','latency_ms','active_jobs','load','first_received','last_received'].includes(c));
  const selected=content?columns.filter(c=>!['payload','info','attributes'].includes(c)):safe;
  if(!selected.length)selected.push('rowid');
  const clause=where(kind,table),totals=db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(${selected.map(c=>`COALESCE(length(CAST(${c} AS BLOB)),0)+32`).join('+')}),0) bytes FROM ${table}${clause}`).get()!;
  count+=Number(totals.n);bytes+=Number(totals.bytes);if(count>bounds.exportRows||bytes>maxBytes)throw new OperationsError('Export exceeds record or byte budget',413);
  tables[table]=db.prepare(`SELECT ${selected.join(',')} FROM ${table}${clause} LIMIT ?`).all(bounds.exportRows).map(row=>{
   for(const key of ['content'])if(typeof row[key]==='string')row[key]=redactContent(JSON.parse(row[key] as string),kind==='diagnostics'&&policy.redaction==='off'?'standard':policy.redaction,policy.redactTerms) as any;
   return redactContent(row,policy.redaction,policy.redactTerms);
  });
 }
 for(const store of operationsStores())if(store.category===kind){const extra=store.export(content,{maxRows:bounds.exportRows-count,maxBytes:Math.max(0,maxBytes-Buffer.byteLength(JSON.stringify(tables)))});count+=extra.rows;Object.assign(tables,extra.tables);}
 const result={category:kind,content,exportedAt:Date.now(),rows:count,tables,truncated:false};if(count>bounds.exportRows||Buffer.byteLength(JSON.stringify(result))>maxBytes)throw new OperationsError('Export exceeds byte budget',413);return result;
}
export function storageMeasurements(){
 const pageSize=Number(db.prepare('PRAGMA page_size').get()!.page_size),pageCount=Number(db.prepare('PRAGMA page_count').get()!.page_count),freePages=Number(db.prepare('PRAGMA freelist_count').get()!.freelist_count);
 const file=String(db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file??'');
 const size=(p:string)=>{try{return statSync(p).size;}catch{return 0;}};
 const categories={} as Record<Category,{rows:number;tables:Record<string,number>;retentionDays:number|null}>;
 for(const kind of categoryNames){const tables:Record<string,number>={};for(const table of coverage[kind])if(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table))tables[table]=Number(db.prepare(`SELECT COUNT(*) n FROM ${table}${where(kind,table)}`).get()!.n);categories[kind]={rows:Object.values(tables).reduce((a,b)=>a+b,0),tables,retentionDays:policy.categories[kind].retentionDays};}
 for(const store of operationsStores()){const extra=store.storage();categories[store.category].rows+=extra.rows;Object.assign(categories[store.category].tables,extra.tables);}
 return {pageSize,pageCount,freePages,allocatedBytes:pageSize*pageCount,databaseBytes:size(file),walBytes:size(file+'-wal'),categories};
}
export function initializePolicy(){maintainOperations();scrub();}
