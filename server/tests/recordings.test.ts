import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Readable } from 'node:stream';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'lkc-media-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'test.db'),LIVEKIT_URL:'ws://127.0.0.1:1',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',ADMIN_USER:'admin',ADMIN_PASSWORD:'test-password',SESSION_SECRET:'test-secret'});
const {recordingRouter}=await import('../src/recordings.js'),{db}=await import('../src/db.js'),{login,hashPassword}=await import('../src/auth.js');
const storage={bucket:'test-bucket',prefix:'calls/',retentionDays:30};let calls=0;
const client={send:async(command:any)=>{calls++;const range=command.input.Range;return {Body:Readable.from(Buffer.from(range?'0123':'0123456789')),ContentLength:range?4:10,ContentRange:range?'bytes 0-3/10':undefined};}};
const app=express();app.use(express.json(),cookieParser());app.post('/login',login);app.use('/recordings',recordingRouter(storage,client as any));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(dir,{recursive:true,force:true});});
const raw={roomComposite:{fileOutputs:[{s3:{bucket:'test-bucket',accessKey:'never-return-this'}}]},fileResults:[{filename:'calls/test.ogg',startedAt:'1700000000000000000',duration:'10000000000',size:'10'}]};
db.prepare('INSERT INTO egress(egress_id,room_sid,started_at,ended_at,info) VALUES (?,?,?,?,?)').run('EG_test','RM_test',Date.now(),Date.now(),JSON.stringify(raw));
db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,?,?)').run('reader',hashPassword('test-password'),'viewer',Date.now());
async function cookie(username='admin'){const r=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'test-password'})});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0];}
test('recording inventory and every stream request enforce administrator authorization',async()=>{
 for(const route of ['/recordings/sessions/RM_test','/recordings/EG_test/0/stream']){
  assert.equal((await fetch(base+route)).status,401);assert.equal((await fetch(base+route,{headers:{cookie:await cookie('reader')}})).status,403);
 }
 assert.equal(calls,0);
 const data=await(await fetch(base+'/recordings/sessions/RM_test',{headers:{cookie:await cookie()}})).json();assert.equal(data.files[0].source,'egress');assert.equal(data.files[0].state,'ready');assert.equal(JSON.stringify(data).includes('never-return-this'),false);assert.equal(data.files[0].key,undefined);
});
test('authorized media supports HEAD, streaming and byte ranges without redirecting to storage',async()=>{
 const auth={cookie:await cookie()};const url=base+'/recordings/EG_test/0/stream';
 const head=await fetch(url,{method:'HEAD',headers:auth});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
 const ranged=await fetch(url,{headers:{...auth,range:'bytes=0-3'}});assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),'bytes 0-3/10');assert.equal(ranged.headers.get('cache-control'),'no-store');assert.equal(await ranged.text(),'0123');assert.equal(ranged.headers.get('location'),null);
 assert.equal((await fetch(url,{headers:{...auth,range:'bytes=0-1,3-4'}})).status,416);
 assert.equal(await(await fetch(url,{headers:auth})).text(),'0123456789');
 db.prepare("UPDATE egress SET started_at=1,ended_at=1 WHERE egress_id='EG_test'").run();assert.equal((await fetch(url,{headers:auth})).status,410);
});

test('missing stored references and malformed resource identifiers never invoke storage',async()=>{
 const auth={cookie:await cookie()},before=calls;
 for(const route of ['/recordings/EG_missing/0/stream','/recordings/invalid/0/stream','/recordings/EG_test/999/stream'])assert.equal((await fetch(base+route,{headers:auth})).status,404);
 assert.equal(calls,before);
});
