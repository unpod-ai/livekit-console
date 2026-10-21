import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
const dir=mkdtempSync(path.join(tmpdir(),'project-auth-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'test.db'),LIVEKIT_URL:'ws://localhost',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',ADMIN_USER:'admin',ADMIN_PASSWORD:'test',SESSION_SECRET:'cookie-secret',CONSOLE_PROJECT_CHILD:'1',CONSOLE_PROJECT_ID:'other',CONSOLE_GATEWAY_SECRET:'gateway-test-secret'});
const auth=await import('../src/auth.js');const {db}=await import('../src/db.js');
const app=express();app.use(cookieParser(),auth.requireAuth);app.get('/me',auth.me);app.get('/transcripts',auth.requireContent('transcripts'),(_,r)=>r.json({ok:true}));app.get('/mixed',auth.requireContent('transcripts','logs'),(_,r)=>r.json({ok:true}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
const assertion=(claims:any={},aud='console-project:other',secret=process.env.CONSOLE_GATEWAY_SECRET!)=>jwt.sign({sub:'reader',role:'viewer',capabilities:{transcripts:true,recordings:false,logs:false},...claims},secret,{algorithm:'HS256',audience:aud,expiresIn:'30s'});
test('child rejects cookies, forged assertions and assertions for a different project',async()=>{
 const cookie=jwt.sign({sub:'admin',src:'env'},process.env.SESSION_SECRET!);
 assert.equal((await fetch(base+'/me',{headers:{cookie:'lkc_session='+cookie}})).status,401);
 for(const token of [assertion({},'console-project:default'),assertion({},undefined,'forged')])assert.equal((await fetch(base+'/me',{headers:{'x-console-gateway':token}})).status,401);
});
test('signed content grants permit viewer reads without mutation-role escalation and mixed grants stay separate',async()=>{
 const headers={'x-console-gateway':assertion()};
 const me=await(await fetch(base+'/me',{headers})).json();assert.equal(me.role,'viewer');assert.equal(me.projectId,'other');
 assert.equal((await fetch(base+'/transcripts',{headers})).status,200);
 assert.equal((await fetch(base+'/mixed',{headers})).status,403);
 const noGrants={'x-console-gateway':assertion({role:'admin',capabilities:{transcripts:false,logs:false,recordings:false}})};
 assert.equal((await fetch(base+'/transcripts',{headers:noGrants})).status,403);
});
