import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waveformPeaks,recordingOffset } from '../../web/src/lib/waveform.js';
test('waveform bins reflect decoded channels rather than synthetic amplitudes',()=>{
 assert.deepEqual(waveformPeaks([new Float32Array([0,.5,0,-.25]),new Float32Array([0,0,.75,0])],2),[.5,.75]);
 assert.deepEqual(waveformPeaks([],2),[]);assert.deepEqual(waveformPeaks([new Float32Array([0,0])],2),[0,0]);
});
test('transcript timestamps align only against a known media start and a covered duration',()=>{
 assert.equal(recordingOffset(12000,10000,5),2);assert.equal(recordingOffset(9000,10000,5),null);assert.equal(recordingOffset(16000,10000,5),null);assert.equal(recordingOffset(12000,null,5),null);assert.equal(recordingOffset(12000,10000,null),null);
});
