import express,{Router} from 'express';
import {createHash} from 'node:crypto';
import {db} from './db.js';
import {config} from './config.js';
import {requireTelemetry} from './telemetry-auth.js';
import {requireAdmin,requireAuth} from './auth.js';
import {normalizeDiagnostic} from './diagnostic-records.js';
import {redactContent} from './telemetry-privacy.js';
export const diagnosticIngest=Router(),diagnosticReads=Router();
export const DIAGNOSTIC_EXPIRY_SQL='UPDATE diagnostic_records SET content=NULL,room_sid=NULL,participant_sid=NULL,track_sid=NULL,call_id=NULL,sip_call_id=NULL,provider_call_id=NULL,instance_id=NULL WHERE expires_at<=? AND content IS NOT NULL';
const expireDiagnostics=db.prepare(DIAGNOSTIC_EXPIRY_SQL);
export function purgeDiagnostics(){expireDiagnostics.run(Date.now());}
// Keep retry tombstones independent of content retention; a replay cannot restore expired records.
diagnosticIngest.post('/',requireTelemetry,express.json({limit:'256kb'}),(req,res)=>{
 if(!config.diagnosticsEnabled){res.status(503).json({error:'Diagnostics collection is disabled'});return;}
 let records:Record<string,any>[];
 try{
  if(req.body?.schemaVersion!==1||!Array.isArray(req.body.records)||!req.body.records.length||req.body.records.length>100)throw new Error('Expected version-1 envelope with 1–100 records');
  records=req.body.records.map((v:any)=>{
   const r=normalizeDiagnostic(v);
   // Diagnostic free text always uses at least standard redaction, independent of agent transcript settings.
   const safe=redactContent({message:r.message,text:r.reason},config.telemetryRedaction==='strict'?'strict':'standard',config.telemetryRedactTerms);
   const diagnosticText=(text:string|undefined)=>text&&(/(?:\bsips?:|SIP\/2\.0|\b(?:Via|Contact|CSeq|Call-ID|Record-Route)\s*:|\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]*)/i.test(text))?'[DIAGNOSTIC TEXT REDACTED]':text;
   if(r.message!==undefined)r.message=diagnosticText(safe.message);if(r.reason!==undefined)r.reason=diagnosticText(safe.text);return r;
  });
 }catch(e){res.status(400).json({error:e instanceof Error?e.message:'Invalid diagnostics'});return;}
 purgeDiagnostics();db.exec('BEGIN');let inserted=0;
 try{
  for(const r of records){
   const content=JSON.stringify(r),digest=createHash('sha256').update(content).digest('hex');
   const prior=db.prepare('SELECT digest FROM diagnostic_records WHERE id=?').get(r.id);
   if(prior){if(prior.digest!==digest)throw new Error('Conflicting diagnostic record ID');continue;}
   const expires=r.at+config.diagnosticsRetentionDays*86400000;
   db.prepare(`INSERT INTO diagnostic_records(id,kind,at,received_at,expires_at,room_sid,participant_sid,track_sid,call_id,sip_call_id,provider_call_id,instance_id,digest,content) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id,r.kind,r.at,Date.now(),expires,expires>Date.now()?r.roomSid??null:null,expires>Date.now()?r.participantSid??null:null,expires>Date.now()?r.trackSid??null:null,expires>Date.now()?r.callId??null:null,expires>Date.now()?r.sipCallId??null:null,expires>Date.now()?r.providerCallId??null:null,expires>Date.now()?r.instanceId??null:null,digest,expires>Date.now()?content:null);inserted++;
  }
  db.exec('COMMIT');res.json({inserted,duplicates:records.length-inserted});
 }catch{db.exec('ROLLBACK');res.status(409).json({error:'Conflicting diagnostic record ID'});}
});
diagnosticIngest.use((err:any,_req:any,res:any,_next:any)=>{res.status(err.type==='entity.too.large'?413:400).json({error:'Invalid diagnostic upload'});});
diagnosticReads.use(requireAuth,requireAdmin,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const callMatch=`(json_extract(p.attributes,'$."sip.callID"') IN (d.call_id,d.sip_call_id,d.provider_call_id) OR json_extract(p.attributes,'$."sip.callIDFull"') IN (d.call_id,d.sip_call_id,d.provider_call_id))`;
for(const [route,kind] of [['quality','quality'],['sip','sip'],['services','service']] as const){
 diagnosticReads.get('/'+route,(req,res)=>{
  try{
   function number(name:string,fallback:number,min:number,max:number){const v=req.query[name];if(v===undefined)return fallback;if(typeof v!=='string'||!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<min||Number(v)>max)throw new Error(`Invalid ${name}`);return Number(v);}
   function text(name:string){const v=req.query[name];if(v===undefined)return '';if(typeof v!=='string'||v.length>256||/[\x00-\x1f]/.test(v))throw new Error(`Invalid ${name}`);return v;}
   const now=Date.now(),from=number('from',now-30*86400000,0,now),to=number('to',now,1,now+60000),limit=number('limit',200,1,1000),offset=number('offset',0,0,1000000);
   if(to<=from||to-from>90*86400000)throw new Error('Choose a range of up to 90 days');
   const room=text('roomSid'),participant=text('participantSid'),track=text('trackSid'),call=text('callId'),q=text('q'),reporter=text('reporterId'),direction=text('direction'),stats=text('statsId');
   const where=['d.kind=?','d.at>=?','d.at<?','d.expires_at>?','d.content IS NOT NULL'],args:any[]=[kind,from,to,now];
   if(kind==='quality'){
    if(!room.startsWith('RM_'))throw new Error('A room SID is required');
    where.push('d.room_sid=?');args.push(room);
    for(const [col,value] of [['participant_sid',participant],['track_sid',track]] as const)if(value){where.push(`d.${col}=?`);args.push(value);}
    for(const [field,value] of [['reporterId',reporter],['direction',direction],['statsId',stats]] as const)if(value){where.push(`json_extract(d.content,'$.${field}')=?`);args.push(value);}
   }
   if(kind==='sip'){
    if(call){where.push('(d.call_id=? OR d.sip_call_id=? OR d.provider_call_id=?)');args.push(call,call,call);}
    if(room||participant){const scope:string[]=[],params:string[]=[];if(room){scope.push('p.room_sid=?');params.push(room);}if(participant){scope.push('p.sid=?');params.push(participant);}
     const native:string[]=[],nativeArgs:string[]=[];if(room){native.push('d.room_sid=?');nativeArgs.push(room);}if(participant){native.push('d.participant_sid=?');nativeArgs.push(participant);}
     where.push(`((${native.join(' AND ')}) OR EXISTS(SELECT 1 FROM participants p WHERE p.kind IN ('3','SIP') AND json_valid(p.attributes) AND ${scope.join(' AND ')} AND (d.room_sid IS NULL OR d.room_sid=p.room_sid) AND (d.participant_sid IS NULL OR d.participant_sid=p.sid) AND ${callMatch} AND (SELECT COUNT(*) FROM participants p WHERE p.kind IN ('3','SIP') AND json_valid(p.attributes) AND ${callMatch})=1))`);args.push(...nativeArgs,...params);
    }
    if(q){where.push('(d.call_id LIKE ? ESCAPE \'\\\' OR d.sip_call_id LIKE ? ESCAPE \'\\\' OR json_extract(d.content,\'$.reason\') LIKE ? ESCAPE \'\\\')');const search='%'+q.replace(/[\\%_]/g,'\\$&')+'%';args.push(search,search,search);}
   }
   const clause=where.join(' AND '),total=Number(db.prepare(`SELECT COUNT(*) n FROM diagnostic_records d WHERE ${clause}`).get(...args)!.n);
   const rows=db.prepare(`SELECT content,received_at FROM diagnostic_records d WHERE ${clause} ORDER BY d.at DESC,d.id LIMIT ? OFFSET ?`).all(...args,limit,offset).map(row=>({...JSON.parse(row.content as string),receivedAt:row.received_at}));
   if(kind==='sip')for(const row of rows){
    const matches=db.prepare(`SELECT p.room_sid,p.sid FROM participants p WHERE p.kind IN ('3','SIP') AND json_valid(p.attributes) AND (json_extract(p.attributes,'$."sip.callID"') IN (?,?,?) OR json_extract(p.attributes,'$."sip.callIDFull"') IN (?,?,?)) LIMIT 2`).all(row.callId??null,row.sipCallId??null,row.providerCallId??null,row.callId??null,row.sipCallId??null,row.providerCallId??null);
    if(matches.length===1&&(!row.roomSid||row.roomSid===matches[0].room_sid)&&(!row.participantSid||row.participantSid===matches[0].sid)){row.linkedRoomSid=matches[0].room_sid;row.linkedParticipantSid=matches[0].sid;}
   }
   const lifecycle=kind==='quality'?db.prepare(`SELECT id,ts,type,identity,json_extract(payload,'$.participant.sid') participantSid,json_extract(payload,'$.participant.disconnectReason') reason FROM events WHERE room_sid=? AND ts>=? AND ts<? ORDER BY ts LIMIT 500`).all(room,from,to):[];
   res.json({rows,total,limit,offset,from,to,lifecycle,collectionEnabled:config.diagnosticsEnabled,retentionDays:config.diagnosticsRetentionDays});
  }catch(e){res.status(400).json({error:e instanceof Error?e.message:'Invalid diagnostics query'});}
 });
}
