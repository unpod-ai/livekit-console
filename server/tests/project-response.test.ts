import { test } from 'node:test';
import assert from 'node:assert/strict';
const { safeProjectResponse }=await import('../src/project-response.js');
test('upstream recording URLs are not exposed as bypass links in project JSON',()=>{
 const source={files:[{name:'recording.ogg',location:'https://bucket.example/file?signature=private'}],info:{fileResults:[{filename:'recording.ogg',location:'https://storage.example/object'}]},source:{url:'https://ingress.example/input'}};
 const result=safeProjectResponse(source);
 assert.equal(result.files[0].location,'');assert.equal(result.info.fileResults[0].location,'');assert.equal(result.source.url,source.source.url);assert.ok(source.files[0].location);
});
