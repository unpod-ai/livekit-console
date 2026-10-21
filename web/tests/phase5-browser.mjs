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
  const file = url.pathname.startsWith('/assets/') ? path.join(dist, 'assets', path.basename(url.pathname)) : path.join(dist, 'index.html');
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
async function setup({ role = 'admin', caps = allCaps, globalAdmin = true, projectsMode = 'normal', meStatus = 200, delayed = false, backendState = 'ready', authenticated = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR', e.message); });
  const requests = [], writes = [];
  let rules = [], events = [{ ...alert }], memberships = [{ userId: 7, username: 'operator', role: 'viewer', ...noCaps }];
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), raw = url.pathname;
    if (!raw.includes('/api/')) return route.continue();
    const project = raw.match(/^\/p\/([^/]+)\/api\//)?.[1] ?? 'legacy';
    const api = raw.replace(/^\/p\/[^/]+/, '');
    requests.push({ raw, project, method: request.method(), search: url.search });
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (api === '/api/auth/login') { authenticated = true; writes.push({ raw, method: request.method(), body: request.postDataJSON() }); return json({ ok: true }); }
    if (api === '/api/projects') {
      if (!authenticated) return json({ error: 'Sign in required' }, 401);
      if (projectsMode === '404') return json({ error: 'Not found' }, 404);
      if (projectsMode === 'nonarray') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>legacy harness</html>' });
      if (projectsMode === '500') return json({ error: 'Unavailable' }, 500);
      if (projectsMode === 'empty') return json([]);
      return json(['default', 'beta'].map(id => ({ id, name: id === 'beta' ? 'Beta' : 'Default', role, capabilities: caps, globalAdmin, backend: { state: backendState } })));
    }
    if (api === '/api/auth/me') return json({ user: 'tester', role, source: 'db', capabilities: caps, globalAdmin, projectId: project }, meStatus);
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      const body = request.postDataJSON(); writes.push({ raw, method: request.method(), body });
      if (api.endsWith('/operations/policy')) return json({ ...policy, ...body });
      if (api.includes('/operations/data/')) return json({ category: body.confirm, rows: 3, tables: { agent_session_reports: 3 }, metadataMayBeRediscovered: false });
      if (api.endsWith('/operations/rules')) { const rule = { id: 'rule-1', ...body }; rules.push(rule); return json(rule, 201); }
      if (api.includes('/operations/rules/')) { rules = rules.map(r => ({ ...r, ...body })); return json(rules[0]); }
      if (api.endsWith('/ack') || api.endsWith('/resolve')) { events[0].state = api.endsWith('/ack') ? 'acknowledged' : 'resolved'; return json(events[0]); }
      if (api.includes('/members/')) {
        if (request.method() === 'DELETE') { memberships = []; return json({ ok: true }); }
        memberships = [{ userId: 7, username: 'operator', ...body }]; return json(memberships[0]);
      }
      return json({});
    }
    if (api.endsWith('/members')) return json(memberships);
    if (api === '/api/users') return json([{ id: 7, username: 'operator', role: 'viewer', source: 'db' }, { id: 8, username: 'new-reader', role: 'viewer', source: 'db' }]);
    if (api === '/api/operations/summary') return json(summary);
    if (api === '/api/operations/policy') return json(policy);
    if (api === '/api/operations/rules') return json(rules);
    if (api === '/api/operations/alerts') return json({ rows: events });
    if (api === '/api/operations/audit') return json({ rows: [{ id: 'req-1', at: 1792500000000, actor: 'tester', action: 'PATCH', route: '/operations/policy', status: 200 }] });
    if (api.startsWith('/api/operations/export/')) return json({ rows: 3, tables: {}, truncated: false });
    if (api.startsWith('/api/recordings/sessions/')) return json({ files: [{ id: 'EG_same/0', egressId: 'EG_same', index: 0, name: 'session.mp4', state: 'ready', durationMs: 400000, mime: 'video/mp4', size: 30000000, startMs: null }], accessDays: 30 });
    if (api.startsWith('/api/recordings/')) return route.fulfill({ status: 204, body: '' });
    if (api.endsWith('/logs')) return json({ enabled: true, jobs: [], rows: [], total: 0, page: 1, pageSize: 100 });
    if (api.endsWith('/telemetry')) return json({ enabled: true, jobs: [], rows: [], total: 0, page: 1, pageSize: 100, redaction: 'standard' });
    if (api.match(/^\/api\/agent-insights\/sessions\/[^/]+$/)) return json({ enabled: true, retentionDays: 30, reports: [], total: 0, selected: null });
    if (api === '/api/history/sessions/RM_same') {
      if (delayed && project === 'default') await new Promise(resolve => setTimeout(resolve, 1500));
      return json({ session: { room_sid: 'RM_same', room_name: project === 'beta' ? 'Beta collision' : 'Default collision', started_at: Date.now(), ended_at: Date.now() }, participants: [], events: [], egress: [], timeline: [], calls: [] }).catch(() => {});
    }
    if (api === '/api/history/sessions') return json({ rows: [{ room_sid: 'RM_same', room_name: `${project} session`, started_at: Date.now(), participants: 0 }], total: 1, uniqueParticipants: 0, totalRooms: 1, series: [], peopleSeries: [], bucketMs: 3600000 });
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
  await check('project query survives links, navigate, tabs, back/forward and reload', async () => {
    const { page, requests } = await setup();
    await page.goto(base + '/settings?project=beta');
    await page.getByRole('combobox', { name: 'Project', exact: true }).waitFor();
    const href = await page.getByRole('link', { name: 'Sessions', exact: true }).getAttribute('href');
    assert.ok(href.includes('project=beta'));
    await page.getByRole('tab', { name: 'Webhooks & history' }).click();
    assert.equal(new URL(page.url()).searchParams.get('project'), 'beta');
    await page.getByRole('link', { name: 'Sessions', exact: true }).click();
    await page.getByText('beta session', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('project'), 'beta');
    await page.reload(); await page.getByText('beta session', { exact: true }).waitFor();
    await page.locator('tbody tr').first().click(); await page.getByRole('heading', { name: 'Beta collision', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('project'), 'beta');
    await page.goBack(); await page.getByText('beta session', { exact: true }).waitFor();
    await page.goBack(); await page.getByRole('tab', { name: 'General', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('project'), 'beta');
    assert.ok(requests.filter(r => r.raw !== '/api/projects' && !r.raw.startsWith('/api/users')).every(r => r.project === 'beta'));
    await page.close();
  });
  await check('switch terminates pending requests and isolates reused room IDs', async () => {
    const { page } = await setup({ delayed: true });
    await page.goto(base + '/sessions/RM_same?project=default');
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('beta');
    await page.getByText('Beta collision', { exact: true }).first().waitFor();
    await page.waitForTimeout(1700);
    assert.equal(await page.getByText('Default collision', { exact: true }).count(), 0);
    assert.equal(new URL(page.url()).searchParams.get('project'), 'beta');
    await page.close();
  });
  await check('media URLs explicitly scope selected project; capability viewer gets sensitive reads', async () => {
    const { page, requests } = await setup({ role: 'viewer', globalAdmin: false });
    await page.goto(base + '/sessions/RM_same?tab=insights&project=beta');
    await page.locator('video').waitFor();
    assert.equal(await page.locator('video').getAttribute('src'), '/p/beta/api/recordings/EG_same/0/stream');
    await page.getByRole('button', { name: 'Export retained session data' }).waitFor();
    assert.ok(requests.some(r => r.raw === '/p/beta/api/agent-insights/sessions/RM_same'));
    assert.ok(requests.some(r => r.raw.endsWith('/telemetry')));
    assert.equal(await page.getByRole('link', { name: 'Operations', exact: true }).count(), 0);
    assert.equal(await page.locator('a[target=_blank][href*="recording"]').count(), 0);
    await page.close();
  });
  await check('project admin lacks sensitive reads without grants and cannot manage global directory', async () => {
    const { page, requests } = await setup({ caps: noCaps, globalAdmin: false });
    await page.goto(base + '/sessions/RM_same?tab=insights&project=beta');
    await page.getByText('Transcript access is required to view agent reports.').waitFor();
    assert.ok(!requests.some(r => r.raw.includes('/agent-insights/') || r.raw.includes('/recordings/')));
    await page.goto(base + '/settings?tab=team&project=beta');
    await page.getByText('Only global administrators can manage team members.').waitFor();
    assert.ok(!requests.some(r => r.raw === '/api/users'));
    await page.goto(base + '/operations?project=beta');
    await page.getByRole('tab', { name: 'Data controls' }).click();
    assert.equal(await page.getByRole('button', { name: 'Export category' }).isDisabled(), true);
    await page.close();
  });
  await check('global membership PUT has exact role and boolean grants on global URL', async () => {
    const { page, writes, requests } = await setup();
    await page.goto(base + '/settings?tab=memberships&project=beta');
    await page.getByRole('button', { name: 'Edit access' }).click();
    await page.getByRole('combobox', { name: 'Project role', exact: true }).selectOption('admin');
    await page.getByRole('checkbox', { name: 'Transcripts and agent analytics' }).check();
    await page.getByRole('button', { name: 'Save access' }).click();
    await page.getByText('Administrator', { exact: true }).waitFor();
    assert.deepEqual(writes.find(w => w.method === 'PUT'), { raw: '/api/projects/beta/members/7', method: 'PUT', body: { role: 'admin', transcripts: true, recordings: false, logs: false } });
    assert.ok(requests.some(r => r.raw === '/api/users'));
    await page.close();
  });
  await check('Operations policy, alert transitions, bounded export, deletion confirmation and audit', async () => {
    const { page, writes, requests } = await setup();
    await page.goto(base + '/operations?project=beta');
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
    assert.ok(requests.some(r => r.raw === '/p/beta/api/operations/export/reports' && r.search === '?content=false'));
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
    assert.ok(requests.some(r => r.raw === '/p/beta/api/operations/audit'));
    await page.setViewportSize({ width: 375, height: 812 });
    for (const tab of ['Health & storage', 'Retention & privacy', 'Alerts', 'Data controls', 'Audit']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `mobile overflow ${tab}`);
    }
    await page.screenshot({ path: '/tmp/phase5-operations-mobile.png' });
    await page.close();
  });
  for (const mode of ['404', 'nonarray']) await check(`legacy default fallback only for absent projects endpoint (${mode})`, async () => {
    const { page, requests } = await setup({ projectsMode: mode });
    await page.goto(base + '/settings'); await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    assert.ok(requests.some(r => r.raw === '/api/auth/me'));
    assert.ok(!requests.some(r => r.raw.startsWith('/p/')));
    await page.close();
    const blocked = await setup({ projectsMode: mode });
    await blocked.page.goto(base + '/settings?project=beta');
    await blocked.page.getByText(/This project is unavailable/).waitFor();
    assert.equal(blocked.requests.length, 1);
    await blocked.page.close();
  });
  for (const mode of ['500', 'empty']) await check(`configured gateway ${mode} never falls back`, async () => {
    const { page, requests } = await setup({ projectsMode: mode });
    await page.goto(base + '/settings?project=default');
    await page.getByRole('alert').waitFor();
    assert.equal(requests.length, 1);
    await page.close();
  });
  await check('backend failure does not redirect to login or default API', async () => {
    const { page, requests } = await setup({ meStatus: 503 });
    await page.goto(base + '/settings?project=beta');
    await page.getByText('This project is temporarily unavailable.').waitFor();
    assert.ok(page.url().includes('project=beta'));
    assert.ok(!page.url().includes('/login'));
    assert.ok(!requests.some(r => r.raw === '/api/auth/me'));
    await page.close();
  });
  await check('no-membership access errors allow global sign out', async () => {
    const { page, writes } = await setup({ projectsMode: 'empty' });
    await page.goto(base + '/settings?project=beta');
    await page.getByText('You do not have access to this project.').waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    assert.ok(writes.some(w => w.raw === '/api/auth/logout'));
    assert.equal(new URL(page.url()).searchParams.get('project'), 'beta');
    await page.close();
  });
  await check('login/logout stay global and preserve selected project', async () => {
    const { page, writes } = await setup({ authenticated: false });
    await page.goto(base + '/settings?project=beta');
    await page.locator('input[name=username]').fill('tester');
    await page.locator('input[name=password]').fill('test-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('combobox', { name: 'Project', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('project'), 'beta');
    assert.ok(writes.some(w => w.raw === '/api/auth/login'));
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    assert.ok(writes.some(w => w.raw === '/api/auth/logout'));
    await page.close();
  });
  for (const backendState of ['failed', 'starting']) await check(`backend ${backendState} retains selector and suppresses content requests`, async () => {
    const { page, requests } = await setup({ backendState });
    await page.goto(base + '/settings?project=beta');
    await page.getByRole('button', { name: 'Retry project' }).waitFor();
    await page.getByRole('combobox', { name: 'Project', exact: true }).waitFor();
    assert.ok(!requests.some(r => r.raw.endsWith('/api/config')));
    assert.ok(!page.url().includes('/login'));
    await page.close();
  });
  await check('history project changes replace query client while old requests remain pending', async () => {
    const { page } = await setup({ delayed: true });
    await page.goto(base + '/sessions/RM_same?project=default');
    await page.getByRole('combobox', { name: 'Project', exact: true }).waitFor();
    await page.evaluate(() => { window.keepDocument = true; history.pushState({}, '', '/sessions/RM_same?project=beta'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByText('Beta collision', { exact: true }).first().waitFor();
    await page.waitForTimeout(1600);
    assert.equal(await page.getByText('Default collision', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.keepDocument), true);
    await page.close();
  });
  await check('individual transcript, log and recording grants do not imply each other', async () => {
    for (const capability of ['transcripts', 'logs', 'recordings']) {
      const { page, requests } = await setup({ role: 'viewer', globalAdmin: false, caps: { ...noCaps, [capability]: true } });
      await page.goto(base + '/sessions/RM_same?tab=insights&project=beta');
      await page.getByRole('heading', { name: 'Beta collision', exact: true }).waitFor();
      await page.getByText(capability === 'transcripts' ? /No agent session report/ : 'Transcript access is required to view agent reports.').waitFor();
      assert.equal(requests.some(r => r.raw.endsWith('/telemetry')), false);
      assert.equal(requests.some(r => r.raw.includes('/recordings/sessions/')), capability === 'recordings');
      await page.getByRole('tab', { name: 'Agent logs', exact: true }).click();
      await page.getByText(capability === 'logs' ? /Structured logs submitted by the agent/ : 'Agent logs require logs access.').waitFor();
      assert.equal(requests.some(r => r.raw.endsWith('/logs')), capability === 'logs');
      await page.close();
    }
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: passed.length, pageErrors: errors.length }));
} catch (e) { for (const context of browser.contexts()) for (const page of context.pages()) console.error('FAILED PAGE', page.url(), (await page.locator('body').innerText()).slice(0,4000)); throw e; } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
