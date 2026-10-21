import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBranding,brandHtml} from '../src/branding.js';
test('branding supports runtime names domains assets and safe defaults without exposing credentials',()=>{
 assert.deepEqual(loadBranding({}),{name:'LiveKit Console',domain:'',logoUrl:'/brand.svg',faviconUrl:'/brand.svg'});
 const value=loadBranding({CONSOLE_NAME:'My Console',CONSOLE_DOMAIN:'console.example.com',CONSOLE_LOGO_URL:'https://assets.example.com/mark.svg',LIVEKIT_API_SECRET:'private',ADMIN_PASSWORD:'secret'});
 assert.equal(value.domain,'console.example.com');assert.equal(value.faviconUrl,value.logoUrl);assert.ok(!JSON.stringify(value).includes('private'));assert.equal(Object.keys(value).length,4);
 const html=brandHtml('<html><head><title>LiveKit Console</title><link rel="icon" href="/brand.svg" /></head></html>',{...value,name:'Ops <Demo> & "team"'});
 assert.ok(html.includes('<title>Ops &lt;Demo&gt; &amp; &quot;team&quot;</title>'));assert.ok(html.includes('https://assets.example.com/mark.svg'));
});
test('branding rejects executable URLs, credentials, arbitrary domain paths and invalid names',()=>{
 for(const value of ['javascript:alert(1)','data:image/svg+xml,x','//evil.test/icon.svg','/\\evil.test/icon','https://u:pass@example.com/logo.svg'])assert.throws(()=>loadBranding({CONSOLE_LOGO_URL:value}));
 for(const value of ['https://example.com/path','user:pass@example.com','https://example.com?secret=x','javascript:alert(1)'])assert.throws(()=>loadBranding({CONSOLE_DOMAIN:value}));
 for(const value of [' ','x'.repeat(101),'Bad\nName'])assert.throws(()=>loadBranding({CONSOLE_NAME:value}));
});
