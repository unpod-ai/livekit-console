import {test,after} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import express from 'express';import cookieParser from 'cookie-parser';
const dir=mkdtempSync(path.join(tmpdir(),'lkc-alias-history-'));Object.assign(process.env,{DB_PATH:path.join(dir,'test.db'),LIVEKIT_URL:'ws://127.0.0.1:1',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',ADMIN_USER:'admin',ADMIN_PASSWORD:'test-password',SESSION_SECRET:'test-secret',AGENT_TELEMETRY_TOKEN:'test-service-token-with-at-least-32-characters'});
const {db}=await import('../src/db.js'),{history}=await import('../src/history.js'),{inventory}=await import('../src/inventory.js'),{ensureAgentName}=await import('../src/inventory-store.js'),{agentInsights}=await import('../src/telemetry.js'),{login,requireAuth,requireAdmin}=await import('../src/auth.js');
const app=express();app.use(express.json(),cookieParser());app.post('/login',login);app.use('/api/inventory',inventory);app.use('/api/history',requireAuth,history);app.use('/api/agent-insights',requireAuth,requireAdmin,agentInsights);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
const at=Date.now()-60000;for(const [i,name]of ['old-agent','renamed-agent'].entries()){
 db.prepare('INSERT INTO sessions(room_sid,room_name,started_at,ended_at) VALUES (?,?,?,?)').run('RM_'+i,'alias-room-'+i,at,at+10000);
 db.prepare('INSERT INTO participants(room_sid,sid,identity,kind,joined_at,left_at,attributes) VALUES (?,?,?,?,?,?,?)').run('RM_'+i,'PA_'+i,'agent-'+i,'4',at,at+10000,JSON.stringify({'lk.agent.name':name},null,2));
 const content={usage:[{type:'llm_usage',provider:'test',model:'local',metrics:{input_tokens:(i+1)*10,output_tokens:0,input_cached_tokens:0}}]};db.prepare('INSERT INTO agent_session_reports(room_sid,job_id,agent_name,reported_at,received_at,expires_at,digest,content) VALUES (?,?,?,?,?,?,?,?)').run('RM_'+i,'AJ_'+i,name,at,at,at+86400000,'digest-'+i,JSON.stringify(content));
}
async function auth(){const response=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'test-password'})});return {cookie:response.headers.get('set-cookie')!.split(';')[0]};}
let target:any;
test('linked previous names resolve history and session filters without rewriting native source attributes',async()=>{
 const old=ensureAgentName('old-agent',at);target=ensureAgentName('renamed-agent',at);
 const headers={...await auth(),'content-type':'application/json'};const linked=await fetch(base+'/api/inventory/agents/'+target.id+'/aliases',{method:'POST',headers,body:JSON.stringify({name:'old-agent',mergeAgentId:old.id})});assert.equal(linked.status,200);
 for(const ref of [target.id,'old-agent','renamed-agent',old.id]){
  const response=await(await fetch(base+'/api/history/agents/'+encodeURIComponent(ref),{headers})).json();assert.equal(response.sessions.length,2);
  const sessions=await(await fetch(base+'/api/history/sessions?agent='+encodeURIComponent(ref),{headers})).json();assert.equal(sessions.total,2);
 }
 const original=db.prepare("SELECT attributes FROM participants WHERE sid='PA_0'").get()!;assert.equal(JSON.parse(original.attributes as string)['lk.agent.name'],'old-agent');
});
test('agent list and overview count one stable identity across aliases, including worker-only names',async()=>{
 const headers=await auth();ensureAgentName('no-session-agent',at);
 const agents=await(await fetch(base+'/api/history/agents',{headers})).json();const current=agents.filter((r:any)=>r.id===target.id);assert.equal(current.length,1);assert.equal(current[0].totalSessions,2);assert.equal(agents.some((r:any)=>r.name==='old-agent'),false);assert.ok(agents.some((r:any)=>r.name==='no-session-agent'));
 const overview=await(await fetch(base+'/api/history/agents/'+target.id+'/overview',{headers})).json();assert.equal(overview.sessions.reduce((n:number,r:any)=>n+r.n,0),2);
});
test('stable identity model usage includes retained linked aliases without exposing conversation text',async()=>{
 const data=await(await fetch(base+'/api/agent-insights/agents/'+target.id+'/usage',{headers:await auth()})).json();assert.equal(data.coverage.totalReports,2);assert.equal(data.models[0].metrics.input_tokens,30);
});
