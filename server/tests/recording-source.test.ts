import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecording, validateRange } from '../src/recording-source.js';
const storage = { bucket: 'test-recordings', prefix: 'calls/', retentionDays: 30 };
const row = { egress_id: 'EG_test', started_at: Date.now(), ended_at: Date.now(), info: JSON.stringify({ roomComposite: { fileOutputs: [{ s3: { bucket: 'test-recordings' } }] }, fileResults: [{ filename: 'calls/test.ogg', location: 'https://untrusted.invalid/arbitrary', startedAt: '1700000000000000000', duration: '10000000000', size: '100' }] }) };
test('recording keys come from configured bucket/prefix and stored filenames, never arbitrary URL fetches', () => {
  const r=resolveRecording(row,0,storage);assert.equal(r.key,'calls/test.ogg');assert.equal(r.mime,'audio/ogg');assert.equal(r.startMs,1700000000000);
  for (const filename of ['../secret','calls/../secret','/etc/passwd','calls/%2e%2e/secret','http://127.0.0.1/private','calls/test.m3u8']) {
    const raw=JSON.parse(row.info);raw.fileResults[0].filename=filename;assert.notEqual(resolveRecording({...row,info:JSON.stringify(raw)},0,storage).state,'ready');
  }
  assert.equal(resolveRecording(row,0,{...storage,bucket:'other'}).state,'unconfigured');
  assert.equal(resolveRecording({...row,ended_at:1,started_at:1},0,storage).state,'expired');
  assert.equal(resolveRecording(row,5,storage).state,'missing');
});
test('byte ranges allow single finite or suffix requests and reject multipart or unsafe numbers', () => {
  for (const value of [undefined,'bytes=0-9','bytes=100-','bytes=-10'])assert.equal(validateRange(value),value);
  for (const value of ['bytes=','bytes=9-0','bytes=0-1,4-5','bytes=-0','bytes=99999999999999999999-','items=1-5'])assert.throws(()=>validateRange(value));
});

test('recording access cannot renew indefinitely when lifecycle timestamps are missing',()=>{
 const old=resolveRecording({...row,started_at:null,ended_at:null},0,storage);assert.equal(old.state,'expired');
 const info=JSON.parse(row.info);delete info.fileResults[0].startedAt;
 assert.equal(resolveRecording({...row,started_at:null,ended_at:null,info:JSON.stringify(info)},0,storage).state,'unavailable');
});
