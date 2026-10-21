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
  const file = url.pathname === '/theme.js' ? path.join(dist, 'theme.js') : url.pathname.startsWith('/assets/') ? path.join(dist, 'assets', path.basename(url.pathname)) : path.join(dist, 'index.html');
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.woff') ? 'font/woff' : 'text/html');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const passed = [], errors = [];
const allCaps = { transcripts: true, recordings: true, logs: true };
const noCaps = { transcripts: false, recordings: false, logs: false };
const policy = { categories: Object.fromEntries(['reports','live','logs','diagnostics','history','workers','traffic','recordings'].map(k => [k, { retentionDays: k === 'history' ? null : 30, ...(k === 'recordings' ? { accessEnabled: true } : {}) }])), redaction: 'standard', redactTerms: [], bounds: { minDays: 1, maxDays: 3650, maxTerms: 50, maxTermLength: 200, exportRows: 10000, exportBytes: 8388608 } };
const coverage = Object.fromEntries(Object.keys(policy.categories).map(k => [k, { rows: 3, tables: { agent_session_reports: 3 }, retentionDays: policy.categories[k].retentionDays }]));
const collectors = [{ source: 'reports', enabled: true, state: 'ok', lastReceipt: 1792500000000, sourceAt: 1792499999000, lagMs: 1000, lastSuccess: 1792500000000, failures: 2, error: null, receiptsPerMinute: 0.5 }, { source: 'diagnostics', enabled: false, state: 'disabled', lastReceipt: null, sourceAt: null, lagMs: null, lastSuccess: null, failures: 0, error: null }];
const summary = { backend: { state: 'ready' }, collectors, categories: coverage, storage: { databaseBytes: 40960, walBytes: 8192, allocatedBytes: 40960, categories: coverage }, alerts: [] };
const alert = { id: 'event-1', ruleId: 'rule-1', source: 'reports', kind: 'source_stale', state: 'open', value: 301, windowSeconds: 300, firstAt: 1792500000000, lastAt: 1792500000000, ackAt: null, resolvedAt: null };
async function setup({ role = 'admin', caps = allCaps, meStatus = 200, authenticated = true, source = 'db' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR', e.message); });
  const requests = [], writes = [];
  let rules = [], events = [{ ...alert }], users = [{ id: 7, username: 'operator', role: 'viewer', source: 'db', capabilities: { ...noCaps }, createdAt: null, lastLoginAt: null }];
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), raw = url.pathname;
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
    if (api === '/api/users') return json(users);
    if (api === '/api/operations/summary') return json(summary);
    if (api === '/api/operations/policy') return json(policy);
    if (api === '/api/operations/rules') return json(rules);
    if (api === '/api/operations/alerts') return json({ rows: events });
    if (api === '/api/operations/audit') return json({ rows: [{ id: 'req-1', at: 1792500000000, actor: 'tester', method: 'PATCH', action: 'update', route: '/operations/policy', resourceHash: null, status: 200 }] });
    if (api.startsWith('/api/operations/export/')) return json({ rows: 3, tables: {}, truncated: false });
    if (api.startsWith('/api/recordings/sessions/')) return json({ files: [{ id: 'EG_same/0', egressId: 'EG_same', index: 0, name: 'session.mp4', state: 'ready', durationMs: 400000, mime: 'video/mp4', size: 30000000, startMs: null }], accessDays: 30 });
    if (api.startsWith('/api/recordings/')) return route.fulfill({ status: 204, body: '' });
    if (api.endsWith('/logs')) return json({ enabled: true, jobs: [], rows: [], total: 0, page: 1, pageSize: 100 });
    if (api.endsWith('/telemetry')) return json({ enabled: true, jobs: [], rows: [], total: 0, page: 1, pageSize: 100, redaction: 'standard' });
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
    await page.getByText('0.50', { exact: true }).waitFor();
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
    await page.getByText('req-1', { exact: true }).waitFor();
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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: passed.length, pageErrors: errors.length }));
} catch (e) { for (const context of browser.contexts()) for (const page of context.pages()) console.error('FAILED PAGE', page.url(), (await page.locator('body').innerText()).slice(0,4000)); throw e; } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
