import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
const dir=mkdtempSync(path.join(tmpdir(),'project-gateway-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'control.db'),LIVEKIT_URL:'ws://localhost',LIVEKIT_API_KEY:'key',LIVEKIT_API_SECRET:'secret',ADMIN_USER:'admin',ADMIN_PASSWORD:'test-password',SESSION_SECRET:'cookie-secret'});
const {createGatewayApp}=await import('../src/project-gateway.js');
const {db}=await import('../src/db.js');const {hashPassword}=await import('../src/auth.js');
const {initializeControl,setMembership,removeMembership}=await import('../src/project-control.js');
initializeControl(path.join(dir,'missing.db'));db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES(1,?,?,?,?)').run('viewer',hashPassword('test-password'),'viewer',Date.now());
const servers:any[]=[],projects:any[]=[];
for(const id of ['default','other']){
 const app=express();
 app.use((req,res)=>{
  if(req.path==='/webhook'||req.path.startsWith('/api/telemetry/')){let text='';req.on('data',b=>text+=b);req.on('end',()=>res.json({project:id,raw:text,authorization:req.get('authorization')}));return;}
  try{jwt.verify(req.get('x-console-gateway')??'','secret-'+id,{algorithms:['HS256'],audience:'console-project:'+id});}catch{res.status(401).end();return;}
  if(req.path==='/api/recordings/file'){res.status(206).set({'Content-Type':'audio/ogg','Content-Range':'bytes 0-3/10'}).send('data');return;}
  res.json({project:id,roomSid:'RM_collision',cookie:req.get('cookie')??null});
 });
 const s=app.listen(0,'127.0.0.1');await new Promise<void>(r=>s.once('listening',r));servers.push(s);projects.push({id,name:id,port:(s.address() as any).port,secret:'secret-'+id,env:{},dbPath:path.join(dir,id+'.db')});
}
let backendState='ready';
const app=createGatewayApp({projects,controlDbPath:process.env.DB_PATH!,port:8080,host:'127.0.0.1'},()=> backendState);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));servers.push(server);const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{for(const s of servers)await new Promise<void>(r=>s.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
async function login(user='admin'){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password:'test-password'})});return {cookie:r.headers.get('set-cookie')!.split(';')[0]};}
test('explicit routing keeps colliding IDs separate and strips client authority headers',async()=>{
 const headers={...await login(),'x-console-gateway':'forged'};
 for(const id of ['default','other']){const r=await(await fetch(base+'/p/'+id+'/api/history/sessions/RM_collision',{headers})).json();assert.equal(r.project,id);assert.equal(r.cookie,null);}
 assert.equal((await(await fetch(base+'/api/rooms',{headers})).json()).project,'default');
 const rows=await(await fetch(base+'/api/projects',{headers})).json();assert.equal(rows.length,2);assert.equal(JSON.stringify(rows).includes('secret-'),false);
});
test('membership and mixed-content permissions apply on every subsequent request',async()=>{
 const headers=await login('viewer');assert.equal((await fetch(base+'/p/other/api/rooms',{headers})).status,403);
 setMembership(1,'other',{role:'viewer',transcripts:true,logs:false,recordings:true});
 assert.equal((await fetch(base+'/p/other/api/rooms',{headers})).status,200);
 assert.equal((await fetch(base+'/p/other/api/agent-insights/sessions/RM_collision',{headers})).status,200);
 assert.equal((await fetch(base+'/p/other/api/agent-insights/sessions/RM_collision/export',{headers})).status,403);
 assert.equal((await fetch(base+'/p/other/api/rooms',{method:'POST',headers})).status,403);
 const media=await fetch(base+'/p/other/api/recordings/file',{headers:{...headers,range:'bytes=0-3'}});assert.equal(media.status,206);assert.equal(media.headers.get('content-range'),'bytes 0-3/10');assert.equal(await media.text(),'data');
 removeMembership(1,'other');assert.equal((await fetch(base+'/p/other/api/recordings/file',{headers})).status,403);
});
test('ingestion forwards original bytes and service authorization without browser identity',async()=>{
 const raw='{ "signed": true, "project": "other" }';
 const r=await fetch(base+'/p/other/webhook',{method:'POST',headers:{'content-type':'application/webhook+json',authorization:'Bearer project-service-token'},body:raw});const data=await r.json();assert.equal(data.project,'other');assert.equal(data.raw,raw);assert.equal(data.authorization,'Bearer project-service-token');
});

test('failed backend readiness never proxies to another listener and denied writes are audited',async()=>{
 const headers=await login();backendState='failed';assert.equal((await fetch(base+'/p/other/api/rooms',{headers})).status,503);backendState='ready';
 setMembership(1,'other',{role:'viewer',transcripts:false,logs:false,recordings:false});const viewer=await login('viewer');assert.equal((await fetch(base+'/p/other/api/rooms',{method:'DELETE',headers:viewer})).status,403);
 const audit=await(await fetch(base+'/p/other/api/operations/audit',{headers})).json();assert.ok(audit.rows.some((r:any)=>r.actor==='viewer'&&r.status===403));
});
test('every operations export is audited and refuses to start if audit storage fails',async()=>{
 const headers=await login();const before=Number(db.prepare("SELECT COUNT(*) n FROM control_audit WHERE project_id='other'").get()!.n);
 for(const category of ['diagnostics','workers','traffic'])assert.equal((await fetch(base+'/p/other/api/operations/export/'+category,{headers})).status,200);
 assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM control_audit WHERE project_id='other'").get()!.n),before+3);
 db.exec("CREATE TRIGGER audit_unavailable BEFORE INSERT ON control_audit BEGIN SELECT RAISE(ABORT,'unavailable'); END");
 try{assert.equal((await fetch(base+'/p/other/api/operations/export/diagnostics',{headers})).status,503);}finally{db.exec('DROP TRIGGER audit_unavailable');}
});
test('denied global membership changes are retained in project audit without granting access',async()=>{
 const headers={...await login('viewer'),'content-type':'application/json'};
 const r=await fetch(base+'/api/projects/other/members/1',{method:'PUT',headers,body:JSON.stringify({role:'admin',transcripts:true,recordings:true,logs:true})});assert.equal(r.status,403);
 const row=db.prepare("SELECT status FROM control_audit WHERE actor='viewer' AND project_id='other' AND action='project-membership' ORDER BY rowid DESC LIMIT 1").get();assert.equal(row?.status,403);
});
