import { Router } from 'express';
import { config } from './config.js';
import { authOf, capabilitiesOf, hashPassword, type Role, type ContentCapabilities } from './auth.js';
import { db } from './db.js';

export const users = Router();
const ROLES: Role[] = ['admin', 'viewer'];
const validName = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9._@-]{3,64}$/.test(v);
const validPass = (v: unknown): v is string => typeof v === 'string' && v.length >= 10 && v.length <= 200;
function validCapabilities(value: unknown): value is ContentCapabilities {
 return !!value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===3 && ['transcripts','recordings','logs'].every(k=>typeof (value as any)[k]==='boolean');
}
users.get('/', (_req, res) => {
 const rows=db.prepare('SELECT id,username,role,created_at AS createdAt,last_login_at AS lastLoginAt,transcripts,recordings,logs FROM users ORDER BY username').all();
 res.json([{id:'env',username:config.adminUser,role:'admin',source:'env',createdAt:null,lastLoginAt:null,capabilities:{transcripts:true,recordings:true,logs:true}},...rows.map(({transcripts,recordings,logs,...row})=>({...row,source:'db',capabilities:capabilitiesOf({transcripts:Number(transcripts),recordings:Number(recordings),logs:Number(logs)})}))]);
});
users.post('/', (req,res)=>{
 const {username,password,role,capabilities}=req.body??{};
 if(!validName(username))return void res.status(400).json({error:'Username must be 3-64 characters: letters, digits, . _ @ -'});
 if(!validPass(password))return void res.status(400).json({error:'Password must be 10–200 characters'});
 if(!ROLES.includes(role)||capabilities!==undefined&&!validCapabilities(capabilities))return void res.status(400).json({error:'Invalid role or content permissions'});
 if(username.toLowerCase()===config.adminUser.toLowerCase())return void res.status(409).json({error:'That username is reserved for the bootstrap admin'});
 const caps=capabilities??{transcripts:role==='admin',recordings:role==='admin',logs:role==='admin'};
 try{const r=db.prepare('INSERT INTO users(username,password_hash,role,created_at,transcripts,recordings,logs) VALUES(?,?,?,?,?,?,?)').run(username,hashPassword(password),role,Date.now(),+caps.transcripts,+caps.recordings,+caps.logs);res.status(201).json({id:Number(r.lastInsertRowid),username,role,capabilities:caps});}
 catch{res.status(409).json({error:'A user with that name already exists'});}
});
users.patch('/:id',(req,res)=>{
 const id=Number(req.params.id),{role,password,capabilities}=req.body??{};
 if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))return void res.status(404).json({error:'User not found'});
 if(role!==undefined&&!ROLES.includes(role)||password!==undefined&&!validPass(password)||capabilities!==undefined&&!validCapabilities(capabilities))return void res.status(400).json({error:'Invalid role, password or content permissions'});
 if(authOf(req).id===id&&role!==undefined&&role!=='admin')return void res.status(400).json({error:"You can't demote yourself"});
 db.exec('BEGIN IMMEDIATE');try{
  if(role!==undefined)db.prepare('UPDATE users SET role=? WHERE id=?').run(role,id);
  if(password!==undefined)db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),id);
  if(capabilities!==undefined)db.prepare('UPDATE users SET transcripts=?,recordings=?,logs=? WHERE id=?').run(+capabilities.transcripts,+capabilities.recordings,+capabilities.logs,id);
  db.exec('COMMIT');res.json({ok:true});
 }catch(error){db.exec('ROLLBACK');throw error;}
});
users.delete('/:id',(req,res)=>{
 const id=Number(req.params.id);if(authOf(req).id===id)return void res.status(400).json({error:"You can't remove yourself"});
 if(!db.prepare('DELETE FROM users WHERE id=?').run(id).changes)return void res.status(404).json({error:'User not found'});res.json({ok:true});
});
