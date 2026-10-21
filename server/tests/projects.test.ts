import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'console-projects-'));
after(()=>rmSync(dir,{recursive:true,force:true}));
const { loadProjects }=await import('../src/projects.js');
const base={LIVEKIT_URL:'ws://default',LIVEKIT_API_KEY:'default-key',LIVEKIT_API_SECRET:'default-secret',DB_PATH:path.join(dir,'default.db'),ADMIN_USER:'admin',ADMIN_PASSWORD:'password',SESSION_SECRET:'session',PORT:'8090',AWS_SECRET_ACCESS_KEY:'private-default',AGENT_TELEMETRY_TOKEN:'private-default-token'};
const file=path.join(dir,'projects.json'),envFile=path.join(dir,'other.env');
writeFileSync(envFile,`LIVEKIT_URL=ws://other\nLIVEKIT_API_KEY=other-key\nLIVEKIT_API_SECRET=other-secret\nDB_PATH=${path.join(dir,'other.db')}\n`);
test('default settings stay intact while additional projects cannot inherit credentials',()=>{
 writeFileSync(file,JSON.stringify({projects:[{id:'default',name:'Current'},{id:'other',name:'Other',envFile:'other.env'}]}));
 const result=loadProjects({...base,CONSOLE_PROJECTS_FILE:file});assert.equal(result.projects.length,2);
 const [first,other]=result.projects;assert.equal(first.env.LIVEKIT_API_SECRET,'default-secret');assert.equal(other.env.LIVEKIT_API_SECRET,'other-secret');assert.equal(other.env.AWS_SECRET_ACCESS_KEY,undefined);assert.equal(other.env.AGENT_TELEMETRY_TOKEN,undefined);assert.notEqual(first.secret,other.secret);assert.notEqual(first.dbPath,result.controlDbPath);assert.equal(other.env.HOST,'127.0.0.1');
});
test('ambiguous IDs, missing credentials and shared databases fail closed',()=>{
 for(const projects of [
  [{id:'default',name:'Current'},{id:'default',name:'Again'}],
  [{id:'../other',name:'Invalid',envFile:'other.env'}],
  [{id:'other',name:'Other'}],
 ]) {writeFileSync(file,JSON.stringify({projects}));assert.throws(()=>loadProjects({...base,CONSOLE_PROJECTS_FILE:file}));}
 writeFileSync(path.join(dir,'same.env'),`LIVEKIT_URL=ws://other\nLIVEKIT_API_KEY=k\nLIVEKIT_API_SECRET=s\nDB_PATH=${base.DB_PATH}\n`);
 writeFileSync(file,JSON.stringify({projects:[{id:'default',name:'Current'},{id:'other',name:'Other',envFile:'same.env'}]}));assert.throws(()=>loadProjects({...base,CONSOLE_PROJECTS_FILE:file}),/database/i);
});
