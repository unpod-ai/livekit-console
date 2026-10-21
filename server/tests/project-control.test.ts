import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const dir=mkdtempSync(path.join(tmpdir(),'project-control-'));
Object.assign(process.env,{DB_PATH:path.join(dir,'control.db'),LIVEKIT_URL:'ws://localhost',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test',ADMIN_USER:'admin',ADMIN_PASSWORD:'test',SESSION_SECRET:'test'});
const source=path.join(dir,'default.db'),legacy=new DatabaseSync(source);legacy.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,password_hash TEXT,role TEXT,created_at INTEGER,last_login_at INTEGER); INSERT INTO users VALUES(7,\'legacy-viewer\',\'hash\',\'viewer\',1,NULL)');legacy.close();
const control=await import('../src/project-control.js');const {db}=await import('../src/db.js');
after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
const user:any={user:'legacy-viewer',role:'viewer',source:'db',id:7};
test('legacy users migrate once to default membership and new users get no implicit access',()=>{
 control.initializeControl(source);control.initializeControl(source);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get()!.n,1);assert.equal(control.projectAccess(user,'default')?.role,'viewer');assert.equal(control.projectAccess(user,'other'),null);
 db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES(8,\'new-viewer\',\'hash\',\'viewer\',1)').run();assert.equal(control.projectAccess({...user,id:8},'default'),null);
});
test('memberships are explicit, revoked immediately, and global admins retain full grants',()=>{
 control.setMembership(7,'other',{role:'admin',transcripts:false,recordings:true,logs:false});assert.equal(control.projectAccess(user,'other')?.role,'admin');assert.equal(control.projectAccess(user,'other')?.capabilities.transcripts,false);
 control.removeMembership(7,'other');assert.equal(control.projectAccess(user,'other'),null);
 assert.equal(control.projectAccess({user:'admin',role:'admin',source:'env'},'other')?.capabilities.transcripts,true);
});
test('audit records retain pending/final outcomes without query strings or sensitive resource names',()=>{
 const id=control.beginAudit({projectId:'default',actor:'admin',method:'DELETE',route:'/rooms/+15555550123?token=secret',action:'mutation'});assert.equal(control.auditRows('default')[0].status,null);
 control.finishAudit(id,204);const rows=control.auditRows('default');assert.equal(rows[0].status,204);const encoded=JSON.stringify(rows);assert.equal(encoded.includes('15555550123'),false);assert.equal(encoded.includes('secret'),false);
});
test('control snapshot restores accounts memberships pending audit and migration state consistently',()=>{
 const file=path.join(dir,'control-backup.db');db.prepare('VACUUM INTO ?').run(file);const restored=new DatabaseSync(file,{readOnly:true});
 try{assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');for(const table of ['users','project_memberships','control_audit','control_metadata'])assert.equal(restored.prepare('SELECT COUNT(*) n FROM '+table).get()!.n,db.prepare('SELECT COUNT(*) n FROM '+table).get()!.n);}
 finally{restored.close();}
});
