import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDiagnostic} from '../src/diagnostic-records.js';
const at=Date.now();
const quality={id:'quality-1',at,kind:'quality',roomSid:'RM_one',participantSid:'PA_one',trackSid:'TR_one',reporterId:'rtc-one',direction:'inbound',metrics:{packetLossPct:12,jitterMs:40,rttMs:100,bitrateBps:0,fps:0,secret:99}};
test('quality keeps measured zero values, exact scope and units while removing unknown fields',()=>{
 const value=normalizeDiagnostic({...quality,headers:{authorization:'secret'}});
 assert.equal(value.trackSid,'TR_one');assert.equal(value.metrics.bitrateBps,0);assert.equal(value.metrics.fps,0);assert.equal(value.metrics.secret,undefined);assert.equal(value.headers,undefined);
});
test('quality rejects unscoped tracks, invalid values and excessive future timestamps',()=>{
 for(const change of [{trackSid:null},{participantSid:''},{roomSid:'name-only'},{direction:'both'},{metrics:{jitterMs:-1}},{metrics:{packetLossPct:101}},{at:at+120000},{metrics:{rttMs:Infinity}}])assert.throws(()=>normalizeDiagnostic({...quality,...change}));
});
test('SIP failures without rooms retain durable call references, confirmed direction and safe projections',()=>{
 const value=normalizeDiagnostic({id:'sip-1',at,kind:'sip',service:'sip',instanceId:'sip-one',callId:'SC_one',sipCallId:'provider@example',direction:'inbound',stage:'dispatch',code:404,reason:'no matching rule',headers:{authorization:'secret'},fromIP:'private',message:'failed to dispatch'});
 assert.equal(value.roomSid,undefined);assert.equal(value.code,404);assert.equal(value.direction,'inbound');assert.equal(value.headers,undefined);assert.equal(value.fromIP,undefined);
 assert.throws(()=>normalizeDiagnostic({...value,code:999}));
});
test('service snapshots exclude arbitrary metric labels and invalid resource values',()=>{
 const value=normalizeDiagnostic({id:'svc-1',at,kind:'service',service:'server',instanceId:'server-one',state:'running',metrics:{cpuPct:150,memoryBytes:1024,pids:4,livekit_room_total:2,secret:55}});
 assert.equal(value.metrics.cpuPct,150);assert.equal(value.metrics.secret,undefined);assert.equal(value.metrics.livekit_room_total,2);
 assert.throws(()=>normalizeDiagnostic({...value,metrics:{cpuPct:-1}}));
});
