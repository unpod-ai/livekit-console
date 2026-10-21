import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'lkc-ops-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'test.db'),LIVEKIT_URL:'ws://127.0.0.1:1',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',ADMIN_USER:'admin',ADMIN_PASSWORD:'test-password',SESSION_SECRET:'test-secret',AGENT_TELEMETRY_TOKEN:'test-service-token-with-at-least-32-characters',AGENT_LOGS_ENABLED:'true',AGENT_TELEMETRY_EVENTS_ENABLED:'true'});
const {operations}=await import('../src/operations.js');
const {getPolicy,updatePolicy,maintainOperations,deleteCategory,exportCategory,storageMeasurements}=await import('../src/operations-policy.js');
const {recordCollector,collectorStates,saveRule,evaluateAlerts,alertRows,transitionAlert}=await import('../src/operations-observability.js');
const {db}=await import('../src/db.js');const {login,hashPassword}=await import('../src/auth.js');
const {liveIngest}=await import('../src/live-telemetry.js');
const app=express();app.use('/events',liveIngest);app.use(express.json(),cookieParser());app.post('/login',login);app.use('/operations',operations);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
async function cookie(username='admin'){const r=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'test-password'})});return r.headers.get('set-cookie')!.split(';')[0];}
const now=Date.now(),day=86400000;
function seed(){
 db.prepare('INSERT OR REPLACE INTO agent_session_reports VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('RM_ops','AJ_ops','agent',null,null,null,now-5*day,now-5*day,now+25*day,'report-digest',JSON.stringify({items:[{text:'private phrase'}]}));
 db.prepare('INSERT OR REPLACE INTO agent_live_jobs(room_sid,job_id,agent_name,sdk_language,mode,capabilities,first_received,last_received,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run('RM_ops','AJ_ops','agent','python','voice','[]',now-5*day,now-5*day,now+25*day);
 for(const [id,kind] of [['log1','log'],['msg1','message']])db.prepare('INSERT OR REPLACE INTO agent_live_records(room_sid,job_id,id,kind,at,content,digest,received_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run('RM_ops','AJ_ops',id,kind,now-5*day,JSON.stringify({text:'private phrase'}),'digest-'+id,now-5*day,now+25*day);
 db.prepare('INSERT OR REPLACE INTO agent_log_entries(room_sid,job_id,entry_id,agent_name,at,level,message,received_at,expires_at,digest) VALUES(?,?,?,?,?,?,?,?,?,?)').run('RM_ops','AJ_ops','log1','agent',now-5*day,'INFO','private phrase',now-5*day,now+25*day,'log-digest');
}
test('operations authenticate and deny viewers',async()=>{
 assert.equal((await fetch(base+'/operations/summary')).status,401);
 db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)').run('viewer',hashPassword('test-password'),'viewer',now);
 assert.equal((await fetch(base+'/operations/policy',{headers:{cookie:await cookie('viewer')}})).status,403);
 assert.equal((await fetch(base+'/operations/summary',{headers:{cookie:await cookie()}})).status,200);
});
test('policy persists validates and retroactively redacts',()=>{
 seed();updatePolicy({redaction:'standard',redactTerms:['private phrase']});assert.ok(String(db.prepare("SELECT content FROM agent_session_reports WHERE job_id='AJ_ops'").get()!.content).includes('[REDACTED]'));assert.deepEqual(getPolicy().redactTerms,['private phrase']);
 assert.throws(()=>updatePolicy({categories:{audit:{retentionDays:1}}}));assert.throws(()=>updatePolicy({categories:{logs:{retentionDays:0}}}));assert.throws(()=>updatePolicy({redactTerms:['x'.repeat(201)]}));
});
test('log retention covers duplicates and live retention shortens jobs without resurrection',()=>{
 seed();updatePolicy({categories:{logs:{retentionDays:1}}});assert.equal(db.prepare("SELECT message FROM agent_log_entries WHERE entry_id='log1'").get()!.message,null);assert.equal(db.prepare("SELECT content FROM agent_live_records WHERE id='log1'").get()!.content,null);assert.notEqual(db.prepare("SELECT content FROM agent_live_records WHERE id='msg1'").get()!.content,null);
 updatePolicy({categories:{live:{retentionDays:1},reports:{retentionDays:1}}});assert.ok(Number(db.prepare("SELECT expires_at FROM agent_live_jobs WHERE job_id='AJ_ops'").get()!.expires_at)<now);
 updatePolicy({categories:{live:{retentionDays:30},logs:{retentionDays:30},reports:{retentionDays:30}}});maintainOperations();assert.equal(db.prepare("SELECT content FROM agent_session_reports WHERE job_id='AJ_ops'").get()!.content,null);
});
test('category deletion preserves tombstones and prevents later batches reviving live jobs',async()=>{
 seed();db.prepare("UPDATE agent_live_jobs SET sdk_version='1' WHERE job_id='AJ_ops'").run();assert.ok(deleteCategory('live').rows>0);assert.equal(db.prepare("SELECT digest FROM agent_live_records WHERE id='msg1'").get()!.digest,'digest-msg1');assert.notEqual(db.prepare("SELECT message FROM agent_log_entries WHERE entry_id='log1'").get()!.message,null);
 const body={schemaVersion:1,roomSid:'RM_ops',jobId:'AJ_ops',agentName:'agent',batchId:'later',sdk:{language:'python',version:'1'},mode:'pipeline',capabilities:[],entries:[{id:'later',kind:'message',at:Date.now()/1000,role:'user',text:'must not restore'}]};
 const r=await fetch(base+'/events',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.AGENT_TELEMETRY_TOKEN}`},body:JSON.stringify(body)});assert.equal(r.status,201,await r.text());assert.equal(db.prepare("SELECT content FROM agent_live_records WHERE id='later'").get()!.content,null);
 deleteCategory('logs');assert.equal(db.prepare("SELECT content FROM agent_live_records WHERE id='log1'").get()!.content,null);assert.throws(()=>deleteCategory('audit'));assert.throws(()=>deleteCategory('users'));
});
test('deletion needs exact confirmation; exports exclude upstream credentials and enforce budgets',async()=>{
 const headers={cookie:await cookie(),'content-type':'application/json'};assert.equal((await fetch(base+'/operations/data/reports',{method:'DELETE',headers,body:JSON.stringify({confirm:'logs'})})).status,422);
 db.prepare('INSERT INTO egress(egress_id,started_at,info) VALUES(?,?,?)').run('EG_secret',now,JSON.stringify({accessKey:'never-export',fileResults:[{location:'https://secret'}]}));
 const output=JSON.stringify(exportCategory('history',false));assert.ok(!output.includes('never-export'));assert.ok(!output.includes('https://secret'));assert.throws(()=>exportCategory('history',true));
 seed();assert.ok(!JSON.stringify(exportCategory('reports',false)).includes('private phrase'));db.prepare("UPDATE agent_session_reports SET content=? WHERE job_id='AJ_ops'").run(JSON.stringify({text:'x'.repeat(2*1024*1024)}));assert.throws(()=>exportCategory('reports',true,1024));db.prepare("UPDATE agent_session_reports SET content=NULL WHERE job_id='AJ_ops'").run();
});
test('collector counters sanitize errors and recover without inventing disabled health',()=>{
 recordCollector('reports',{ok:false,error:'authentication'});recordCollector('reports',{ok:true,sourceAt:now-1000,receipt:true});const c=collectorStates().find(c=>c.source==='reports')!;assert.equal(c.failures,1);assert.equal(c.receipts,1);assert.equal(c.error,null);assert.ok(c.lagMs!>=1000);assert.equal(collectorStates().find(c=>c.source==='diagnostics')!.state,'disabled');assert.throws(()=>recordCollector('reports',{ok:false,error:'Bearer secret'} as any));
});
test('explicit alert rules deduplicate ack resolve and ignore missing measurements',()=>{
 const rule=saveRule({kind:'ingestion_failures',source:'reports',threshold:1,windowSeconds:3600,enabled:true});recordCollector('reports',{ok:false,error:'validation'});evaluateAlerts();evaluateAlerts();const rows=alertRows().filter(a=>a.ruleId===rule.id);assert.equal(rows.length,1);assert.equal(rows[0].state,'open');transitionAlert(rows[0].id,'acknowledged');evaluateAlerts();assert.equal(alertRows().find(a=>a.id===rows[0].id)!.state,'acknowledged');transitionAlert(rows[0].id,'resolved');evaluateAlerts();assert.equal(alertRows().filter(a=>a.ruleId===rule.id).length,1);
 const missing=saveRule({kind:'quality_rtt_ms',source:'diagnostics',threshold:1,windowSeconds:60,enabled:true});evaluateAlerts();assert.equal(alertRows().filter(a=>a.ruleId===missing.id).length,0);assert.throws(()=>saveRule({kind:'quality_rtt_ms',source:'diagnostics',threshold:0,windowSeconds:0,enabled:true}));
});
test('storage measures SQLite sizes and category rows',()=>{const s=storageMeasurements();assert.ok(s.pageSize>0);assert.ok(s.pageCount>0);assert.ok(s.databaseBytes>0);assert.ok(s.walBytes>=0);assert.ok(s.categories.reports.rows>0);});

test('recording storage requires explicit credentials or opt-in and applies policy immediately',async()=>{
 const {recordingRouter}=await import('../src/recordings.js');const {config}=await import('../src/config.js');
 config.recordingStorage.bucket='test-bucket';config.recordingStorage.prefix='calls/';
 const app2=express();app2.use(cookieParser());app2.use('/recordings',recordingRouter());
 const server2=app2.listen(0,'127.0.0.1');await new Promise<void>(r=>server2.once('listening',r));const base2=`http://127.0.0.1:${(server2.address() as any).port}`;
 try{
  db.prepare('INSERT INTO egress(egress_id,room_sid,started_at,ended_at,info) VALUES(?,?,?,?,?)').run('EG_creds','RM_creds',now-3*day,now-3*day,JSON.stringify({roomComposite:{fileOutputs:[{s3:{bucket:'test-bucket'}}]},fileResults:[{filename:'calls/test.ogg'}]}));
  const headers={cookie:await cookie()};assert.equal((await fetch(base2+'/recordings/EG_creds/0/stream',{headers})).status,503);
  updatePolicy({categories:{recordings:{retentionDays:1}}});const inventory=await(await fetch(base2+'/recordings/sessions/RM_creds',{headers})).json();assert.equal(inventory.files[0].state,'expired');
  deleteCategory('recordings');assert.equal((await fetch(base2+'/recordings/sessions/RM_creds',{headers})).status,403);assert.ok(db.prepare("SELECT 1 FROM egress WHERE egress_id='EG_creds'").get());
 }finally{await new Promise<void>(r=>server2.close(()=>r()));}
});

test('privacy upgrades redact retained diagnostic reasons as well as messages',()=>{
 db.prepare('INSERT INTO diagnostic_records(id,kind,at,received_at,expires_at,digest,content) VALUES(?,?,?,?,?,?,?)').run('privacy','sip',now,now,now+day,'original',JSON.stringify({reason:'private phrase',message:'private phrase'}));
 updatePolicy({redaction:'strict'});const content=JSON.parse(String(db.prepare("SELECT content FROM diagnostic_records WHERE id='privacy'").get()!.content));assert.equal(content.reason,'[CONTENT REDACTED]');assert.equal(content.message,'[CONTENT REDACTED]');assert.equal(db.prepare("SELECT digest FROM diagnostic_records WHERE id='privacy'").get()!.digest,'original');
 updatePolicy({redaction:'standard'});
});
test('resolving an alert acknowledges the latest repeated observation without immediate duplicate',()=>{
 const rule=saveRule({kind:'ingestion_failures',source:'logs',threshold:1,windowSeconds:3600,enabled:true});recordCollector('logs',{ok:false,error:'validation'},now);evaluateAlerts(now);const row=alertRows().find(a=>a.ruleId===rule.id)!;transitionAlert(String(row.id),'acknowledged');recordCollector('logs',{ok:false,error:'validation'},now+60000);evaluateAlerts(now+60000);transitionAlert(String(row.id),'resolved');evaluateAlerts(now+60000);assert.equal(alertRows().filter(a=>a.ruleId===rule.id).length,1);
});
test('consistent SQLite backup restores policy alerts and tombstones with integrity',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const target=path.join(dir,'backup.db');db.prepare('VACUUM INTO ?').run(target);const restored=new DatabaseSync(target);
 try{assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');for(const table of ['operations_policy','operations_collectors','operations_rules','operations_alerts','operations_deleted_jobs'])assert.equal(restored.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);assert.equal(restored.prepare('SELECT value FROM operations_policy').get()!.value,db.prepare('SELECT value FROM operations_policy').get()!.value);}finally{restored.close();}
});

test('child exports require category grants and recording grants permit viewers independently of admin',async()=>{
 const jwt=(await import('jsonwebtoken')).default;const {recordingRouter}=await import('../src/recordings.js');
 updatePolicy({categories:{recordings:{accessEnabled:true}}});
 const app2=express();app2.use('/recordings',recordingRouter({bucket:'test',prefix:'',retentionDays:30},{send:async()=>({})} as any));
 const server2=app2.listen(0,'127.0.0.1');await new Promise<void>(r=>server2.once('listening',r));const base2=`http://127.0.0.1:${(server2.address() as any).port}`;
 Object.assign(process.env,{CONSOLE_PROJECT_CHILD:'1',CONSOLE_PROJECT_ID:'test',CONSOLE_GATEWAY_SECRET:'private-gateway-key'});
 const headers=(role:string,caps:Partial<Record<'recordings'|'transcripts'|'logs',boolean>>)=>({'x-console-gateway':jwt.sign({sub:'test',role,capabilities:{transcripts:false,recordings:false,logs:false,...caps}},process.env.CONSOLE_GATEWAY_SECRET!,{algorithm:'HS256',audience:'console-project:test',expiresIn:30})});
 try{
  assert.equal((await fetch(base2+'/recordings/sessions/RM_creds',{headers:headers('viewer',{recordings:true})})).status,200);
  assert.equal((await fetch(base2+'/recordings/sessions/RM_creds',{headers:headers('admin',{})})).status,403);
  assert.equal((await fetch(base+'/operations/export/reports',{headers:headers('admin',{})})).status,403);
  assert.equal((await fetch(base+'/operations/export/live',{headers:headers('admin',{transcripts:true})})).status,403);
  assert.equal((await fetch(base+'/operations/export/logs',{headers:headers('admin',{logs:true})})).status,200);
  assert.equal((await fetch(base+'/operations/policy',{headers:headers('viewer',{logs:true,transcripts:true})})).status,403);
 }finally{delete process.env.CONSOLE_PROJECT_CHILD;delete process.env.CONSOLE_PROJECT_ID;delete process.env.CONSOLE_GATEWAY_SECRET;await new Promise<void>(r=>server2.close(()=>r()));}
});

test('history retention preserves active sessions participants events and ongoing egress',()=>{
 const old=now-2*day;
 for(const [sid,end] of [['RM_active',null],['RM_ended',old]] as const){
  db.prepare('INSERT INTO sessions(room_sid,room_name,started_at,ended_at) VALUES(?,?,?,?)').run(sid,sid,old,end);
  db.prepare('INSERT INTO participants(room_sid,sid,identity,joined_at) VALUES(?,?,?,?)').run(sid,'PA_history','identity',old);
  db.prepare('INSERT INTO events(id,ts,type,room_sid,payload) VALUES(?,?,?,?,?)').run(sid,old,'room_started',sid,'{}');
 }
 for(const [id,status,end] of [['EG_active','1',null],['EG_finished','3',old],['EG_inconsistent','1',old]] as const)db.prepare('INSERT INTO egress(egress_id,status,started_at,ended_at,info) VALUES(?,?,?,?,?)').run(id,status,old,end,'{}');
 updatePolicy({categories:{history:{retentionDays:1}}});
 for(const table of ['sessions','participants','events']){assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE room_sid='RM_active'`).get()!.n,1);assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE room_sid='RM_ended'`).get()!.n,0);}
 assert.ok(db.prepare("SELECT 1 FROM egress WHERE egress_id='EG_active'").get());assert.ok(db.prepare("SELECT 1 FROM egress WHERE egress_id='EG_inconsistent'").get());assert.equal(db.prepare("SELECT 1 FROM egress WHERE egress_id='EG_finished'").get(),undefined);
});

test('alerts use canonical measured latency, preserve measured zero and ignore disabled sources',async()=>{
 const {config}=await import('../src/config.js');
 db.prepare('INSERT INTO agent_session_reports VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('RM_measured','AJ_measured','agent',null,null,null,now,now,now+day,'measured',JSON.stringify({items:[{id:'a',role:'assistant',at:now,metrics:{e2e_latency:0.2}}]}));
 const latency=saveRule({kind:'latency_ms',source:'reports',threshold:100,windowSeconds:60,enabled:true});evaluateAlerts(now);assert.equal(alertRows().find(a=>a.ruleId===latency.id)!.value,200);
 const stale=saveRule({kind:'source_stale',source:'egress',threshold:30,windowSeconds:60,enabled:true});recordCollector('egress',{ok:true},now-60000);evaluateAlerts(now);assert.equal(alertRows().find(a=>a.ruleId===stale.id)!.value,60);
 const quality=saveRule({kind:'quality_rtt_ms',source:'diagnostics',threshold:10,windowSeconds:60,enabled:true});
 config.diagnosticsEnabled=true;
 try{
  db.prepare('INSERT INTO diagnostic_records(id,kind,at,received_at,expires_at,digest,content) VALUES(?,?,?,?,?,?,?)').run('quality-zero','quality',now,now,now+day,'zero',JSON.stringify({metrics:{rttMs:0}}));evaluateAlerts(now);assert.equal(alertRows().some(a=>a.ruleId===quality.id),false);
  db.prepare('INSERT INTO diagnostic_records(id,kind,at,received_at,expires_at,digest,content) VALUES(?,?,?,?,?,?,?)').run('quality-measured','quality',now,now,now+day,'twenty',JSON.stringify({metrics:{rttMs:20}}));evaluateAlerts(now);assert.equal(alertRows().find(a=>a.ruleId===quality.id)!.value,20);
 }finally{config.diagnosticsEnabled=false;}
 const disabled=saveRule({kind:'source_stale',source:'traffic',threshold:1,windowSeconds:60,enabled:true});recordCollector('traffic',{ok:true},now-60000);evaluateAlerts(now);assert.equal(alertRows().some(a=>a.ruleId===disabled.id),false);
});
test('nested ingestion routers attribute receipts before mounted paths are stripped',async()=>{
 const {observeIngestion}=await import('../src/operations-observability.js');const app2=express();app2.use('/api/telemetry',observeIngestion('telemetry'));
 for(const kind of ['logs','diagnostics']){const router=express.Router();router.post('/',(_,r)=>r.status(201).json({ok:true}));app2.use('/api/telemetry/'+kind,router);}
 const s=app2.listen(0,'127.0.0.1');await new Promise<void>(r=>s.once('listening',r));const url=`http://127.0.0.1:${(s.address() as any).port}`;
 const before=new Map(collectorStates().map(c=>[c.source,c.receipts]));
 try{for(const kind of ['logs','diagnostics'])assert.equal((await fetch(url+'/api/telemetry/'+kind,{method:'POST'})).status,201);for(const kind of ['logs','diagnostics'])assert.equal(collectorStates().find(c=>c.source===kind)!.receipts,before.get(kind)!+1);assert.equal(collectorStates().find(c=>c.source==='live')!.receipts,before.get('live'));}
 finally{await new Promise<void>(r=>s.close(()=>r()));}
});
test('failed-call alerts exclude challenges and count distinct identified final failures',async()=>{
 const {config}=await import('../src/config.js');config.diagnosticsEnabled=true;
 const rule=saveRule({kind:'failed_calls',source:'diagnostics',threshold:2,windowSeconds:60,enabled:true});const at=Date.now();
 const insert=(id:string,call:string|null,code:number,stage?:string)=>db.prepare('INSERT INTO diagnostic_records(id,kind,at,received_at,expires_at,call_id,digest,content) VALUES(?,?,?,?,?,?,?,?)').run(id,'sip',at,at,at+day,call,id,JSON.stringify({code,stage,callId:call}));
 insert('challenge401','SC_one',401);insert('challenge407','SC_one',407);evaluateAlerts(at);assert.equal(alertRows().filter(a=>a.ruleId===rule.id).length,0);
 insert('first-failure','SC_one',486,'rejected');insert('repeat-failure','SC_one',486,'failed');insert('unknown-outcome','SC_two',500);insert('missing-identity',null,500,'failed');evaluateAlerts(at);assert.equal(alertRows().filter(a=>a.ruleId===rule.id).length,0);
 insert('second-failure','SC_two',500,'failed');evaluateAlerts(at);assert.equal(alertRows().find(a=>a.ruleId===rule.id)!.value,2);
});
test('worker-down thresholds count failed observations in the selected window',async()=>{
 const {config}=await import('../src/config.js');const {workerSource}=await import('../src/operations-observability.js');const url='http://threshold-worker';config.workerUrls=[url];const source=workerSource(url),at=Date.now();
 const rule=saveRule({kind:'worker_down',source,threshold:2,windowSeconds:60,enabled:true});recordCollector(source,{ok:false,error:'upstream'},at-1000);evaluateAlerts(at-1000);assert.equal(alertRows().filter(a=>a.ruleId===rule.id).length,0);
 recordCollector(source,{ok:false,error:'upstream'},at);evaluateAlerts(at);assert.equal(alertRows().find(a=>a.ruleId===rule.id)!.value,2);
});
