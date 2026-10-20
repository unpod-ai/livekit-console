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
