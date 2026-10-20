export const METRICS = {
  e2e_latency:'Response latency',llm_node_ttft:'LLM first token',tts_node_ttfb:'TTS first audio',
  transcription_delay:'Transcription delay',end_of_turn_delay:'End-of-turn delay',
  stt_duration:'STT node duration',llm_duration:'LLM node duration',tts_duration:'TTS node duration',tool_duration:'Tool duration',
} as const;
export type Metric=keyof typeof METRICS;
export class MeasurementLimitError extends Error {}
export type Input={kind:string;roomSid:string;jobId:string;agentName:string;itemId:string;messageId?:string|null;role?:string;at:number;end?:number|null;expiresAt:number;receivedAt:number;metrics:Record<string,number>;spanName?:string;traceId?:string|null;spanId?:string|null;turnId?:string|null;interrupted?:boolean;isError?:boolean};
export type Sample={id:string;roomSid:string;jobId:string;agentName:string;itemId:string;at:number;metric:Metric;valueMs:number;source:string;traceId:string|null;spanId:string|null;turnId:string|null;interrupted:boolean;isError:boolean};
export function canonicalMeasurements(inputs:Iterable<Input>,now:number):Sample[]{
  const chosen=new Map<string,{row:Sample;priority:number;receivedAt:number}>();
  for(const input of inputs){
    if(input.expiresAt<=now||!Number.isFinite(input.at))continue;
    if(input.kind!=='span'&&input.role!=='assistant')continue;
    const nativeId=input.kind==='span'?`span:${input.itemId}`:`message:${input.messageId??input.itemId}`;
    const fields={...input.metrics};
    if(input.kind==='span'){
      const metric=({stt_node:'stt_duration',llm_node:'llm_duration',tts_node:'tts_duration',function_tool:'tool_duration'} as Record<string,string>)[input.spanName??''];
      if(metric&&input.end!=null&&input.end>=input.at)fields[metric]=(input.end-input.at)/1000;
      // Node span timing and message timing are different populations; avoid a second response-latency sample.
      for(const k of ['e2e_latency','llm_node_ttft','tts_node_ttfb','transcription_delay','end_of_turn_delay'])delete fields[k];
    }
    for(const [key,value]of Object.entries(fields)){
      if(!Object.hasOwn(METRICS,key)||!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER/1000)continue;
      const metric=key as Metric,id=JSON.stringify([input.roomSid,input.jobId,nativeId,metric]);
      const row:Sample={id,roomSid:input.roomSid,jobId:input.jobId,agentName:input.agentName,itemId:input.messageId??input.itemId,at:input.at,metric,valueMs:value*1000,source:input.kind==='report'?'final_report':input.kind==='span'?'native_span':'live_message',traceId:input.traceId??null,spanId:input.spanId??null,turnId:input.turnId??null,interrupted:!!input.interrupted,isError:!!input.isError};
      const previous=chosen.get(id),priority=input.kind==='report'?2:1;
      if(!previous||priority>previous.priority||(priority===previous.priority&&input.receivedAt>=previous.receivedAt))chosen.set(id,{row:{...row,traceId:row.traceId??previous?.row.traceId??null,spanId:row.spanId??previous?.row.spanId??null,turnId:row.turnId??previous?.row.turnId??null},priority,receivedAt:input.receivedAt});
      else if(previous){previous.row.traceId??=row.traceId;previous.row.spanId??=row.spanId;previous.row.turnId??=row.turnId;}
      if(chosen.size>200000)throw new MeasurementLimitError('Investigation exceeds 200,000 measurements; narrow the range or selected agents');
    }
  }
  return [...chosen.values()].map(v=>v.row);
}
export function percentile(sorted:number[],p:number):number|null{return sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;}
const distribution=(rows:Sample[])=>{const values=rows.map(s=>s.valueMs).sort((a,b)=>a-b);return {count:values.length,p50:percentile(values,.5),p90:percentile(values,.9),p95:percentile(values,.95),p99:percentile(values,.99)};};
export function summarizeMeasurements(rows:Sample[],options:{from:number;to:number;metric:Metric;agents:string[];bucketMs:number}){
 const samples=rows.filter(r=>r.at>=options.from&&r.at<options.to&&r.metric===options.metric&&(!options.agents.length||options.agents.includes(r.agentName)));
 const byAgent=new Map<string,Sample[]>();
 for(const sample of samples){if(!byAgent.has(sample.agentName))byAgent.set(sample.agentName,[]);byAgent.get(sample.agentName)!.push(sample);}
 const groups=[...byAgent.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([agentName,rows])=>({agentName,...distribution(rows)}));
 const buckets=new Map<string,{agentName:string;t:number;rows:Sample[]}>();
 for(const sample of samples){const t=Math.floor(sample.at/options.bucketMs)*options.bucketMs,key=JSON.stringify([sample.agentName,t]);if(!buckets.has(key))buckets.set(key,{agentName:sample.agentName,t,rows:[]});buckets.get(key)!.rows.push(sample);}
 const series=[...buckets.values()].sort((a,b)=>a.t-b.t||a.agentName.localeCompare(b.agentName)).map(b=>({agentName:b.agentName,t:b.t,...distribution(b.rows)}));
 return {groups,series,samples:samples.sort((a,b)=>b.valueMs-a.valueMs||b.at-a.at||a.id.localeCompare(b.id))};
}
