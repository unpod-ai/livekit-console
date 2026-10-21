import { createHash, randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { authOf, requireAuth } from './auth.js';
import { db } from './db.js';

const known=new Set(['api','auth','login','logout','users','operations','policy','rules','alerts','ack','resolve','data','export','rooms','participants','dispatches','inventory','agents','aliases','lk','sip','egress','ingress','recordings','sessions','agent-insights','telemetry','logs','history','token','deployments','targets','secrets','actions','agent-tests','runs','scenarios','results','end','reconnect','compare']);
const routeShape=(route:string)=>route.split('?')[0].split('/').map(part=>!part||known.has(part)||/^(List|Create|Update|Delete|Start|Stop)[A-Za-z]*$/.test(part)?part:':resource').join('/').slice(0,300);
export function beginAudit(input:{actor:string;method:string;route:string;action:string}){
 const id=randomUUID(),route=input.route.split('?')[0];
 db.prepare('INSERT INTO console_audit VALUES(?,?,?,?,?,?,?,NULL)').run(id,Date.now(),input.actor.slice(0,64),input.method,routeShape(route),createHash('sha256').update(route).digest('hex'),input.action);return id;
}
export function finishAudit(id:string,status:number){db.prepare('UPDATE console_audit SET status=? WHERE id=?').run(status,id);}
export function auditRows(limit=200){return db.prepare('SELECT id,at,actor,method,route,resource_hash resourceHash,action,status FROM console_audit ORDER BY at DESC,rowid DESC LIMIT ?').all(Math.min(200,Math.max(1,limit)));}
export function pruneAudit(){
 const days=Number(process.env.AUDIT_RETENTION_DAYS??365);if(!Number.isInteger(days)||days<1||days>3650)throw new Error('AUDIT_RETENTION_DAYS must be 1–3650');
 db.prepare('DELETE FROM console_audit WHERE at<?').run(Date.now()-days*86400000);
}
export const auditRequests:RequestHandler=(req,res,next)=>{
 const path=req.path.toLowerCase(),login=path==='/auth/login',logout=path==='/auth/logout';
 const proceed=()=>{
  const read=['GET','HEAD'].includes(req.method)||req.method==='POST'&&/^\/lk\/[a-z]+\/list[a-z]+\/?$/.test(path);
  const sensitive=/^\/(?:recordings|agent-insights|diagnostics|agent-tests)(?:\/|$)/.test(path)||/^\/deployments\/targets\/[^/]+\/(?:logs|secrets)\/?$/.test(path)||/^\/operations\/export\//.test(path);
  if(read&&!sensitive){next();return;}
  let id:string;
  try{id=beginAudit({actor:login?typeof req.body?.username==='string'?req.body.username.slice(0,64):'anonymous':logout?'anonymous':authOf(req).user,method:req.method,route:req.originalUrl,action:login?'login':logout?'logout':read?'content-access':'mutation'});}
  catch{res.status(503).json({error:'Audit storage unavailable; operation was not started'});return;}
  res.once('finish',()=>{try{finishAudit(id,res.statusCode);}catch{console.error('Audit finalization failed; pending outcome retained');}});next();
 };
 if(login||logout)proceed();else requireAuth(req,res,proceed);
};
