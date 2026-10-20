import {after,test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import express from 'express';import cookieParser from 'cookie-parser';
const dir=mkdtempSync(path.join(tmpdir(),'lkc-diagnostics-'));Object.assign(process.env,{DB_PATH:path.join(dir,'test.db'),LIVEKIT_URL:'ws://127.0.0.1:1',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',ADMIN_USER:'admin',ADMIN_PASSWORD:'test-password',SESSION_SECRET:'test-session-secret',AGENT_TELEMETRY_TOKEN:'test-service-token-with-at-least-32-characters',DIAGNOSTICS_ENABLED:'true'});
const {diagnosticIngest,diagnosticReads,purgeDiagnostics}=await import('../src/diagnostics.js');const {db}=await import('../src/db.js');const {login,hashPassword}=await import('../src/auth.js');const app=express();app.use('/api/telemetry/diagnostics',diagnosticIngest);app.use(express.json(),cookieParser());app.post('/login',login);app.use('/api/diagnostics',diagnosticReads);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,?,?)').run('reader',hashPassword('test-password'),'viewer',Date.now());
async function cookie(username='admin'){const r=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'test-password'})});return r.headers.get('set-cookie')!.split(';')[0];}
const at=Date.now(),q={id:'q-one',kind:'quality',at,roomSid:'RM_one',participantSid:'PA_one',trackSid:'TR_one',reporterId:'sdk-one',direction:'inbound',metrics:{packetLossPct:20,jitterMs:80}};
const upload=(records:any[],token=process.env.AGENT_TELEMETRY_TOKEN)=>fetch(base+'/api/telemetry/diagnostics',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({schemaVersion:1,records})});
test('diagnostic ingestion authenticates, retries idempotently and rejects conflicts atomically',async()=>{
 assert.equal((await upload([q],'bad')).status,401);assert.equal((await upload([q])).status,200);assert.equal((await upload([q])).status,200);
 assert.equal((await upload([{...q,id:'q-not-committed'},{...q,metrics:{packetLossPct:1}}])).status,409);assert.equal(db.prepare('SELECT COUNT(*) n FROM diagnostic_records').get()!.n,1);
 assert.equal((await upload([{...q,id:'bad',metrics:{rttMs:-1}}])).status,400);
});
test('admin reads isolate participant/track samples and keep unavailable metrics absent',async()=>{
 await upload([{...q,id:'q-two',participantSid:'PA_two',trackSid:'TR_two'}]);const url='/api/diagnostics/quality?roomSid=RM_one&participantSid=PA_one&trackSid=TR_one';
 assert.equal((await fetch(base+url)).status,401);assert.equal((await fetch(base+url,{headers:{cookie:await cookie('reader')}})).status,403);
 const data=await(await fetch(base+url,{headers:{cookie:await cookie()}})).json();assert.equal(data.rows.length,1);assert.equal(data.rows[0].metrics.rttMs,undefined);assert.equal(data.rows[0].trackSid,'TR_one');
 assert.equal((await fetch(base+'/api/diagnostics/quality',{headers:{cookie:await cookie()}})).status,400);
});
test('pre-room SIP failures survive without a session and correlate only durable call IDs',async()=>{
 await upload([{id:'sip-one',at,kind:'sip',service:'sip',instanceId:'sip-one',callId:'SC_test',sipCallId:'provider-call',direction:'inbound',stage:'dispatch',code:404,reason:'No matching rule',message:'password=hidden Bearer hide-this'}]);
 const auth={cookie:await cookie()};const data=await(await fetch(base+'/api/diagnostics/sip?callId=SC_test',{headers:auth})).json();assert.equal(data.rows.length,1);assert.equal(data.rows[0].code,404);assert.equal(data.rows[0].roomSid,undefined);assert.equal(JSON.stringify(data).includes('hide-this'),false);
 db.prepare('INSERT INTO participants(room_sid,sid,identity,kind,joined_at,attributes) VALUES (?,?,?,?,?,?)').run('RM_call','PA_call','caller','3',at,JSON.stringify({'sip.callID':'SC_test'}));
 const linked=await(await fetch(base+'/api/diagnostics/sip?roomSid=RM_call&participantSid=PA_call',{headers:auth})).json();assert.equal(linked.rows.length,1);assert.equal(linked.rows[0].linkedParticipantSid,'PA_call');assert.equal(linked.rows[0].linkedRoomSid,'RM_call');
 const absent=await(await fetch(base+'/api/diagnostics/sip?roomSid=RM_other',{headers:auth})).json();assert.equal(absent.rows.length,0);
});
test('expired diagnostics do not reappear or renew on replay, and filters are bounded',async()=>{
 const old={...q,id:'expired',at:1};await upload([old]);purgeDiagnostics();await upload([old]);assert.equal(db.prepare("SELECT content FROM diagnostic_records WHERE id='expired'").get()!.content,null);
 const auth={cookie:await cookie()};for(const query of ['?from=bad','?from=1&to=9999999999999','?limit=999999','?offset=-1'])assert.equal((await fetch(base+'/api/diagnostics/sip'+query,{headers:auth})).status,400);
});

test('call direction from service is distinguished from attribute inference',async()=>{
 const {history}=await import('../src/history.js');app.use('/api/history',history);
 db.prepare('INSERT INTO sessions(room_sid,room_name,started_at) VALUES (?,?,?)').run('RM_call','call-test',at);
 // A trunk alone formerly inferred outbound. Service evidence explicitly confirms inbound.
 const auth={cookie:await cookie()};const data=await(await fetch(base+'/api/history/calls/PA_call',{headers:auth})).json();
 assert.equal(data.call.direction,'inbound');assert.equal(data.call.directionSource,'sip_service');
});

test('diagnostic API itself excludes SIP headers and raw network addresses from free text',async()=>{
 await upload([{id:'unsafe-text',at,kind:'sip',service:'sip',instanceId:'sip-one',callId:'SC_unsafe',message:'INVITE sip:100@10.1.2.3 SIP/2.0; Via: 10.1.2.3',reason:'network 2001:db8::1 failed'}]);
 const data=await(await fetch(base+'/api/diagnostics/sip?callId=SC_unsafe',{headers:{cookie:await cookie()}})).json();const text=JSON.stringify(data);assert.equal(text.includes('10.1.2.3'),false);assert.equal(text.includes('2001:db8::1'),false);assert.equal(text.includes('INVITE'),false);
});
test('ambiguous or conflicting explicit SIP scopes never fall back to a different room',async()=>{
 db.prepare('INSERT INTO participants(room_sid,sid,identity,kind,joined_at,attributes) VALUES (?,?,?,?,?,?)').run('RM_ambiguous','PA_ambiguous','caller','3',at,JSON.stringify({'sip.callID':'SC_test'}));
 const auth={cookie:await cookie()};
 for(const room of ['RM_call','RM_ambiguous']){const d=await(await fetch(base+'/api/diagnostics/sip?roomSid='+room,{headers:auth})).json();assert.equal(d.rows.some((r:any)=>r.id==='sip-one'),false);}
 await upload([{id:'explicit-conflict',at,kind:'sip',service:'sip',instanceId:'sip-one',callId:'SC_explicit',roomSid:'RM_native',participantSid:'PA_native'}]);
 db.prepare('INSERT INTO participants(room_sid,sid,identity,kind,joined_at,attributes) VALUES (?,?,?,?,?,?)').run('RM_other','PA_wrong','caller','3',at,JSON.stringify({'sip.callID':'SC_explicit'}));
 const data=await(await fetch(base+'/api/diagnostics/sip?roomSid=RM_other',{headers:auth})).json();assert.equal(data.rows.some((r:any)=>r.id==='explicit-conflict'),false);
});
test('expired diagnostic tombstones contain no call or participant correlation metadata',()=>{
 const row=db.prepare("SELECT room_sid,participant_sid,track_sid,call_id,sip_call_id,provider_call_id,instance_id FROM diagnostic_records WHERE id='expired'").get()!;assert.ok(Object.values(row).every(v=>v===null));
});

test('all durable SIP aliases have indexed point lookups',async()=>{
 const {SIP_DIRECTION_SQL}=await import('../src/history.js');
 const plan=db.prepare('EXPLAIN QUERY PLAN '+SIP_DIRECTION_SQL).all({$id:'one',$full:'two',$expires:Date.now(),$room:'RM_call',$participant:'PA_call'}).map(r=>String(r.detail)).join('\n');
 for(const index of ['diagnostic_call','diagnostic_sip_call','diagnostic_provider_call'])assert.ok(plan.includes(index));
 assert.equal(/SCAN diagnostic_records/.test(plan),false);
});
test('call history does not confirm ambiguous pre-room service directions',async()=>{
 const data=await(await fetch(base+'/api/history/calls/PA_call',{headers:{cookie:await cookie()}})).json();assert.equal(data.call.directionSource,'unknown');
});
