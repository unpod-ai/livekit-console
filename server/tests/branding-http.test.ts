import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const temp=mkdtempSync(path.join(tmpdir(),'branding-http-'));
const socket=createServer();socket.listen(0,'127.0.0.1');await new Promise<void>(r=>socket.once('listening',r));const port=(socket.address() as any).port;await new Promise<void>(r=>socket.close(()=>r()));
const child=spawn(process.execPath,['--import','tsx',new URL('../src/index.ts',import.meta.url).pathname],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DB_PATH:path.join(temp,'test.db'),LIVEKIT_URL:'ws://127.0.0.1:1',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'private-secret-not-public',ADMIN_USER:'admin',ADMIN_PASSWORD:'private-password',SESSION_SECRET:'private-session',CONSOLE_NAME:'Operations <Demo> & Team',CONSOLE_DOMAIN:'ops.example.test',CONSOLE_LOGO_URL:'/brand.svg',CONSOLE_FAVICON_URL:'https://assets.example.test/icon.svg',AGENT_WORKER_URLS:'',GITHUB_TOKEN:''},stdio:['ignore','pipe','pipe']});
let startup='';child.stdout?.on('data',v=>{startup=(startup+v).slice(-1600)});child.stderr?.on('data',v=>{startup=(startup+v).slice(-1600)});
after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise<void>(r=>child.once('exit',()=>r()));}rmSync(temp,{recursive:true,force:true});});
const base='http://127.0.0.1:'+port;
let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error('Branding test server failed to start');try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
test('only public branding is available before login and production HTML receives escaped runtime values',async()=>{
 assert.ok(ready,'Branding server not ready: '+startup);
 const response=await fetch(base+'/branding.json');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const brand=await response.json();assert.deepEqual(brand,{name:'Operations <Demo> & Team',domain:'ops.example.test',logoUrl:'/brand.svg',faviconUrl:'https://assets.example.test/icon.svg'});assert.ok(!JSON.stringify(brand).includes('private'));
 assert.equal((await fetch(base+'/api/config')).status,401);
 for(const route of ['/','/login','/index.html']){const html=await(await fetch(base+route)).text();assert.ok(html.includes('<title>Operations &lt;Demo&gt; &amp; Team</title>'));assert.ok(html.includes('href="https://assets.example.test/icon.svg"'));assert.ok(!html.includes('private'));}
 const logo=await fetch(base+'/brand.svg');assert.equal(logo.status,200);assert.ok(logo.headers.get('content-type')?.includes('image/svg+xml'));
});
