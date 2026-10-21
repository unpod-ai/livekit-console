import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { authOf, login, logout, requireAuth, requireAdmin, type ContentGrant } from './auth.js';
import { users } from './users.js';
import { auditRows, beginAudit, finishAudit, initializeControl, memberships, projectAccess, pruneAudit, removeMembership, setMembership, type ProjectAccess } from './project-control.js';
import type { Project, ProjectSetup } from './projects.js';

const HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
function cleanHeaders(headers:Record<string,any>, request=false):Record<string,any>{
 const excluded=new Set([...HOP,...String(headers.connection??'').toLowerCase().split(',').map(v=>v.trim())]);
 return Object.fromEntries(Object.entries(headers).filter(([key])=>!excluded.has(key.toLowerCase())&&(!request||!['cookie','authorization','forwarded','host'].includes(key.toLowerCase())&&!key.toLowerCase().startsWith('x-forwarded-')&&!key.toLowerCase().startsWith('x-console-'))&& (request||key.toLowerCase()!=='set-cookie')));
}
function audit(req:Request,res:Response,projectId:string,action:string):boolean{
 let id:string;
 try{id=beginAudit({projectId,actor:(req as any).auth?.user??'anonymous',method:req.method,route:req.originalUrl,action});}
 catch{res.status(503).json({error:'Audit storage unavailable; operation was not started'});return false;}
 res.once('finish',()=>{try{finishAudit(id,res.statusCode);}catch{console.error('audit finalization failed; pending outcome retained');}});
 return true;
}
function proxy(req:Request,res:Response,project:Project,target:string,access?:ProjectAccess):void{
 const headers=cleanHeaders(req.headers,true);
 if(access)headers['x-console-gateway']=jwt.sign({sub:authOf(req).user,role:access.role,capabilities:access.capabilities,globalAdmin:access.globalAdmin},project.secret,{algorithm:'HS256',audience:'console-project:'+project.id,expiresIn:'30s'});
 else if(req.get('authorization'))headers.authorization=req.get('authorization');
 let finished=false;
 const upstream=httpRequest({hostname:'127.0.0.1',port:project.port,path:target,method:req.method,headers,agent:false},response=>{
  upstream.setTimeout(0);const responseHeaders=cleanHeaders(response.headers);responseHeaders['cache-control']='no-store';
  res.writeHead(response.statusCode??502,responseHeaders);response.pipe(res);
  response.on('error',()=>res.destroy());response.on('end',()=>{finished=true;});
 });
 upstream.setTimeout(15000,()=>upstream.destroy(new Error('Project response timeout')));
 upstream.on('error',()=>{if(!res.headersSent)res.status(502).json({error:'Project backend unavailable'});else res.destroy();});
 req.once('aborted',()=>upstream.destroy());res.once('close',()=>{if(!finished)upstream.destroy();});
 req.pipe(upstream);
}
function grantsFor(route:string):ContentGrant[]{
 if(/^\/api\/recordings(?:\/|$)/.test(route))return ['recordings'];
 if(/^\/api\/agent-insights(?:\/|$)/.test(route)){
  if(/\/logs\/?$/.test(route))return ['logs'];
  if(/\/(telemetry|export)\/?$/.test(route))return ['transcripts','logs'];
  return ['transcripts'];
 }
 const category=/^\/api\/operations\/export\/([^/]+)\/?$/.exec(route)?.[1];
 if(category==='reports')return ['transcripts'];if(category==='live')return ['transcripts','logs'];if(category==='logs'||category==='history')return ['logs'];if(category==='recordings')return ['recordings'];
 return [];
}
export function createGatewayApp(setup:ProjectSetup,state:(id:string)=>string){
 const app=express();app.set('trust proxy',1);app.use(cookieParser());
 app.get('/healthz',(_req,res)=>{const ok=state('default')==='ready';res.status(ok?200:503).json({ok});});
 const parser=express.json({limit:'16kb'});
 app.post('/api/auth/login',parser,(req,res)=>{if(audit(req,res,'control','login'))login(req,res);});
 app.post('/api/auth/logout',logout);
 app.get('/api/auth/me',requireAuth,(req,res)=>{
  const auth=authOf(req),access=projectAccess(auth,'default');
  res.json({...auth,globalAdmin:auth.role==='admin',...(access?{role:access.role,capabilities:access.capabilities,projectId:'default'}:{capabilities:{transcripts:false,logs:false,recordings:false}})});
 });
 app.use('/api/users',requireAuth,(req,res,next)=>{if(req.method==='GET'||audit(req,res,'control','user-management'))next();},requireAdmin,parser,users);
 app.get('/api/projects',requireAuth,(req,res)=>res.json(setup.projects.flatMap(project=>{
  const access=projectAccess(authOf(req),project.id);return access?[{id:project.id,name:project.name,...access,backend:{state:state(project.id)}}]:[];
 })));
 const known=(req:Request,res:Response,next:NextFunction)=>{if(!setup.projects.some(p=>p.id===req.params.id)){res.status(404).json({error:'Project not found'});return;}next();};
 app.get('/api/projects/:id/members',requireAuth,requireAdmin,known,(req,res)=>res.json(memberships(req.params.id)));
 const membershipAudit=(req:Request,res:Response,next:NextFunction)=>{if(audit(req,res,req.params.id,'project-membership'))next();};
 app.put('/api/projects/:id/members/:userId',requireAuth,known,membershipAudit,requireAdmin,parser,(req,res)=>{
  try{setMembership(Number(req.params.userId),req.params.id,req.body);res.json({ok:true});}catch{res.status(400).json({error:'Invalid membership or user'});}
 });
 app.delete('/api/projects/:id/members/:userId',requireAuth,known,membershipAudit,requireAdmin,(req,res)=>{
  removeMembership(Number(req.params.userId),req.params.id);res.json({ok:true});
 });
 const forward=(projectId:string,req:Request,res:Response)=>{
  const project=setup.projects.find(p=>p.id===projectId);if(!project){res.status(404).json({error:'Project not found'});return;}
  const target=req.url;let route:string;
  try{route=decodeURIComponent(target.split('?')[0]).toLowerCase();if(route.split('/').includes('..')||route.includes('\\')||/[\x00-\x1f]/.test(route))throw new Error();}
  catch{res.status(400).json({error:'Invalid project path'});return;}
  if(route==='/webhook'||route.startsWith('/api/telemetry/')){
   if(state(projectId)!=='ready'){res.status(503).json({error:'Project backend is not ready'});return;}
   if(req.method!=='POST'){res.status(405).json({error:'POST required'});return;}proxy(req,res,project,target);return;
  }
  if(!route.startsWith('/api/')){res.status(404).json({error:'Unknown project resource'});return;}
  requireAuth(req,res,()=>{
   const read=['GET','HEAD'].includes(req.method)||req.method==='POST'&&/^\/api\/lk\/[a-z]+\/list[a-z]+\/?$/.test(route);
   const grants=grantsFor(route);
   if(!read||grants.length>0||route.startsWith('/api/operations/export/')){if(!audit(req,res,project.id,!read?'mutation':'content-access'))return;}
   const access=projectAccess(authOf(req),project.id);if(!access){res.status(403).json({error:'Project access required'});return;}
   if(grants.some(grant=>!access.capabilities[grant])){res.status(403).json({error:'Content access required: '+grants.join(', ')});return;}
   if(route==='/api/auth/me'&&['GET','HEAD'].includes(req.method)){res.json({...authOf(req),...access,projectId:project.id});return;}
   if(route.startsWith('/api/auth/')||/^\/api\/(users|projects)(\/|$)/.test(route)){res.status(404).json({error:'Use console control API'});return;}
   if(!read&&access.role!=='admin'){res.status(403).json({error:'Your account is read-only'});return;}
   if(route.startsWith('/api/operations')&&access.role!=='admin'){res.status(403).json({error:'Project admin access required'});return;}
   if(route==='/api/operations/audit'&&req.method==='GET'){
    const rows=[...auditRows(project.id),...(access.globalAdmin?auditRows('control'):[])].sort((a,b)=>Number(b.at)-Number(a.at)).slice(0,200);
    res.json({rows});return;
   }
   if(state(projectId)!=='ready'){res.status(503).json({error:'Project backend is not ready'});return;}
   proxy(req,res,project,target,access);
  });
 };
 app.use('/p/:projectId',(req,res)=>forward(req.params.projectId,req,res));
 // Legacy paths always address default, independent of browser project selection.
 app.use((req,res,next)=>{if(req.path==='/webhook'||req.path.startsWith('/api/'))forward('default',req,res);else next();});
 const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../web/dist');
 if(existsSync(web)){app.use(express.static(web));app.get('*',(_req,res)=>res.sendFile(path.join(web,'index.html')));}
 app.use((_req,res)=>res.status(404).json({error:'Not found'}));
 return app;
}

type Runtime={process:ChildProcess|null;state:string;attempts:number;timer?:NodeJS.Timeout};
export async function startGateway(setup:ProjectSetup){
 initializeControl(setup.projects.find(p=>p.id==='default')!.dbPath);pruneAudit();
 const runtimes=new Map<string,Runtime>();let stopping=false;
 const launch=(project:Project)=>{
  const runtime=runtimes.get(project.id)??{process:null,state:'starting',attempts:0};runtimes.set(project.id,runtime);
  runtime.state='starting';
  const entry=fileURLToPath(new URL('./index'+(import.meta.url.endsWith('.ts')?'.ts':'.js'),import.meta.url));
  const child=spawn(process.execPath,[...process.execArgv.filter(arg=>!arg.startsWith('--env-file')),entry],{env:project.env,stdio:['ignore','ignore','pipe']});runtime.process=child;
  // Do not relay child diagnostics: configuration/provider errors can include private identifiers.
  child.stderr?.resume();
  child.once('error',()=>{runtime.state='failed';});
  child.once('exit',()=>{
   runtime.process=null;runtime.state='failed';
   if(!stopping&&runtime.attempts++<5)runtime.timer=setTimeout(()=>launch(project),Math.min(30000,1000*2**runtime.attempts));
  });
 };
 for(const project of setup.projects)launch(project);
 const check=setInterval(()=>{for(const project of setup.projects){const runtime=runtimes.get(project.id)!;if(!runtime.process)continue;const child=runtime.process;
  void fetch('http://127.0.0.1:'+project.port+'/healthz',{signal:AbortSignal.timeout(2000),redirect:'error'}).then(async r=>{
   const health=await r.json();if(runtime.process===child)runtime.state=r.ok&&health.projectId===project.id&&health.instance===createHash('sha256').update(project.secret).digest('hex')?'ready':'starting';
  }).catch(()=>{if(runtime.process===child&&runtime.state==='ready')runtime.state='starting';});
 }},1000);check.unref();
 const pruning=setInterval(()=>{try{pruneAudit();}catch{console.error('audit retention failed');}},3600000);pruning.unref();
 const app=createGatewayApp(setup,id=>runtimes.get(id)?.state??'failed');
 const server=app.listen(setup.port,setup.host);
 const close=async()=>{
  if(stopping)return;stopping=true;clearInterval(check);clearInterval(pruning);
  for(const runtime of runtimes.values()){clearTimeout(runtime.timer);runtime.process?.kill('SIGTERM');}
  await new Promise<void>(resolve=>server.close(()=>resolve()));
 };
 for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void close().then(()=>process.exit(0));});
 return {server,close,runtimes};
}
