import { Router } from 'express';
import { requireAdmin, requireAuth, requireContent } from './auth.js';
import { config } from './config.js';

type Target = { id:string;agentName:string;image?:string;imageId?:string;version?:string;observedAt?:number|string;[key:string]:unknown };
export const deployments=Router();deployments.use(requireAuth,requireAdmin,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const id=(value:string)=>/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const configured=()=>!!config.deploymentHelperUrl&&!!config.deploymentHelperToken;
class HelperError extends Error {constructor(public status:number,message:string){super(message);}}
async function helper(resource:string,method='GET',body?:unknown):Promise<any>{
 if(!configured())throw new HelperError(503,'Deployment integration is not configured');
 const response=await fetch(config.deploymentHelperUrl+resource,{method,headers:{authorization:'Bearer '+config.deploymentHelperToken,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'}).catch(()=>{throw new HelperError(502,'Deployment helper is unavailable');});
 const reader=response.body?.getReader();if(!reader)throw new HelperError(502,'Deployment helper returned no response');
 const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const{value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>512*1024)throw new HelperError(502,'Deployment helper response exceeded limit');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 if(!response.ok)throw new HelperError([400,403,404,409,422,503].includes(response.status)?response.status:502,response.status===409?'Deployment action conflicts with current target state':response.status===403?'This target is read-only or access was denied':response.status===404?'Deployment target not found':'Deployment helper rejected the request');
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HelperError(502,'Deployment helper returned invalid JSON');}
}
export async function deploymentTargetSnapshot(targetId:string){
 if(!id(targetId))throw new HelperError(400,'Invalid deployment target');
 const data=await helper('/targets');const target=(data.targets as Target[]).find(t=>t.id===targetId);if(!target)throw new HelperError(404,'Deployment target not found');
 const observedAt=typeof target.observedAt==='number'?target.observedAt:typeof target.observedAt==='string'?Date.parse(target.observedAt):NaN;
 return {id:target.id,agentName:target.agentName,image:typeof target.image==='string'?target.image:null,imageId:typeof target.imageId==='string'?target.imageId:null,version:typeof target.version==='string'?target.version:null,observedAt:Number.isFinite(observedAt)?observedAt:null};
}
const wrap=(fn:(req:any)=>Promise<any>)=>async(req:any,res:any)=>{try{res.json(await fn(req));}catch(error){res.status(error instanceof HelperError?error.status:502).json({error:error instanceof HelperError?error.message:'Deployment helper request failed'});}};
deployments.get('/targets',wrap(async()=>configured()?{...await helper('/targets'),configured:true}:{configured:false,targets:[],operations:[]}));
deployments.use('/targets/:id',(req,res,next)=>{if(!id(req.params.id)){res.status(400).json({error:'Invalid deployment target'});return;}next();});
deployments.get('/targets/:id/logs',requireContent('logs'),wrap(async req=>{
 const kind=req.query.kind??'runtime',lines=req.query.lines===undefined?100:Number(req.query.lines);
 if(!['runtime','build'].includes(kind)||!Number.isInteger(lines)||lines<1||lines>500)throw new HelperError(400,'Invalid log query');
 return helper('/targets/'+req.params.id+'/logs?'+new URLSearchParams({kind,lines:String(lines)}));
}));
deployments.get('/targets/:id/secrets',wrap(req=>helper('/targets/'+req.params.id+'/secrets')));
deployments.put('/targets/:id/secrets',wrap(req=>{
 const b=req.body;if(!b||b.confirm!==req.params.id||!b.values||typeof b.values!=='object'||Array.isArray(b.values)||Object.keys(b).some(k=>!['values','confirm'].includes(k))||Object.keys(b.values).length>100||Object.entries(b.values).some(([key,value])=>!/^[A-Z][A-Z0-9_]{0,99}$/.test(key)||typeof value!=='string'||value.length>8192||/[\x00\r\n]/.test(value)))throw new HelperError(400,'Invalid secret update confirmation or values');
 return helper('/targets/'+req.params.id+'/secrets','PUT',b);
}));
deployments.post('/targets/:id/actions',wrap(req=>{
 const b=req.body;if(!b||b.confirm!==req.params.id||!['build','deploy','drain','rollback','reconcile'].includes(b.action)||typeof b.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(b.requestId)||Object.keys(b).some(k=>!['action','image','confirm','requestId'].includes(k))||b.image!==undefined&&(typeof b.image!=='string'||b.image.length>300||/[\x00-\x20]/.test(b.image)))throw new HelperError(400,'Invalid deployment action or confirmation');
 return helper('/targets/'+req.params.id+'/actions','POST',b);
}));
