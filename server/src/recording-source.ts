import path from 'node:path';
export type Storage = { bucket: string; prefix: string; retentionDays: number };
export type EgressRow = { egress_id: string; started_at: number | null; ended_at: number | null; info: string };
const MIME: Record<string,string> = { '.ogg':'audio/ogg','.opus':'audio/ogg','.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4','.m4a':'audio/mp4','.webm':'video/webm' };
const ns = (v: unknown): number | null => { const n=Number(v);return v!=null&&v!==''&&Number.isFinite(n)&&n>0?Math.round(n/1e6):null; };
export function resolveRecording(row: EgressRow, index: number, storage: Storage) {
  const info=JSON.parse(row.info), file=info.fileResults?.[index];
  const req=info.roomComposite??info.participant??info.trackComposite??info.track??info.web??{};
  const outputs=req.fileOutputs??(req.file?[req.file]:[]);
  const name:string=typeof file?.filename==='string'?file.filename:'';
  const mime=MIME[path.extname(name).toLowerCase()]??null;
  const base={id:`${row.egress_id}/${index}`,egressId:row.egress_id,index,name:path.posix.basename(name),source:'egress',mime,
    startMs:ns(file?.startedAt),durationMs:ns(file?.duration),size:Number.isSafeInteger(Number(file?.size))&&Number(file?.size)>=0?Number(file.size):null};
  const invalidKey=!name||name.startsWith('/')||/[\\\x00-\x1f?#%]/.test(name)||name.includes('://')||name.split('/').some(p=>!p||p==='.'||p==='..');
  let state='ready';
  if(!file)state='missing';
  else if(!storage.bucket||(!outputs.length||!outputs.every((o: any)=>o.s3?.bucket===storage.bucket))||!name.startsWith(storage.prefix))state='unconfigured';
  else if(invalidKey||!mime)state='unsupported';
  else if((row.ended_at??row.started_at??Date.now())+storage.retentionDays*86400000<=Date.now())state='expired';
  return {...base,state,key:state==='ready'?name:null};
}
export function validateRange(value: string | undefined): string | undefined {
  if(value===undefined)return;
  const m=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!m||(!m[1]&&!m[2]))throw new Error('Invalid byte range');
  const start=m[1]?Number(m[1]):null,end=m[2]?Number(m[2]):null;
  if((start!==null&&!Number.isSafeInteger(start))||(end!==null&&!Number.isSafeInteger(end))||(start!==null&&end!==null&&end<start)||(start===null&&end===0))throw new Error('Invalid byte range');
  return value;
}
