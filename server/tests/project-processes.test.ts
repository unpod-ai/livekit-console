import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import jwt from 'jsonwebtoken';
const dir=mkdtempSync(path.join(tmpdir(),'project-processes-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'control.db'),LIVEKIT_URL:'ws://localhost',LIVEKIT_API_KEY:'control-key',LIVEKIT_API_SECRET:'control-secret',ADMIN_USER:'admin',ADMIN_PASSWORD:'test-password',SESSION_SECRET:'test-secret'});
const {startGateway}=await import('../src/project-gateway.js');
const projects:any[]=[],mocks:any[]=[],calls:string[]=[];
for(const [index,id]of ['default','other'].entries()){
 const upstream=createServer((req,res)=>{
  try{const token=(req.headers.authorization??'').replace(/^Bearer /,'');const claim=jwt.verify(token,('api-secret-'+id).padEnd(32,'!')) as jwt.JwtPayload;assert.equal(claim.iss,'api-key-'+id);calls.push(id);res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url?.endsWith('ListRooms')?{rooms:[{sid:'RM_collision',name:id}]}:{items:[]}));}
  catch{res.statusCode=401;res.end('{}');}
 });upstream.listen(0,'127.0.0.1');await new Promise<void>(r=>upstream.once('listening',r));mocks.push(upstream);
 const reserve=createServer();reserve.listen(0,'127.0.0.1');await new Promise<void>(r=>reserve.once('listening',r));const port=(reserve.address() as any).port;await new Promise<void>(r=>reserve.close(()=>r()));
 const file=path.join(dir,id+'.db'),seed=new DatabaseSync(file);seed.exec('CREATE TABLE sessions(room_sid TEXT PRIMARY KEY,room_name TEXT NOT NULL,started_at INTEGER NOT NULL,ended_at INTEGER,partial INTEGER NOT NULL DEFAULT 0)');seed.prepare('INSERT INTO sessions VALUES(?,?,?,?,0)').run('RM_collision',id,Date.now()-1000,Date.now());seed.close();
 const secret='gateway-secret-'+id;
 projects.push({id,name:id,dbPath:file,port,secret,env:{PATH:process.env.PATH,HOME:process.env.HOME,DB_PATH:file,HOST:'127.0.0.1',PORT:String(port),CONSOLE_PROJECT_CHILD:'1',CONSOLE_PROJECT_ID:id,CONSOLE_GATEWAY_SECRET:secret,LIVEKIT_URL:`ws://127.0.0.1:${(upstream.address() as any).port}`,LIVEKIT_API_KEY:'api-key-'+id,LIVEKIT_API_SECRET:('api-secret-'+id).padEnd(32,'!'),ADMIN_USER:'gateway',ADMIN_PASSWORD:'unused',SESSION_SECRET:'unused',AGENT_TELEMETRY_TOKEN:('telemetry-'+id).padEnd(32,'!')}});
}
const gateway=await startGateway({projects,controlDbPath:process.env.DB_PATH!,port:0,host:'127.0.0.1'});await new Promise<void>(r=>gateway.server.listening?r():gateway.server.once('listening',r));const base=`http://127.0.0.1:${(gateway.server.address() as any).port}`;
after(async()=>{await gateway.close();for(const s of mocks)await new Promise<void>(r=>s.close(()=>r()));const{db}=await import('../src/db.js');db.close();rmSync(dir,{recursive:true,force:true});});
test('real backend processes use separate databases, SDK credentials and telemetry tokens',async()=>{
 for(let i=0;i<50&&[...gateway.runtimes.values()].some(r=>r.state!=='ready');i++)await new Promise(r=>setTimeout(r,200));
 assert.ok([...gateway.runtimes.values()].every(r=>r.state==='ready'),'both child backends became ready');
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'test-password'})});const headers={cookie:login.headers.get('set-cookie')!.split(';')[0]};
 for(const id of ['default','other']){
  const live=await(await fetch(base+'/p/'+id+'/api/rooms',{headers})).json();assert.equal(live[0].name,id);
  const retained=await(await fetch(base+'/p/'+id+'/api/history/sessions/RM_collision',{headers})).json();assert.equal(retained.session.room_name,id);
  const wrong=await fetch(base+'/p/'+id+'/api/telemetry/session-reports',{method:'POST',headers:{authorization:'Bearer wrong-token','content-type':'application/json'},body:'{}'});assert.equal(wrong.status,401);
  const own=await fetch(base+'/p/'+id+'/api/telemetry/session-reports',{method:'POST',headers:{authorization:'Bearer '+('telemetry-'+id).padEnd(32,'!'),'content-type':'application/json'},body:'{}'});assert.equal(own.status,422);
 }
 assert.ok(calls.includes('default'));assert.ok(calls.includes('other'));
});
