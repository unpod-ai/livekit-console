import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
const dir=mkdtempSync(path.join(tmpdir(),'deployments-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'test.db'),LIVEKIT_URL:'ws://localhost',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',ADMIN_USER:'admin',ADMIN_PASSWORD:'test-password',SESSION_SECRET:'test',DEPLOYMENT_HELPER_TOKEN:'a-dedicated-console-token-at-least-32-characters'});
let called:string[]=[];let mode='ok';
const host=express();host.use(express.json());host.use((req,res)=>{
 called.push(req.path);if(req.get('authorization')!=='Bearer '+process.env.DEPLOYMENT_HELPER_TOKEN){res.sendStatus(401);return;}
 if(mode==='bad'){res.status(500).json({error:'provider-SECRET-secret'});return;}
 if(req.path==='/targets'){res.json({targets:[{id:'worker',name:'Worker',agentName:'fixture-agent',image:'fixture:v1',imageId:'sha256:abc',managed:false,actionsEnabled:false}],operations:[]});return;}
 if(req.path.endsWith('/logs')){res.json({lines:['safe message'],truncated:false});return;}
 if(req.path.endsWith('/secrets')){res.json({revision:'one',keys:['API_KEY'],allowedKeys:['API_KEY']});return;}
 res.json({id:'operation',state:'queued'});
});const upstream=host.listen(0,'127.0.0.1');await new Promise<void>(r=>upstream.once('listening',r));process.env.DEPLOYMENT_HELPER_URL=`http://127.0.0.1:${(upstream.address() as any).port}`;
const {deployments,deploymentTargetSnapshot}=await import('../src/deployments.js');const {login,hashPassword}=await import('../src/auth.js');const {db}=await import('../src/db.js');
const app=express();app.use(express.json(),cookieParser());app.post('/login',login);app.use('/api/deployments',deployments);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{for(const s of [server,upstream])await new Promise<void>(r=>s.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
async function auth(user='admin'){const response=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password:'test-password'})});return {cookie:response.headers.get('set-cookie')!.split(';')[0],'content-type':'application/json'};}
test('deployment reads require admin and route only to the configured host helper',async()=>{
 assert.equal((await fetch(base+'/api/deployments/targets')).status,401);db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)').run('viewer',hashPassword('test-password'),'viewer',Date.now());assert.equal((await fetch(base+'/api/deployments/targets',{headers:await auth('viewer')})).status,403);
 const r=await(await fetch(base+'/api/deployments/targets',{headers:await auth()})).json();assert.equal(r.configured,true);assert.equal(r.targets[0].id,'worker');assert.equal(called.at(-1),'/targets');assert.equal(JSON.stringify(r).includes(process.env.DEPLOYMENT_HELPER_TOKEN!),false);
 const snapshot=await deploymentTargetSnapshot('worker');assert.equal(snapshot.imageId,'sha256:abc');assert.equal(snapshot.agentName,'fixture-agent');
});
test('mutations require confirmation and recognized actions; helper failures never expose response bodies',async()=>{
 const headers=await auth(),endpoint=base+'/api/deployments/targets/worker/actions';
 for(const body of [{action:'drain',confirm:'other',requestId:'request-1'},{action:'shell',confirm:'worker',requestId:'request-1'},{action:'drain',confirm:'worker',requestId:'request-1',command:'rm'}])assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)})).status,400);
 mode='bad';const response=await fetch(base+'/api/deployments/targets',{headers});assert.equal(response.status,502);assert.equal((await response.text()).includes('SECRET'),false);mode='ok';
});
