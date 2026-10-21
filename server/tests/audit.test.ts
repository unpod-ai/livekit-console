import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'console-audit-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'console.db'),LIVEKIT_URL:'ws://127.0.0.1:1',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',ADMIN_USER:'admin',ADMIN_PASSWORD:'test-password',SESSION_SECRET:'secret'});
const {db}=await import('../src/db.js');const {auditRequests,auditRows}=await import('../src/audit.js');const {login,requireAdmin,requireContent}=await import('../src/auth.js');
const app=express();app.use(express.json(),cookieParser());app.use('/api',auditRequests);app.post('/api/auth/login',login);app.get('/api/deployments/targets/worker/logs',requireAdmin,requireContent('logs'),(_q,r)=>r.json({lines:[]}));app.get('/api/deployments/targets/worker/secrets',requireAdmin,(_q,r)=>r.json({keys:[]}));app.post('/api/deployments/targets/worker/actions',requireAdmin,(_q,r)=>r.json({ok:true}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port;
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
const cookie='lkc_session='+jwt.sign({sub:'admin',src:'env'},'secret');
test('single-server audit records failed login, denied actions and sensitive reads without secrets',async()=>{
 await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'wrong-private-password'})});
 const id=Number(db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)').run('reader','unused','viewer',Date.now()).lastInsertRowid);
 const viewer='lkc_session='+jwt.sign({src:'db',uid:id},'secret');
 assert.equal((await fetch(base+'/api/deployments/targets/worker/actions?token=private-query',{method:'POST',headers:{cookie:viewer,'content-type':'application/json'},body:JSON.stringify({value:'private-body'})})).status,403);
 for(const suffix of ['logs','secrets'])assert.equal((await fetch(base+'/api/deployments/targets/worker/'+suffix,{headers:{cookie}})).status,200);
 const rows=auditRows();assert.equal(rows.length,4);assert.ok(rows.some(r=>r.action==='login'&&r.status===401));assert.ok(rows.some(r=>r.actor==='reader'&&r.status===403));assert.ok(!JSON.stringify(rows).includes('private-'));assert.ok(rows.every(r=>!('projectId' in r)));assert.ok(rows.every(r=>!String(r.route).includes('worker')));
});
test('audit failure stops mutations before handlers run',async()=>{
 db.exec('ALTER TABLE console_audit RENAME TO audit_unavailable');
 try{assert.equal((await fetch(base+'/api/deployments/targets/worker/actions',{method:'POST',headers:{cookie}})).status,503);}finally{db.exec('ALTER TABLE audit_unavailable RENAME TO console_audit');}
});
