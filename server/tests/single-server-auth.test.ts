import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'single-auth-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'console.db'),LIVEKIT_URL:'ws://127.0.0.1:1',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',ADMIN_USER:'admin',ADMIN_PASSWORD:'bootstrap-password',SESSION_SECRET:'secret'});
const {db}=await import('../src/db.js');
const {login,me,requireAuth,requireAdmin,requireContent,hashPassword}=await import('../src/auth.js');
const {users}=await import('../src/users.js');
const app=express();app.use(express.json(),cookieParser());app.post('/login',login);app.get('/me',requireAuth,me);app.get('/content',requireAuth,requireContent('transcripts'),(_q,r)=>r.json({ok:true}));app.use('/users',requireAuth,requireAdmin,users);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port;
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
async function cookie(username:string,password='test-password'){const r=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0];}
test('single-server accounts retain independent content grants with immediate revocation',async()=>{
 const id=Number(db.prepare('INSERT INTO users(username,password_hash,role,created_at,transcripts) VALUES(?,?,?,?,1)').run('viewer',hashPassword('test-password'),'viewer',Date.now()).lastInsertRowid);
 const headers={cookie:await cookie('viewer')};assert.equal((await fetch(base+'/content',{headers})).status,200);
 const identity=await(await fetch(base+'/me',{headers})).json();assert.equal(identity.capabilities.transcripts,true);assert.equal(identity.projectId,undefined);assert.equal(identity.globalAdmin,undefined);
 db.prepare('UPDATE users SET transcripts=0 WHERE id=?').run(id);assert.equal((await fetch(base+'/content',{headers})).status,403);
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);assert.equal((await fetch(base+'/content',{headers})).status,403);
 assert.equal((await fetch(base+'/me',{headers:{'x-console-gateway':'untrusted'}})).status,401);
});
test('team permissions validate atomically and expose no project membership',async()=>{
 const headers={cookie:await cookie('admin','bootstrap-password'),'content-type':'application/json'};
 const r=await fetch(base+'/users',{method:'POST',headers,body:JSON.stringify({username:'reader',password:'test-password',role:'viewer',capabilities:{transcripts:true,recordings:false,logs:false}})});assert.equal(r.status,201);
 const id=(await r.json()).id;assert.equal((await fetch(base+'/content',{headers:{cookie:await cookie('reader')}})).status,200);
 const invalid=await fetch(base+'/users/'+id,{method:'PATCH',headers,body:JSON.stringify({role:'admin',password:'short'})});assert.equal(invalid.status,400);assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(id)!.role,'viewer');
 const revoked=await fetch(base+'/users/'+id,{method:'PATCH',headers,body:JSON.stringify({capabilities:{transcripts:false,recordings:false,logs:false}})});assert.equal(revoked.status,200);
 const rows=await(await fetch(base+'/users',{headers})).json();assert.equal(rows.find((u:any)=>u.id===id).capabilities.transcripts,false);
});
test('insight route case variants enforce identical independent grants',async()=>{
 const {insightContent}=await import('../src/insight-content.js');
 const protectedApp=express();protectedApp.use(cookieParser(),requireAuth,insightContent);protectedApp.get('/:id/:part',(_q,r)=>r.json({ok:true}));
 const service=protectedApp.listen(0,'127.0.0.1');await new Promise<void>(r=>service.once('listening',r));
 try{
  db.prepare('INSERT INTO users(username,password_hash,role,created_at,transcripts,logs) VALUES(?,?,?,?,1,0)').run('case-viewer',hashPassword('test-password'),'viewer',Date.now());const headers={cookie:await cookie('case-viewer')};
  for(const route of ['/job/logs','/job/LOGS','/job/LoGs','/job/telemetry','/job/TELEMETRY','/job/EXPORT'])assert.equal((await fetch('http://127.0.0.1:'+(service.address() as any).port+route,{headers})).status,403,route);
 }finally{await new Promise<void>(r=>service.close(()=>r()));}
});
