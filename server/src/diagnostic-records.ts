// Only measured, explicitly scoped fields enter the diagnostics store. Never persist raw service logs.
export const QUALITY_METRICS=['bitrateBps','packetsLost','packetsReceived','packetLossPct','jitterMs','rttMs','fps','reconnects'];
export const SERVICE_METRICS=['cpuPct','memoryBytes','pids','livekit_room_total','livekit_participant_total','livekit_track_published_total','livekit_track_subscribed_total','livekit_packet_bytes','livekit_packet_total','livekit_sip_calls_active','livekit_sip_cpu_load','livekit_sip_node_available','livekit_egress_available','livekit_egress_active'];
const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
export function normalizeDiagnostic(v:any):Record<string,any>{
 if(!object(v)||!['quality','service','sip'].includes(v.kind))throw new Error('Invalid diagnostic kind');
 const out:Record<string,any>={kind:v.kind};
 function text(key:string,required=false,max=256){const value=v[key];if(value==null&&!required)return;if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))throw new Error(`Invalid ${key}`);out[key]=value;}
 function choice(key:string,values:string[],required=true){if(v[key]==null&&!required)return;if(!values.includes(v[key]))throw new Error(`Invalid ${key}`);out[key]=v[key];}
 text('id',true,200);
 if(!Number.isSafeInteger(v.at)||v.at<=0||v.at>Date.now()+60000)throw new Error('Invalid diagnostic timestamp');out.at=v.at;
 if(v.kind==='quality'){
  for(const [k,p] of [['roomSid','RM_'],['participantSid','PA_']] as const){text(k,true,100);if(!out[k].startsWith(p))throw new Error(`Invalid ${k}`);}
  text('trackSid',false,100);if(out.trackSid&&!out.trackSid.startsWith('TR_'))throw new Error('Invalid trackSid');
  text('statsId',false,256);text('reporterId',true,150);choice('direction',['inbound','outbound','connection']);if(out.direction!=='connection'&&!out.trackSid)throw new Error('Track samples require trackSid');choice('event',['sample','reconnecting','reconnected','disconnected'],false);choice('quality',['excellent','good','poor','lost','unknown'],false);text('reason',false,500);
 }else{
  choice('service',v.kind==='sip'?['sip']:['server','sip','egress']);text('instanceId',true,150);
  if(v.kind==='service')choice('state',['running','stopped','unhealthy','unknown']);
  else{
   text('callId',true);for(const key of ['sipCallId','providerCallId','roomSid','roomName','participantSid','participantIdentity','trunkId','ruleId','stage'])text(key);
   choice('direction',['inbound','outbound'],false);text('reason',false,500);text('message',false,500);
   if(v.code!=null){if(!Number.isInteger(v.code)||v.code<100||v.code>699)throw new Error('Invalid SIP response code');out.code=v.code;}
  }
 }
 if(v.kind!=='sip'){
  if(!object(v.metrics))throw new Error('Invalid diagnostic metrics');out.metrics={};
  for(const key of v.kind==='quality'?QUALITY_METRICS:SERVICE_METRICS){const n=v.metrics[key];if(n==null)continue;if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER||(key==='packetLossPct'&&n>100))throw new Error(`Invalid measurement ${key}`);out.metrics[key]=n;}
 }
 return out;
}
