// Run after `npm run build -w web`. Uses an installed Playwright module; no external services.
// PLAYWRIGHT_MODULE=/path/to/playwright node web/tests/phase5-browser.mjs
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
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
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
  await check('single-server links, tabs, browser history, webhook and reload need no project API', async () => {
    const { page, requests } = await setup(); await page.goto(base + '/settings');
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Project', exact: true }).count(), 0);
    assert.equal(await page.getByRole('tab', { name: 'Project access' }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Sessions', exact: true }).getAttribute('href'), '/sessions');
    await page.getByRole('tab', { name: 'Webhooks & history' }).click(); assert.equal(new URL(page.url()).searchParams.get('tab'), 'webhooks');
    await page.getByText(base + '/webhook', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Sessions', exact: true }).click(); await page.getByText('Recorded session', { exact: true }).waitFor();
    await page.reload(); await page.getByText('Recorded session', { exact: true }).waitFor();
    await page.locator('tbody tr').first().click(); await page.getByRole('heading', { name: 'Recorded session', exact: true }).waitFor();
    await page.goBack(); await page.waitForURL(u=>u.pathname==='/sessions'); await page.getByRole('link', {name:'Recorded session',exact:true}).waitFor(); await page.goBack(); await page.getByRole('tab', { name: 'Webhooks & history' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.has('project'), false); assert.ok(requests.every(r => r.raw.startsWith('/api/'))); await page.close();
  });
  await check('viewer content grants allow unscoped media and telemetry but never administrator controls', async () => {
    const { page, requests } = await setup({ role: 'viewer' }); await page.goto(base + '/sessions/RM_same?tab=insights'); await page.locator('video').waitFor();
    assert.equal(await page.locator('video').getAttribute('src'), '/api/recordings/EG_same/0/stream'); await page.getByRole('button', { name: 'Export retained session data' }).waitFor();
    assert.ok(requests.some(r => r.raw === '/api/agent-insights/sessions/RM_same')); assert.ok(requests.some(r => r.raw.endsWith('/telemetry')));
    assert.equal(await page.getByRole('link', { name: 'Operations', exact: true }).count(), 0);
    await page.goto(base + '/settings?tab=team'); await page.getByText('Only administrators can manage team members.').waitFor(); assert.ok(!requests.some(r => r.raw === '/api/users')); await page.close();
  });
  await check('administrator role never implies content grants, including bootstrap accounts with absent grants', async () => {
    for (const options of [{ caps: noCaps }, { caps: null, source: 'env' }]) {
      const { page, requests } = await setup(options); await page.goto(base + '/sessions/RM_same?tab=insights'); await page.getByText('Transcript access is required to view agent reports.').waitFor();
      assert.ok(!requests.some(r => r.raw.includes('/agent-insights/') || r.raw.includes('/recordings/')));
      await page.goto(base + '/operations'); await page.getByRole('tab', { name: 'Data controls' }).click(); assert.equal(await page.getByRole('button', { name: 'Export category' }).isDisabled(), true); await page.close();
    }
  });
  await check('Team edits role and independent content permissions through single-server user API', async () => {
    const { page, writes } = await setup(); await page.goto(base + '/settings?tab=team');
    await page.getByRole('button', { name: 'Edit content access for operator' }).click(); await page.getByRole('checkbox', { name: 'Transcripts and agent analytics' }).check();
    await page.getByRole('button', { name: 'Save access', exact: true }).click(); await page.getByText('Content access updated', { exact: true }).waitFor();
    assert.deepEqual(writes.find(w => w.raw === '/api/users/7').body, { capabilities: { transcripts: true, recordings: false, logs: false } });
    await page.getByRole('combobox', { name: 'Role for operator' }).selectOption('admin'); await page.getByText('Role updated', { exact: true }).waitFor(); assert.deepEqual(writes.at(-1).body, { role: 'admin' });
    await page.getByRole('button', { name: 'Add member', exact: true }).click(); await page.getByLabel('Username', { exact: true }).fill('new-reader'); await page.getByLabel('Password', { exact: true }).fill('valid-password-123');
    await page.getByRole('checkbox', { name: 'Recording playback' }).check(); await page.getByRole('button', { name: 'Add member', exact: true }).last().click(); await page.getByText('Member added', { exact: true }).waitFor();
    assert.deepEqual(writes.find(w => w.raw === '/api/users' && w.method === 'POST').body, { username: 'new-reader', password: 'valid-password-123', role: 'viewer', capabilities: { transcripts: false, recordings: true, logs: false } }); await page.close();
  });
  await check('Operations policy, alert transitions, bounded export, deletion confirmation and audit', async () => {
    const { page, writes, requests } = await setup();
    await page.goto(base + '/operations');
    await page.getByRole('row',{name:/^Agent reports ok/}).click();await page.getByRole('dialog',{name:'Collector details'}).getByText('0.50',{exact:true}).waitFor();await page.reload();await page.getByRole('dialog',{name:'Collector details'}).waitFor();await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Retention & privacy' }).click();
    await page.getByLabel('Agent reports · days').fill('7');
    await page.getByRole('button', { name: 'Apply policy', exact: true }).click();
    await Promise.all([page.waitForResponse(r => r.url().includes('/operations/policy') && r.request().method() === 'GET'), page.getByRole('alertdialog').getByRole('button', { name: 'Apply policy' }).click()]);
    const patch = writes.find(w => w.raw.endsWith('/operations/policy'));
    assert.equal(patch.body.categories.reports.retentionDays, 7);
    assert.deepEqual(Object.keys(patch.body).sort(), ['categories', 'redactTerms', 'redaction']);
    await page.getByRole('tab', { name: 'Alerts', exact: true }).click();
    await page.getByRole('button', { name: 'Add alert rule' }).click();
    await page.getByRole('button', { name: 'Save rule' }).click();
    await page.getByRole('button', { name: 'Edit rule' }).waitFor();
    assert.deepEqual(writes.find(w => w.raw.endsWith('/operations/rules')).body, { kind: 'source_stale', source: 'reports', threshold: 300, windowSeconds: 300, enabled: true });
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await page.getByText('acknowledged', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await page.getByText('resolved', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Data controls' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export category' }).click(); await download;
    assert.ok(requests.some(r => r.raw === '/api/operations/export/reports' && r.search === '?content=false'));
    await page.getByRole('button', { name: 'Delete category', exact: true }).click();
    assert.ok(!writes.some(w => w.method === 'DELETE'));
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    assert.ok(!writes.some(w => w.method === 'DELETE'));
    await page.getByRole('button', { name: 'Delete category', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete category' }).click();
    await page.getByText(/3 rows affected/).waitFor();
    assert.deepEqual(writes.find(w => w.method === 'DELETE').body, { confirm: 'reports' });
    await page.getByRole('tab', { name: 'Audit', exact: true }).click();
    await page.getByText('Request details',{exact:true}).click();await page.getByText('req-1', { exact: true }).waitFor();
    assert.ok(requests.some(r => r.raw === '/api/operations/audit'));
    await page.setViewportSize({ width: 375, height: 812 });
    for (const tab of ['Health & storage', 'Retention & privacy', 'Alerts', 'Data controls', 'Audit']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `mobile overflow ${tab}`);
    }
    await page.screenshot({ path: '/tmp/phase5-operations-mobile.png' });
    await page.close();
  });
  await check('backend errors keep retry/sign-out and authentication uses direct endpoints', async () => {
    const broken = await setup({ meStatus: 503 }); await broken.page.goto(base + '/settings'); await broken.page.getByText('The console is temporarily unavailable.').waitFor();
    assert.ok(!broken.page.url().includes('/login')); await broken.page.getByRole('button', { name: 'Sign out', exact: true }).click(); await broken.page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); assert.ok(broken.writes.some(w => w.raw === '/api/auth/logout')); await broken.page.close();
    const { page, writes } = await setup({ authenticated: false }); await page.goto(base + '/settings'); await page.locator('input[name=username]').fill('tester'); await page.locator('input[name=password]').fill('test-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    assert.ok(writes.some(w => w.raw === '/api/auth/login')); assert.equal(new URL(page.url()).searchParams.has('project'), false); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); await page.close();
  });
  await check('individual transcript, log and recording grants do not imply each other', async () => {
    for (const capability of ['transcripts', 'logs', 'recordings']) {
      const { page, requests } = await setup({ role: 'viewer', caps: { ...noCaps, [capability]: true } });
      await page.goto(base + '/sessions/RM_same?tab=insights');
      await page.getByRole('heading', { name: 'Recorded session', exact: true }).waitFor();
      await page.getByText(capability === 'transcripts' ? /No agent session report/ : 'Transcript access is required to view agent reports.').waitFor();
      assert.equal(requests.some(r => r.raw.endsWith('/telemetry')), false);
      assert.equal(requests.some(r => r.raw.includes('/recordings/sessions/')), capability === 'recordings');
      await page.getByRole('tab', { name: 'Agent logs', exact: true }).click();
      await page.getByText(capability === 'logs' ? /Structured logs submitted by the agent/ : 'Agent logs require logs access.').waitFor();
      assert.equal(requests.some(r => r.raw.endsWith('/logs')), capability === 'logs');
      await page.close();
    }
  });
  await check('System Light Dark appearance follows OS, persists and synchronizes without changing data', async () => {
    const {page,writes}=await setup();await page.emulateMedia({colorScheme:'light'});await page.goto(base+'/operations');
    const theme=()=>page.evaluate(()=>({resolved:document.documentElement.dataset.theme,preference:document.documentElement.dataset.themePreference,scheme:getComputedStyle(document.documentElement).colorScheme}));
    await page.getByRole('button',{name:'Use system theme',exact:true}).waitFor();
    assert.deepEqual(await theme(),{resolved:'light',preference:'system',scheme:'light'});
    await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await page.getByRole('button',{name:'Use light theme',exact:true}).click();assert.equal((await theme()).resolved,'light');
    await page.emulateMedia({colorScheme:'light'});await page.emulateMedia({colorScheme:'dark'});assert.equal((await theme()).resolved,'light');
    await page.reload();await page.getByRole('heading',{name:'Operations',exact:true}).waitFor();assert.equal((await theme()).resolved,'light');
    await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();assert.equal((await theme()).preference,'light');
    await page.getByRole('button',{name:'Use dark theme',exact:true}).focus();await page.keyboard.press('Enter');assert.equal((await theme()).resolved,'dark');
    await page.getByRole('button',{name:'Use system theme',exact:true}).click();await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'lkc.theme',newValue:'dark',storageArea:localStorage})));assert.equal((await theme()).resolved,'dark');
    await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'lkc.theme',newValue:null,storageArea:localStorage})));assert.equal((await theme()).resolved,'light');
    for(const appearance of ['light','dark']){
      await page.getByRole('button',{name:'Use '+appearance+' theme',exact:true}).click();
      await page.setViewportSize({width:375,height:812});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.goto(base+'/operations?tab=policy');await page.getByRole('tab',{name:'Retention & privacy',exact:true}).click();
      assert.equal((await theme()).resolved,appearance);await page.screenshot({path:'/tmp/console-theme-'+appearance+'-mobile.png'});
      await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/sessions/RM_same?tab=insights');await page.getByRole('heading',{name:'Recorded session',exact:true}).waitFor();
      assert.equal((await theme()).resolved,appearance);assert.equal(await page.locator('video').count(),1);await page.screenshot({path:'/tmp/console-theme-'+appearance+'-session.png'});
    }
    await page.route('**/api/history/insights?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({avgSessionMs:12000,totalSessions:2,agentSessions:1,sipSessions:0,participants:3,agentSessionMinutes:2,countries:[],series:[{t:Math.floor(Date.now()/3600000)*3600000-3600000,n:2}],agentSeries:[{t:Math.floor(Date.now()/3600000)*3600000-3600000,n:3}],sipSeries:[],agentMinSeries:[],peopleSeries:[],kinds:[],bucketMs:3600000})}));
    for(const appearance of ['light','dark']){
      await page.getByRole('button',{name:'Use '+appearance+' theme',exact:true}).click();
      const contrasts=await page.evaluate(()=>{
        const probe=document.createElement('span');document.body.append(probe);
        const rgb=color=>color.match(/[\d.]+/g).slice(0,3).map(Number);
        const luminance=color=>rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
        const ratio=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        probe.style.color='var(--bg)';const bg=luminance(getComputedStyle(probe).color),out={};
        for(const key of ['border-strong','text','text-2','muted','accent','ok','warn','bad','info','purple','chart-cyan','chart-purple','chart-orange','chart-green','chart-amber','chart-gray','chart-red']){probe.style.color='var(--'+key+')';out[key]=ratio(bg,luminance(getComputedStyle(probe).color));}
        probe.remove();return out;
      });
      for(const [key,ratio] of Object.entries(contrasts))assert.ok(ratio>=(key.startsWith('chart-')||key==='border-strong'?3:4.5),appearance+' '+key+' contrast '+ratio);
      await page.goto(base+'/');await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();await page.locator('svg.chart').first().waitFor();
      assert.ok(await page.locator('svg.chart path[stroke]').count()>0);await page.screenshot({path:'/tmp/console-theme-'+appearance+'-charts.png'});
      await page.goto(base+'/operations');await page.getByRole('tab',{name:'Data controls',exact:true}).click();await page.getByRole('button',{name:'Delete category',exact:true}).click();await page.getByRole('alertdialog').waitFor();
      assert.equal((await theme()).resolved,appearance);await page.screenshot({path:'/tmp/console-theme-'+appearance+'-dialog.png'});await page.getByRole('alertdialog').getByRole('button',{name:'Cancel',exact:true}).click();
    }
    assert.equal(writes.length,0,'appearance changes must not mutate backend data');await page.close();
  });
  await check('theme resolves before React and remains usable when browser storage is blocked',async()=>{
    const {page}=await setup();await page.emulateMedia({colorScheme:'light'});
    await page.addInitScript(()=>{Object.defineProperty(Storage.prototype,'getItem',{value(){throw new DOMException('Blocked','SecurityError')}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw new DOMException('Blocked','SecurityError')}});});
    await page.route('**/assets/index-*.js',route=>route.abort());await page.goto(base+'/login');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');assert.equal(await page.locator('#root').innerHTML(),'');
    await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('console-theme-set',{detail:'light'})));assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');await page.close();
  });
  await check('Insights starts with a compact player and separate URL-backed investigation views',async()=>{
    const {page}=await setup();await page.goto(base+'/sessions/RM_same?tab=insights');
    await page.getByRole('tab',{name:'Transcript',exact:true}).waitFor({timeout:2500});
    await page.getByRole('tab',{name:'Metrics',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('insightView'),'metrics');
    assert.equal(await page.getByRole('heading',{name:'Live collection',exact:true}).count(),0);
    assert.equal(await page.getByRole('heading',{name:'Trace timeline',exact:true}).count(),0);
    await page.reload();await page.getByRole('tab',{name:'Metrics',exact:true,selected:true}).waitFor();await page.getByRole('tab',{name:'Traces',exact:true}).click();await page.goBack();await page.getByRole('tab',{name:'Metrics',exact:true,selected:true}).waitFor();await page.close();
  });

  const at=1792500000000;
  const reportFixture={roomSid:'RM_same',jobId:'AJ_one',agentName:'Support agent',participantSid:'PA_agent',workerId:'AW_native',sdkVersion:'1.5.8',reportedAt:at,receivedAt:at,expiresAt:at+86400000,state:'received',content:{schemaVersion:2,omittedItems:0,usage:[{type:'llm_usage',provider:'example',model:'chat',metrics:{input_tokens:10,output_tokens:4}}],items:[{id:'user-1',type:'message',role:'user',text:'Where is my order?',at},{id:'answer-1',type:'message',role:'assistant',text:'Your order arrives tomorrow.',at:at+3000,traceId:'a'.repeat(32),turnId:'turn-1',metrics:{e2e_latency:1.25,llm_node_ttft:.4}},{id:'tool-1',type:'function_call',name:'lookup_order',at:at+1500,callId:'call-1',isError:true}]}};
  const secondReport={...reportFixture,jobId:'AJ_two',agentName:'Second agent',content:{...reportFixture.content,items:[{id:'second-1',type:'message',role:'assistant',text:'Conversation from the second job.',at}]}};
  const reportsFixture=url=>({enabled:true,retentionDays:30,total:2,reports:[reportFixture,secondReport],selected:url.searchParams.get('jobId')==='AJ_two'?secondReport:reportFixture});
  const liveFixture={enabled:true,redaction:'standard',jobs:[{jobId:'AJ_one',agentName:'Support agent',state:'complete',reasons:[],mode:'pipeline',sdkLanguage:'python',sdkVersion:'1.5.8',participantSid:'PA_agent',workerId:'AW_native',capabilities:['events','spans'],receivedCount:2,expectedCount:2,droppedCount:0,lastReceived:at,expiresAt:at+86400000}],rows:[{id:'span-1',jobId:'AJ_one',kind:'span',name:'LLM response',stage:'llm',at:at+1000,end:at+1400,traceId:'a'.repeat(32),spanId:'b'.repeat(16),turnId:'turn-1'},{id:'live-message',jobId:'AJ_one',kind:'message',role:'assistant',text:'Live copy must not duplicate the final conversation.',at:at+3000,traceId:null,spanId:null,turnId:null}],total:2,page:1,pageSize:100};
  const playableRecording={files:[{id:'EG_same/0',egressId:'EG_same',index:0,name:'conversation.wav',state:'ready',mime:'audio/wav',durationMs:8000,size:audioFixture.length,startMs:at}],accessDays:30};
  await check('Insights prioritizes one conversation, selection drawer, seek and preserved URL state',async()=>{
    const {page,requests}=await setup({reports:reportsFixture,telemetry:liveFixture,recordings:playableRecording});await page.goto(base+'/sessions/RM_same?tab=insights&reportJob=AJ_one');
    await page.getByText('Your order arrives tomorrow.',{exact:true}).waitFor();assert.equal(await page.getByText('Live copy must not duplicate the final conversation.',{exact:true}).count(),0);
    assert.equal(await page.getByRole('heading',{name:'Collection details',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'Model usage',exact:true}).count(),0);
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1);await page.getByRole('button',{name:'Seek to report item answer-1',exact:true}).click();await page.waitForFunction(()=>Math.abs(document.querySelector('video').currentTime-3)<.1);const drawer=page.getByRole('dialog',{name:'Conversation details'});await drawer.waitFor();assert.equal(new URL(page.url()).searchParams.get('mediaAt'),String(at+3000));assert.equal(new URL(page.url()).searchParams.get('liveTurn'),'turn-1');await drawer.getByText('1,250 ms',{exact:true}).waitFor();
    assert.equal(await drawer.getByRole('button',{name:'Close',exact:true}).evaluate(el=>document.activeElement===el),true);await page.keyboard.press('Shift+Tab');assert.equal(await drawer.getByRole('link',{name:'Related logs'}).evaluate(el=>document.activeElement===el),true);await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});assert.equal(await drawer.count(),0);assert.equal(new URL(page.url()).searchParams.get('mediaAt'),String(at+3000));
    const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Download report',exact:true}).click();assert.ok((await exported).suggestedFilename().includes('AJ_one'));const combined=page.waitForEvent('download');await page.getByRole('button',{name:'Export retained session data',exact:true}).click();assert.ok((await combined).suggestedFilename().includes('RM_same'));assert.ok(requests.some(r=>r.raw.endsWith('/export')&&r.search.includes('jobId=AJ_one')));
    await page.getByRole('button',{name:'Session details',exact:true}).click();await page.getByRole('dialog',{name:'Session details',exact:true}).getByText('AW_native',{exact:true}).first().waitFor();await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'Metrics',exact:true}).click();await page.getByText('Response latency · p50',{exact:true}).waitFor();await page.getByRole('heading',{name:'Model usage',exact:true}).waitFor();assert.equal(await page.getByText('TTS first audio · p50',{exact:true}).count(),0);
    await page.getByRole('tab',{name:'Traces',exact:true}).click();await page.getByRole('button',{name:'Select trace LLM response',exact:true}).click();await page.getByRole('dialog',{name:'Event details'}).waitFor();await page.reload();await page.getByRole('dialog',{name:'Event details'}).waitFor();await page.getByRole('dialog',{name:'Event details'}).getByRole('link',{name:'Related logs'}).click();await page.getByRole('tab',{name:'Session logs',exact:true,selected:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('logTrace'),'a'.repeat(32));assert.ok(requests.some(r=>r.raw.endsWith('/logs')));
    await page.getByRole('combobox',{name:'Agent report',exact:true}).selectOption('AJ_two');assert.equal(new URL(page.url()).searchParams.has('logTrace'),false);await page.getByRole('tab',{name:'Transcript',exact:true}).click();await page.getByText('Conversation from the second job.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Use dark theme',exact:true}).click();await page.waitForTimeout(400);assert.equal(await page.locator('video').evaluate(el=>el.error),null);await page.screenshot({path:'/tmp/insights-workspace-dark.png'});await page.setViewportSize({width:375,height:812});await page.waitForTimeout(350);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/insights-workspace-mobile.png'});await page.close();
  });
  await check('Insights bounds long transcripts and restores search/page selection',async()=>{
    const longReport={...reportFixture,content:{...reportFixture.content,items:Array.from({length:51},(_,i)=>({id:'item-'+i,type:'message',role:'assistant',text:'Turn number '+i,at:at+i*1000}))}};
    const {page}=await setup({reports:{enabled:true,total:1,retentionDays:30,reports:[longReport],selected:longReport},recordings:{files:[],accessDays:30}});await page.goto(base+'/sessions/RM_same?tab=insights');await page.getByText('Turn number 0',{exact:true}).waitFor();await page.waitForURL(u=>u.searchParams.get('reportJob')==='AJ_one');assert.equal(await page.getByText('Turn number 50',{exact:true}).count(),0);await page.getByRole('button',{name:'Next turns',exact:true}).click();await page.getByText('Turn number 50',{exact:true}).waitFor();await page.reload();await page.getByText('Turn number 50',{exact:true}).waitFor();await page.getByRole('textbox',{name:'Search transcript',exact:true}).fill('Turn number 12');await page.getByText('Turn number 12',{exact:true}).waitFor();assert.equal(await page.getByText('Turn number 50',{exact:true}).count(),0);await page.close();
  });
  await check('Insights keeps live-only and partial data usable and simplifies empty/expired states',async()=>{
    const active=await setup({telemetry:{...liveFixture,jobs:[{...liveFixture.jobs[0],state:'incomplete',reasons:['Upload interrupted']} ]},recordings:{files:[],accessDays:30}});await active.page.goto(base+'/sessions/RM_same?tab=insights');await active.page.getByText('Live copy must not duplicate the final conversation.',{exact:true}).waitFor();await active.page.getByText(/Some session telemetry is missing/).waitFor();await active.page.getByRole('button',{name:'Seek to event live-message',exact:true}).click();await active.page.getByRole('dialog',{name:'Event details'}).waitFor();await active.page.getByRole('tab',{name:'Transcript',exact:true,selected:true}).waitFor();await active.page.keyboard.press('Escape');assert.equal(await active.page.getByRole('heading',{name:'Session recording',exact:true}).count(),0);await active.page.close();
    const empty=await setup({recordings:{files:[],accessDays:30}});await empty.page.goto(base+'/sessions/RM_same?tab=insights');await empty.page.getByText('No agent conversation collected',{exact:true}).waitFor();assert.equal(await empty.page.locator('main .panel').count(),0);await empty.page.screenshot({path:'/tmp/insights-workspace-empty.png'});await empty.page.close();
    const expired=await setup({reports:{enabled:false,total:1,retentionDays:30,reports:[{...reportFixture,state:'expired'}],selected:{...reportFixture,state:'expired',content:null}},recordings:{files:[],accessDays:30}});await expired.page.goto(base+'/sessions/RM_same?tab=insights&insightView=metrics');await expired.page.getByText('Session metrics expired',{exact:true}).waitFor();assert.equal(await expired.page.getByRole('button',{name:'Download report',exact:true}).count(),0);await expired.page.close();
    const limited=await setup({role:'viewer',caps:{transcripts:true,logs:false,recordings:false},reports:reportsFixture});await limited.page.goto(base+'/sessions/RM_same?tab=insights');await limited.page.getByText('Your order arrives tomorrow.',{exact:true}).waitFor();assert.equal(await limited.page.getByRole('button',{name:'Export retained session data',exact:true}).count(),0);await limited.page.getByRole('tab',{name:'Session logs',exact:true}).click();await limited.page.getByText('Agent logs require logs access.',{exact:true}).waitFor();assert.ok(!limited.requests.some(r=>r.raw.endsWith('/logs')||r.raw.endsWith('/telemetry')||r.raw.startsWith('/api/recordings')));await limited.page.close();
  });
  await check('runtime branding updates name/title/favicon/footer and every logo links home',async()=>{
    const {page}=await setup({branding:{name:'Acme Ops',domain:'ops.example.test',logoUrl:'/custom-mark.svg',faviconUrl:'/custom-icon.svg'}});
    await page.goto(base+'/settings');await page.getByRole('link',{name:'Acme Ops home',exact:true}).first().waitFor();assert.equal(await page.title(),'Acme Ops');
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'),'/custom-icon.svg');
    const footer=page.getByRole('link',{name:'Acme Ops home · ops.example.test',exact:true});await footer.waitFor();assert.equal(await footer.getAttribute('href'),'/');assert.ok(await footer.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));
    await page.getByRole('link',{name:'Acme Ops home',exact:true}).click();await page.waitForURL(u=>u.pathname==='/');
    await page.getByRole('link',{name:'Settings',exact:true}).click();await footer.click();await page.waitForURL(u=>u.pathname==='/');
    await page.getByTitle('Collapse sidebar',{exact:true}).waitFor();await page.getByTitle('Collapse sidebar',{exact:true}).click();await page.getByRole('link',{name:'Acme Ops home',exact:true}).first().waitFor();assert.ok(await footer.isVisible());
    await page.setViewportSize({width:375,height:812});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.goto(base+'/login');await page.getByRole('link',{name:'Acme Ops home',exact:true}).first().waitFor();await page.getByRole('link',{name:'Acme Ops home',exact:true}).click();await page.waitForURL(u=>u.pathname==='/');await page.close();
    const broken=await setup({branding:{name:'Broken image test',domain:'',logoUrl:'/broken-mark.svg',faviconUrl:'/brand.svg'}});await broken.page.goto(base+'/settings');await broken.page.getByRole('link',{name:'Broken image test home',exact:true}).waitFor();await broken.page.waitForFunction(()=>[...document.querySelectorAll('.brand-image')].every(img=>img.complete&&img.naturalWidth>0&&img.getAttribute('src')==='/brand.svg'));await broken.page.close();
  });
  await check('Agents stays compact and preserves archived workers and native IDs behind Workers',async()=>{
    const now=Date.now(),agent={id:'agent-ui',name:'Support agent',aliases:['old-support'],firstSeenAt:now-86400000,lastSeenAt:now};
    const worker={consoleWorkerId:'CW_current',agentId:agent.id,agentName:agent.name,url:'http://worker.invalid:8081',ok:true,workerId:'AW_current',checkedAt:now,lastCheckedAt:now,lastSeenAt:now,activeJobs:0,load:.012345,uptimePct:99.999};
    const former={...worker,consoleWorkerId:'CW_old',workerId:'AW_old',ok:false,state:'archived',archivedReason:'endpoint_removed',lastSeenAt:now-86400000};
    const data={agent,workers:[worker],former:[former],jobs:[{consoleWorkerId:'CW_current',workerId:'AW_current',roomSid:'RM_same',jobId:'AJ_link',agentName:agent.name}],rollups:{series:[],from:now-86400000,to:now,retentionDays:365,resolutionMs:3600000}};
    const {page}=await setup({responses:{'/api/inventory/agents':[agent],'/api/inventory/agents/agent-ui':data,'/api/history/agents':[{id:agent.id,name:agent.name,sessions:2,totalSessions:2}],'/api/history/agent-workers':{configured:true,workers:[worker],former:[former]},'/api/history/agents/agent-ui/overview':{sessions:[],joinLatency:[]},'/api/history/agents/agent-ui':{sessions:[]},'/api/agent-insights/analytics':{groups:[]},'/api/lk/sip/ListSIPDispatchRule':{items:[]}}});
    await page.addInitScript(()=>localStorage.setItem('lkc.cols.agents-clean','broken json'));
    await page.goto(base+'/agents');await page.getByRole('link',{name:'Support agent',exact:false}).waitFor();
    assert.equal(await page.locator('main .kpi').count(),3);assert.equal(await page.getByRole('columnheader',{name:'Worker load',exact:true}).count(),0);
    await page.getByRole('link',{name:'Support agent',exact:false}).click();await page.getByRole('tab',{name:'Overview',selected:true}).waitFor();
    assert.equal(await page.locator('main .kpi').count(),3);assert.equal(await page.getByRole('heading',{name:/Deployment/}).count(),0);assert.equal(await page.getByRole('heading',{name:/Worker inventory/}).count(),0);
    await page.screenshot({path:'/tmp/agents-clean-overview.png'});
    await page.getByRole('tab',{name:'Workers',exact:true}).click();await page.getByRole('heading',{name:'Workers (2)',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:/Deployment/}).count(),0);assert.equal(await page.getByRole('heading',{name:'Retained endpoint checks',exact:true}).isVisible(),false);
    await page.getByText('AW_old',{exact:true}).click();await page.getByRole('dialog',{name:'Worker details',exact:true}).waitFor();await page.getByRole('dialog').getByText('AW_old',{exact:true}).waitFor();await page.reload();await page.getByRole('dialog',{name:'Worker details',exact:true}).waitFor();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Column visibility',exact:true}).click();await page.getByRole('checkbox',{name:'Native-ID matched jobs',exact:true}).check();await page.getByRole('button',{name:'Column visibility',exact:true}).click();await page.getByRole('link',{name:'AJ_link',exact:true}).click();await page.waitForURL(u=>u.pathname==='/sessions/RM_same');await page.goBack();await page.getByRole('heading',{name:'Workers (2)',exact:true}).waitFor();
    await page.setViewportSize({width:375,height:812});await page.waitForTimeout(250);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/agents-clean-workers-mobile.png'});await page.close();
  });
  await check('Connection quality shows one empty state and only measured charts',async()=>{
    const now=Date.now();const response={rows:[],total:0,limit:200,offset:0,from:now-3600000,to:now,lifecycle:[],collectionEnabled:true,retentionDays:30};
    const empty=await setup({responses:{'/api/diagnostics/quality':response}});await empty.page.goto(base+'/sessions/RM_same?tab=quality');await empty.page.getByText('No connection measurements',{exact:true}).waitFor();assert.equal(await empty.page.getByRole('heading',{name:/^Bandwidth/}).count(),0);assert.equal(await empty.page.getByLabel('Quality from').isVisible(),false);await empty.page.close();
    const measured=await setup({responses:{'/api/diagnostics/quality':{...response,total:1,rows:[{id:'q1',at:now,participantSid:'PA_one',reporterId:'reporter',trackSid:'TR_one',direction:'inbound',metrics:{bitrateBps:1000}}]}}});await measured.page.goto(base+'/sessions/RM_same?tab=quality');await measured.page.getByRole('heading',{name:/^Bandwidth/}).waitFor();assert.equal(await measured.page.getByRole('heading',{name:/^Packet loss/}).count(),0);await measured.page.close();
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: passed.length, pageErrors: errors.length }));
} catch (e) { for (const context of browser.contexts()) for (const page of context.pages()) console.error('FAILED PAGE', page.url(), (await page.locator('body').innerText()).slice(0,4000)); throw e; } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
