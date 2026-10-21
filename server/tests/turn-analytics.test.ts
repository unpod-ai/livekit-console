import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalMeasurements, summarizeMeasurements, percentile } from '../src/turn-analytics.js';
const row={roomSid:'RM_test',jobId:'AJ_test',agentName:'one',itemId:'message1',role:'assistant',at:1000,expiresAt:10000,receivedAt:1,metrics:{e2e_latency:.2,llm_node_ttft:0}};
test('final reports supersede live updates per native message and metric without losing zero measurements',()=>{
 const rows=canonicalMeasurements([{...row,kind:'message',messageId:'message1'}, {...row,kind:'message',itemId:'update',messageId:'message1',receivedAt:2,metrics:{e2e_latency:.3}}, {...row,kind:'report',metrics:{e2e_latency:.4}}, {...row,kind:'report',itemId:'expired',expiresAt:1}],5000);
 assert.equal(rows.filter(r=>r.metric==='e2e_latency').length,1);assert.equal(rows.find(r=>r.metric==='e2e_latency')!.valueMs,400);assert.equal(rows.find(r=>r.metric==='llm_node_ttft')!.valueMs,0);
});
test('nearest-rank percentiles and exact half-open buckets share the same contributing samples',()=>{
 assert.equal(percentile([10,20,30,40],.5),20);assert.equal(percentile([10,20,30,40],.95),40);assert.equal(percentile([], .5),null);
 const rows=canonicalMeasurements([1,2,3,4].map((n)=>({...row,kind:'report',itemId:'m'+n,at:n*1000,metrics:{e2e_latency:n/10}})),5000);
 const result=summarizeMeasurements(rows,{from:1000,to:4000,metric:'e2e_latency',agents:['one'],bucketMs:1000});
 assert.equal(result.samples.length,3);assert.equal(result.groups[0].p50,200);assert.equal(result.groups[0].p95,300);assert.equal(result.series[0].count,1);
});
test('stage durations use measured native node spans without counting nested provider spans',()=>{
 const rows=canonicalMeasurements([{...row,kind:'span',itemId:'span1',spanName:'llm_node',end:1300,traceId:'a'.repeat(32),spanId:'b'.repeat(16)}, {...row,kind:'span',itemId:'span2',spanName:'llm_request',end:1200}],5000);
 assert.equal(rows.filter(r=>r.metric==='llm_duration').length,1);assert.equal(rows.find(r=>r.metric==='llm_duration')!.valueMs,300);
});

test('live contributor keeps its record ID separately from the canonical message ID',()=>{
 const [sample]=canonicalMeasurements([{...row,kind:'message',itemId:'live-record-2',messageId:'canonical-message',metrics:{e2e_latency:.25}}],5000);
 assert.equal(sample.itemId,'canonical-message');assert.equal(sample.recordId,'live-record-2');assert.equal(sample.source,'live_message');
});

test('turn-completed callback timing keeps its own population and is not a native node measurement',()=>{
 const rows=canonicalMeasurements([{...row,kind:'report',metrics:{on_user_turn_completed_delay:.075}}, {...row,kind:'span',itemId:'callback-span',spanName:'llm_node',end:1100,metrics:{on_user_turn_completed_delay:.075}}],5000);
 assert.equal(rows.filter(r=>r.metric==='on_user_turn_completed_delay').length,1);
 assert.equal(rows.find(r=>r.metric==='on_user_turn_completed_delay')!.valueMs,75);
});

test('user speech timings contribute without treating user messages as LLM or response samples',()=>{
 const rows=canonicalMeasurements([{...row,kind:'report',role:'user',metrics:{e2e_latency:99,llm_node_ttft:99,transcription_delay:.592,end_of_turn_delay:1.09,on_user_turn_completed_delay:0}}, {...row,kind:'report',itemId:'assistant2',metrics:{e2e_latency:.4}}],5000);
 assert.deepEqual(rows.filter(r=>r.itemId==='message1').map(r=>r.metric).sort(),['end_of_turn_delay','on_user_turn_completed_delay','transcription_delay']);
 assert.equal(rows.find(r=>r.metric==='transcription_delay')!.valueMs,592);
 assert.equal(rows.filter(r=>r.metric==='e2e_latency').length,1);
});
