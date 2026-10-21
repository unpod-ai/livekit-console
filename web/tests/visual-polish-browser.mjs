// Run after `npm run build -w web`. Uses an installed Playwright module; no external services.
// PLAYWRIGHT_MODULE=/path/to/playwright node web/tests/visual-polish-browser.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const file = ['/theme.js','/brand.svg'].includes(url.pathname) ? path.join(dist, url.pathname.slice(1)) : url.pathname.startsWith('/assets/') ? path.join(dist, 'assets', path.basename(url.pathname)) : path.join(dist, 'index.html');
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.woff') ? 'font/woff' : 'text/html');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
const passed = [], errors = [];
const audioFixture=Buffer.alloc(44+8000*8*2);audioFixture.write('RIFF');audioFixture.writeUInt32LE(audioFixture.length-8,4);audioFixture.write('WAVEfmt ',8);audioFixture.writeUInt32LE(16,16);audioFixture.writeUInt16LE(1,20);audioFixture.writeUInt16LE(1,22);audioFixture.writeUInt32LE(8000,24);audioFixture.writeUInt32LE(16000,28);audioFixture.writeUInt16LE(2,32);audioFixture.writeUInt16LE(16,34);audioFixture.write('data',36);audioFixture.writeUInt32LE(audioFixture.length-44,40);for(let i=0;i<8000*8;i++)audioFixture.writeInt16LE(Math.round(Math.sin(i/8000*440*2*Math.PI)*3000),44+i*2);
const allCaps = { transcripts: true, recordings: true, logs: true };
const noCaps = { transcripts: false, recordings: false, logs: false };
const policy = { categories: Object.fromEntries(['reports','live','logs','diagnostics','history','workers','traffic','recordings'].map(k => [k, { retentionDays: k === 'history' ? null : 30, ...(k === 'recordings' ? { accessEnabled: true } : {}) }])), redaction: 'standard', redactTerms: [], bounds: { minDays: 1, maxDays: 3650, maxTerms: 50, maxTermLength: 200, exportRows: 10000, exportBytes: 8388608 } };
const coverage = Object.fromEntries(Object.keys(policy.categories).map(k => [k, { rows: 3, tables: { agent_session_reports: 3 }, retentionDays: policy.categories[k].retentionDays }]));
const collectors = [{ source: 'reports', enabled: true, state: 'ok', lastReceipt: 1792500000000, sourceAt: 1792499999000, lagMs: 1000, lastSuccess: 1792500000000, failures: 2, error: null, receiptsPerMinute: 0.5 }, { source: 'diagnostics', enabled: false, state: 'disabled', lastReceipt: null, sourceAt: null, lagMs: null, lastSuccess: null, failures: 0, error: null }];
const summary = { backend: { state: 'ready' }, collectors, categories: coverage, storage: { databaseBytes: 40960, walBytes: 8192, allocatedBytes: 40960, categories: coverage }, alerts: [] };
const alert = { id: 'event-1', ruleId: 'rule-1', source: 'reports', kind: 'source_stale', state: 'open', value: 301, windowSeconds: 300, firstAt: 1792500000000, lastAt: 1792500000000, ackAt: null, resolvedAt: null };
async function setup({ role = 'admin', caps = allCaps, meStatus = 200, authenticated = true, source = 'db', branding = {name:'LiveKit Console',domain:'',logoUrl:'/brand.svg',faviconUrl:'/brand.svg'}, reports = null, telemetry = null, recordings = null, responses = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR', e.message); });
  const requests = [], writes = [];
  let rules = [], events = [{ ...alert }], users = [{ id: 7, username: 'operator', role: 'viewer', source: 'db', capabilities: { ...noCaps }, createdAt: null, lastLoginAt: null }];
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), raw = url.pathname;
    if(raw==='/branding.json')return route.fulfill({contentType:'application/json',body:JSON.stringify(branding)});
    if(raw==='/custom-mark.svg'||raw==='/custom-icon.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="teal"/></svg>'});
    if(raw==='/broken-mark.svg')return route.fulfill({status:404,body:''});
    if (!raw.includes('/api/')) return route.continue();
    assert.ok(raw.startsWith('/api/') && !raw.startsWith('/api/projects'), `Unexpected scoped request: ${raw}`);
    const api = raw;
    requests.push({ raw, method: request.method(), search: url.search });
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (api === '/api/auth/login') { authenticated = true; writes.push({ raw, method: request.method(), body: request.postDataJSON() }); return json({ ok: true }); }
    if (api === '/api/auth/me') return authenticated ? json({ user: 'tester', role, source, capabilities: caps }, meStatus) : json({ error: 'Sign in required' }, 401);
    if(api.startsWith('/api/lk/')&&Object.hasOwn(responses,api))return json(responses[api]);
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      const body = request.postDataJSON(); writes.push({ raw, method: request.method(), body });
      if (api === '/api/auth/logout') { authenticated = false; return json({ ok: true }); }
      if (api.endsWith('/operations/policy')) return json({ ...policy, ...body });
      if (api.includes('/operations/data/')) return json({ category: body.confirm, rows: 3, tables: { agent_session_reports: 3 }, metadataMayBeRediscovered: false });
      if (api.endsWith('/operations/rules')) { const rule = { id: 'rule-1', ...body }; rules.push(rule); return json(rule, 201); }
      if (api.includes('/operations/rules/')) { rules = rules.map(r => ({ ...r, ...body })); return json(rules[0]); }
      if (api.endsWith('/ack') || api.endsWith('/resolve')) { events[0].state = api.endsWith('/ack') ? 'acknowledged' : 'resolved'; return json(events[0]); }
      if (api === '/api/users') { const user = { id: 8, source: 'db', createdAt: null, lastLoginAt: null, ...body }; users.push(user); return json(user, 201); }
      if (api.startsWith('/api/users/')) { const user = users.find(u => String(u.id) === api.split('/').at(-1)); Object.assign(user, body); return json(user); }
      return json({});
    }
    if (Object.hasOwn(responses,api)) return json(typeof responses[api]==='function'?responses[api](url):responses[api]);
    if (api === '/api/users') return json(users);
    if (api === '/api/operations/summary') return json(summary);
    if (api === '/api/operations/policy') return json(policy);
    if (api === '/api/operations/rules') return json(rules);
    if (api === '/api/operations/alerts') return json({ rows: events });
    if (api === '/api/operations/audit') return json({ rows: [{ id: 'req-1', at: 1792500000000, actor: 'tester', method: 'PATCH', action: 'update', route: '/operations/policy', resourceHash: null, status: 200 }] });
    if (api.startsWith('/api/operations/export/')) return json({ rows: 3, tables: {}, truncated: false });
    if (api.startsWith('/api/recordings/sessions/')) return json(recordings??{ files: [{ id: 'EG_same/0', egressId: 'EG_same', index: 0, name: 'session.mp4', state: 'ready', durationMs: 400000, mime: 'video/mp4', size: 30000000, startMs: null }], accessDays: 30 });
    if(api.startsWith('/api/recordings/')&&recordings?.files?.[0]?.mime==='audio/wav'){
      const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers().range??'');
      if(range){const start=Number(range[1]),end=Math.min(audioFixture.length-1,range[2]?Number(range[2]):audioFixture.length-1);return route.fulfill({status:206,contentType:'audio/wav',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${audioFixture.length}`},body:audioFixture.subarray(start,end+1)});}
      return route.fulfill({status:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes'},body:audioFixture});
    }
    if (api.startsWith('/api/recordings/')) return route.fulfill({ status: 204, body: '' });
    if (api.endsWith('/logs')) return json({ enabled: true, jobs: [], rows: [], total: 0, page: 1, pageSize: 100 });
    if (api.endsWith('/telemetry')&&telemetry)return json(typeof telemetry==='function'?telemetry(url):telemetry);
    if (api.endsWith('/telemetry')) return json({ enabled: true, jobs: [], rows: [], total: 0, page: 1, pageSize: 100, redaction: 'standard' });
    if (api.match(/^\/api\/agent-insights\/sessions\/[^/]+$/)&&reports)return json(typeof reports==='function'?reports(url):reports);
    if (api.match(/^\/api\/agent-insights\/sessions\/[^/]+$/)) return json({ enabled: true, retentionDays: 30, reports: [], total: 0, selected: null });
    if (api === '/api/history/sessions/RM_same') return json({ session: { room_sid: 'RM_same', room_name: 'Recorded session', started_at: Date.now(), ended_at: Date.now() }, participants: [], events: [], egress: [], timeline: [], calls: [] });
    if (api === '/api/history/sessions') return json({ rows: [{ room_sid: 'RM_same', room_name: 'Recorded session', started_at: Date.now(), participants: 0 }], total: 1, uniqueParticipants: 0, totalRooms: 1, series: [], peopleSeries: [], bucketMs: 3600000 });
    if (api === '/api/history/collector') return json({ sessions: 1, participants: 0, events: 0, egress: 0, dbBytes: 40960 });
    if (api === '/api/config') return json({ wsUrl: 'wss://example.invalid' });
    if (api === '/api/rooms' || api === '/api/agents/live') return json([]);
    if (api === '/api/history/insights') return json({ series: [], agentSeries: [], sipSeries: [], agentMinSeries: [], peopleSeries: [], kinds: [], bucketMs: 3600000 });
    return json({ rows: [], total: 0, items: [] });
  });
  return { page, requests, writes };
}
async function check(name, fn) { await fn(); passed.push(name); console.log(`PASS ${name}`); }
try {
 await check('range dropdown keyboard enters, navigates and restores focus',async()=>{
  const {page}=await setup();await page.goto(base+'/sessions');const trigger=page.getByTitle('Time range',{exact:true});await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('menu').waitFor();await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('role')),'menuitemradio');
  await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('[role=menu]'));assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);assert.ok((await trigger.innerText()).includes('Past hour'));
  await trigger.click();await page.keyboard.press('End');assert.equal(await page.getByRole('menuitemradio',{name:'Past 30 days'}).evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);await page.close();
 });
 await check('mobile range popup contains its selection indicator inside viewport',async()=>{
  const {page}=await setup();await page.setViewportSize({width:375,height:812});await page.goto(base+'/sessions');await page.getByTitle('Time range',{exact:true}).click();const box=await page.getByRole('menu').boundingBox();assert.ok(box.x>=8&&box.x+box.width<=367);assert.equal(await page.getByRole('menuitemradio',{checked:true}).locator('svg').isVisible(),true);await page.close();
 });
 await check('mobile labelled navigation opens, traps focus, dismisses and follows routes',async()=>{
  const {page}=await setup();await page.setViewportSize({width:375,height:812});await page.goto(base+'/sessions');const open=page.getByRole('button',{name:'Open navigation',exact:true});await open.click();const nav=page.getByRole('dialog',{name:'Navigation',exact:true});await nav.waitFor();await nav.getByRole('link',{name:'Settings',exact:true}).click();await page.waitForURL(u=>u.pathname==='/settings');await nav.waitFor({state:'hidden'});await open.click();await page.keyboard.press('Escape');await nav.waitFor({state:'hidden'});assert.equal(await open.evaluate(e=>e===document.activeElement),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
 });
 await check('short creation form uses a compact dialog and visible validation',async()=>{
  const {page,writes}=await setup();await page.goto(base+'/rooms');await page.getByRole('button',{name:'Create room',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create room',exact:true});await dialog.waitFor();assert.ok((await dialog.boundingBox()).height<700);await dialog.getByLabel('Room name').fill('');assert.equal(await dialog.getByRole('button',{name:'Create',exact:true}).isDisabled(),true);assert.ok(!writes.some(w=>w.raw==='/api/rooms'));await page.keyboard.press('Escape');await page.close();
 });
 await check('long-list job picker searches, selects by keyboard and preserves URL',async()=>{
   const jobs=Array.from({length:12},(_,i)=>({jobId:'AJ_job_'+i,agentName:'Agent '+i}));const {page}=await setup({responses:{'/api/agent-insights/sessions/RM_same/logs':{enabled:true,jobs,rows:[],total:0,page:1,pageSize:100}}});await page.goto(base+'/sessions/RM_same?tab=logs');await page.getByRole('combobox',{name:'Log job',exact:true}).click();await page.getByRole('combobox',{name:'Search log job',exact:true}).fill('Agent 11');await page.getByRole('option',{name:'Agent 11 · AJ_job_11',exact:true}).waitFor();await page.keyboard.press('Enter');await page.waitForURL(u=>u.searchParams.get('logJob')==='AJ_job_11');await page.reload();await page.getByRole('combobox',{name:'Log job',exact:true}).waitFor();await page.getByRole('combobox',{name:'Log job',exact:true}).click();await page.getByRole('combobox',{name:'Search log job',exact:true}).fill('No matching agent');await page.getByText('No matching options',{exact:true}).waitFor();await page.keyboard.press('Control+k');await page.getByRole('dialog',{name:'Command palette',exact:true}).waitFor();await page.getByRole('listbox',{name:'Log job',exact:true}).waitFor({state:'hidden'});await page.keyboard.press('Escape');await page.close();
 });
 await check('mobile Search closes navigation and stays accessible above content',async()=>{
  const {page}=await setup();await page.setViewportSize({width:375,height:812});await page.goto(base+'/sessions');await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('dialog',{name:'Navigation',exact:true}).getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('dialog',{name:'Navigation',exact:true}).waitFor({state:'hidden'});await page.getByRole('dialog',{name:'Command palette',exact:true}).getByRole('textbox',{name:'Jump to',exact:true}).fill('Settings');await page.keyboard.press('Enter');await page.waitForURL(u=>u.pathname==='/settings');await page.close();
 });
 await check('mobile records preserve sorting after table headers are replaced',async()=>{
   const {page}=await setup({responses:{'/api/inventory/agents':[{id:'a',name:'Alpha agent',aliases:[],lastSeenAt:100},{id:'z',name:'Zulu agent',aliases:[],lastSeenAt:200}],'/api/history/agents':[], '/api/history/agent-workers':{configured:true,workers:[],former:[]},'/api/agent-insights/analytics':{groups:[]}}});await page.setViewportSize({width:375,height:812});await page.goto(base+'/agents');await page.getByLabel('Sort records by').selectOption('name');assert.ok((await page.locator('.mobile-record').first().innerText()).includes('Alpha agent'));await page.getByRole('button',{name:'Sort descending',exact:true}).click();assert.ok((await page.locator('.mobile-record').first().innerText()).includes('Zulu agent'));await page.close();
 });
 await check('header range, refresh now and auto-refresh off remain functional',async()=>{
  const {page,requests}=await setup();await page.goto(base+'/sessions');await page.getByRole('link',{name:'Recorded session',exact:true}).waitFor();await page.getByTitle('Auto-refresh',{exact:true}).click();await page.getByRole('menuitemradio',{name:'Auto-refresh off',exact:true}).click();await page.waitForTimeout(200);const count=()=>requests.filter(r=>r.raw==='/api/history/sessions').length;const before=count();await page.getByRole('button',{name:'Refresh now',exact:true}).click();await page.waitForTimeout(300);assert.equal(count(),before+1);await page.getByTitle('Time range',{exact:true}).click();await page.getByRole('menuitemradio',{name:'Past 6 hours',exact:true}).click();await page.waitForTimeout(300);assert.ok(requests.some(r=>r.raw==='/api/history/sessions'&&new URLSearchParams(r.search).get('hours')==='6'));await page.close();
 });
 await check('shared night/day surfaces and supporting text retain readable contrast',async()=>{
   const {page}=await setup();await page.goto(base+'/tokens');await page.getByRole('heading',{name:'Token generator',exact:true}).waitFor();
   for(const theme of ['dark','light']){await page.getByRole('button',{name:`Use ${theme} theme`,exact:true}).click();const contrast=await page.evaluate(()=>{const c=getComputedStyle(document.documentElement);const rgb=x=>{const s=document.createElement('span');s.style.color=x;document.body.append(s);const numbers=getComputedStyle(s).color.match(/[0-9.]+/g).slice(0,3).map(Number);s.remove();return numbers.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4})};const lum=x=>{const a=rgb(x);return a[0]*.2126+a[1]*.7152+a[2]*.0722};const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};return{body:ratio(c.getPropertyValue('--text'),c.getPropertyValue('--bg')),muted:ratio(c.getPropertyValue('--muted'),c.getPropertyValue('--surface')),button:ratio(c.getPropertyValue('--accent-ink'),c.getPropertyValue('--accent'))}});assert.ok(contrast.body>=4.5&&contrast.muted>=4.5&&contrast.button>=4.5,JSON.stringify({theme,contrast}));}await page.close();
 });
 await check('routing action menu preserves edit and destructive cancellation',async()=>{
  const {page,writes}=await setup({responses:{'/api/lk/sip/ListSIPDispatchRule':{items:[{sipDispatchRuleId:'SDR_fixture',name:'Support routing',rule:{dispatchRuleIndividual:{roomPrefix:'support-'}},roomConfig:{agents:[]}}]},'/api/lk/sip/ListSIPInboundTrunk':{items:[]}}});await page.goto(base+'/telephony/dispatch');await page.getByRole('button',{name:'Actions',exact:false}).filter({hasText:'Actions'}).first().click();await page.getByRole('menuitem',{name:'Delete Support routing',exact:true}).click();await page.getByRole('alertdialog',{name:'Delete dispatch rule?',exact:true}).waitFor();await page.getByRole('alertdialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.ok(!writes.some(w=>w.raw.endsWith('/DeleteSIPDispatchRule')));await page.getByRole('button',{name:'Actions',exact:false}).filter({hasText:'Actions'}).first().click();await page.getByRole('menuitem',{name:'Edit Support routing',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.close();
 });
 await check('styled native selects retain keyboard selection semantics',async()=>{
   const {page}=await setup({responses:{'/api/agent-insights/analytics':{from:Date.now()-86400000,to:Date.now(),bucketMs:3600000,metric:'e2e_latency',metricLabel:'Response latency',agents:[],groups:[],series:[],stages:[],models:[],usageCoverage:{totalReports:0,usageReports:0,expiredReports:0,missingUsageReports:0},modelsByAgent:[],totalSamples:0,totalContributors:0,rows:[],selected:null,bucket:null,page:1,pageSize:25}}});await page.goto(base+'/agent-analytics');const select=page.getByLabel('Performance metric',{exact:true});await select.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForURL(u=>u.searchParams.get('perfMetric')==='llm_node_ttft');await page.close();
 });
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:passed.length,pageErrors:errors.length}));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
