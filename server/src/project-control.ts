import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Auth, ContentCapabilities, Role } from './auth.js';
import { db } from './db.js';

export type Membership = { role: Role; transcripts: boolean; recordings: boolean; logs: boolean };
export type ProjectAccess = { role: Role; capabilities: ContentCapabilities; globalAdmin: boolean };
db.exec(`
 PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS control_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS project_memberships(project_id TEXT NOT NULL,user_id INTEGER NOT NULL,role TEXT NOT NULL,transcripts INTEGER NOT NULL,recordings INTEGER NOT NULL,logs INTEGER NOT NULL,PRIMARY KEY(project_id,user_id));
 CREATE TABLE IF NOT EXISTS control_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,project_id TEXT NOT NULL,actor TEXT NOT NULL,method TEXT NOT NULL,route TEXT NOT NULL,resource_hash TEXT NOT NULL,action TEXT NOT NULL,status INTEGER);
 CREATE INDEX IF NOT EXISTS control_audit_project_time ON control_audit(project_id,at DESC);
 CREATE INDEX IF NOT EXISTS control_audit_time ON control_audit(at);
`);
export function initializeControl(source: string): void {
 if(db.prepare("SELECT 1 FROM control_metadata WHERE key='users-migrated'").get())return;
 let rows:Record<string,any>[]=[];
 if(existsSync(source)){
  const legacy=new DatabaseSync(source,{readOnly:true});
  try{if(legacy.prepare("SELECT 1 FROM sqlite_master WHERE name='users'").get())rows=legacy.prepare('SELECT id,username,password_hash,role,created_at,last_login_at FROM users').all();}
  finally{legacy.close();}
 }
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const row of rows)db.prepare('INSERT OR IGNORE INTO users(id,username,password_hash,role,created_at,last_login_at) VALUES(?,?,?,?,?,?)').run(row.id,row.username,row.password_hash,row.role,row.created_at,row.last_login_at);
  // Only users present at migration receive legacy default-project membership.
  for(const row of db.prepare("SELECT id,role FROM users WHERE role='viewer'").all())db.prepare("INSERT OR IGNORE INTO project_memberships VALUES('default',?,'viewer',0,0,0)").run(row.id);
  db.prepare("INSERT INTO control_metadata VALUES('users-migrated','1')").run();db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function projectAccess(auth: Auth, projectId: string): ProjectAccess | null {
 if(auth.role==='admin')return {role:'admin',capabilities:{transcripts:true,recordings:true,logs:true},globalAdmin:true};
 if(auth.id===undefined)return null;
 const row=db.prepare('SELECT m.* FROM project_memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND m.user_id=?').get(projectId,auth.id);
 return row?{role:row.role as Role,capabilities:{transcripts:!!row.transcripts,recordings:!!row.recordings,logs:!!row.logs},globalAdmin:false}:null;
}
export function memberships(projectId:string){return db.prepare('SELECT m.user_id userId,u.username,m.role,m.transcripts,m.recordings,m.logs FROM project_memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.username').all(projectId).map(r=>({...r,transcripts:!!r.transcripts,recordings:!!r.recordings,logs:!!r.logs}));}
export function setMembership(userId:number,projectId:string,input:Membership):void{
 if(!Number.isSafeInteger(userId)||!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId))throw new Error('User not found');
 if(!input||!['admin','viewer'].includes(input.role)||['transcripts','recordings','logs'].some(k=>typeof input[k as keyof Membership]!=='boolean')||Object.keys(input).some(k=>!['role','transcripts','recordings','logs'].includes(k)))throw new Error('Invalid project membership');
 db.prepare('INSERT INTO project_memberships VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,transcripts=excluded.transcripts,recordings=excluded.recordings,logs=excluded.logs').run(projectId,userId,input.role,+input.transcripts,+input.recordings,+input.logs);
}
export function removeMembership(userId:number,projectId:string):void{db.prepare('DELETE FROM project_memberships WHERE project_id=? AND user_id=?').run(projectId,userId);}
const routeShape=(route:string)=>{
 const known=new Set(['api','p','auth','login','logout','projects','users','members','operations','policy','rules','alerts','ack','resolve','data','export','rooms','participants','dispatches','inventory','agents','aliases','lk','sip','egress','ingress','recordings','sessions','agent-insights','telemetry','logs','history','tokens']);
 return route.split('?')[0].split('/').map(part=>!part||known.has(part)||/^(List|Create|Update|Delete|Start|Stop)[A-Za-z]+$/.test(part)?part:':resource').join('/').slice(0,300);
};
export function beginAudit(input:{projectId:string;actor:string;method:string;route:string;action:string}):string{
 const id=randomUUID(),route=input.route.split('?')[0];
 db.prepare('INSERT INTO control_audit VALUES(?,?,?,?,?,?,?,?,NULL)').run(id,Date.now(),input.projectId,input.actor.slice(0,64),input.method,routeShape(route),createHash('sha256').update(route).digest('hex'),input.action);
 return id;
}
export function finishAudit(id:string,status:number):void{db.prepare('UPDATE control_audit SET status=? WHERE id=?').run(status,id);}
export function auditRows(projectId:string,limit=100){return db.prepare('SELECT id,at,project_id projectId,actor,method,route,resource_hash resourceHash,action,status FROM control_audit WHERE project_id=? ORDER BY at DESC,rowid DESC LIMIT ?').all(projectId,Math.min(200,Math.max(1,limit)));}
export function pruneAudit():void{
 const days=Number(process.env.AUDIT_RETENTION_DAYS??365);if(!Number.isInteger(days)||days<1||days>3650)throw new Error('AUDIT_RETENTION_DAYS must be 1–3650');
 db.prepare('DELETE FROM control_audit WHERE at<?').run(Date.now()-days*86400000);
}
