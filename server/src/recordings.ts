import { Router } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getPolicy } from './operations-policy.js';
import { config } from './config.js';
import { db } from './db.js';
import { requireContent, requireAuth } from './auth.js';
import { resolveRecording, validateRange, type EgressRow } from './recording-source.js';

export function recordingRouter(storage = config.recordingStorage, suppliedClient?: S3Client) {
  const client = suppliedClient ?? new S3Client({
  region: config.recordingRegion, endpoint: config.recordingEndpoint, forcePathStyle: config.recordingPathStyle,
  credentials: config.recordingCredentials ?? (config.recordingAllowDefaultCredentials ? undefined : async () => { throw new Error('Recording credentials are not configured'); }),
  maxAttempts: 2, requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 },
});
  const router=Router();
  router.use(requireAuth,requireContent('recordings'),(_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});next();});
  router.use((_req,res,next)=>{if(!getPolicy().categories.recordings.accessEnabled){res.status(403).json({error:'Recording access is disabled by console policy'});return;}next();});
  router.get('/sessions/:sid',(req,res)=>{
    const rows=db.prepare('SELECT egress_id,started_at,ended_at,info FROM egress WHERE room_sid=? ORDER BY started_at DESC LIMIT 100').all(req.params.sid) as EgressRow[];
    const files=rows.flatMap(row=>{const n=JSON.parse(row.info).fileResults?.length??0;return Array.from({length:Math.min(n,20)},(_,index)=>{const {key,...file}=resolveRecording(row,index,storage);return file;});});
    res.json({files,agentRecording:'not_collected',accessDays:storage.retentionDays});
  });
  router.route('/:id/:index/stream').all(async(req,res)=>{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.sendStatus(405);return;}
    if(!/^EG_[A-Za-z0-9_-]{1,150}$/.test(req.params.id)||!/^\d{1,2}$/.test(req.params.index)){res.status(404).json({error:'Recording not found'});return;}
    const row=db.prepare('SELECT egress_id,started_at,ended_at,info FROM egress WHERE egress_id=?').get(req.params.id) as EgressRow|undefined;
    if(!row){res.status(404).json({error:'Recording not found'});return;}
    const file=resolveRecording(row,Number(req.params.index),storage);
    if(file.state!=='ready'||!file.key){res.status(file.state==='expired'?410:file.state==='missing'?404:503).json({error:`Recording ${file.state}`});return;}
    if(!suppliedClient&&!config.recordingCredentials&&!config.recordingAllowDefaultCredentials){res.status(503).json({error:'Recording storage credentials are not configured'});return;}
    let range:string|undefined;
    try{range=validateRange(req.headers.range);}catch{res.status(416).json({error:'Use a single valid byte range'});return;}
    const controller=new AbortController();let body:Readable|undefined;
    const cancel=()=>{controller.abort();body?.destroy();};res.once('close',cancel);
    try {
      const input={Bucket:storage.bucket,Key:file.key,...(range?{Range:range}:{})};
      const output=await client.send(req.method==='HEAD'?new HeadObjectCommand(input):new GetObjectCommand(input),{abortSignal:controller.signal});
      res.status(range&&output.ContentRange?206:200).set({'Content-Type':file.mime!,'Accept-Ranges':'bytes','Content-Disposition':`inline; filename="${encodeURIComponent(file.name)}"`});
      if(output.ContentLength!=null)res.set('Content-Length',String(output.ContentLength));
      if(output.ContentRange)res.set('Content-Range',output.ContentRange);
      if(req.method==='HEAD'){res.end();return;}
      body=(output as {Body?:Readable}).Body;
      if(!(body instanceof Readable))throw new Error('Storage returned no stream');
      await pipeline(body,res);
    } catch(error:any){
      if(res.destroyed||res.headersSent)return;
      const code=error?.$metadata?.httpStatusCode;
      const status=code===404?404:code===416?416:code===403?502:503;
      res.removeHeader('Content-Length');res.removeHeader('Content-Range');
      res.type('json').status(status).json({error:status===404?'Recording file is missing':status===416?'Requested recording range is unavailable':code===403?'Storage denied recording access':'Recording storage is temporarily unavailable'});
    } finally{res.removeListener('close',cancel);body?.destroy();}
  });
  return router;
}
