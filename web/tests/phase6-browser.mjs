// Mock browser acceptance: real React/router/query code, HTTP fixtures, test-only RTC boundary.
// Run production build separately. PLAYWRIGHT_MODULE=/path/to/playwright node web/tests/phase6-browser.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = await mkdtemp(path.join(tmpdir(), 'phase6-ui-browser-'));
await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', resolve: { alias: { 'livekit-client': path.join(root, 'tests/fixtures/mock-livekit.ts') } }, build: { outDir: dist, emptyOutDir: true } });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const file = url.pathname.startsWith('/assets/') ? path.join(dist, 'assets', path.basename(url.pathname)) : path.join(dist, 'index.html');
  try { const data = await readFile(file); res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.woff') ? 'font/woff' : 'text/html'); res.end(data); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const passed = [], errors = [];
const caps = { transcripts: true, logs: true, recordings: false };
const prompt = { text: 'Say hello', expectedSubstring: 'hello', timeoutSeconds: 10, expectationAvailable: true };
const scenario = { id: 'scenario-1', name: 'Greeting', revision: 1, prompts: [prompt, { ...prompt, text: 'Say hello again' }] };
const target = { id: 'managed', name: 'Managed fixture', agentName: 'named-agent', environment: 'test', host: 'fixture', region: 'local', image: 'fixture:old', imageId: 'sha256:old', version: 'old', replicas: 1, state: 'running', health: 'healthy', observedAt: new Date().toISOString(), managed: true, actionsEnabled: true, secretRevision: '1', allowedImages: [{ reference: 'fixture:new', imageId: 'sha256:new' }], instances: [{ id: 'container-1', image: 'fixture:old', imageId: 'sha256:old', state: 'running', health: 'healthy', role: 'current' }] };
function testRun(id, state = 'active') { return { id, agentName: 'named-agent', state, roomName: `console-test-${id}`, roomSid: `RM_${id}`, scenarioId: scenario.id, scenarioRevision: 1, scenario: structuredClone(scenario), results: [], cleanupState: 'pending', requestedDeployment: null, provenance: { state: 'unknown', actualWorkers: [] }, telemetry: { metrics: [{ metric: 'e2e_latency', count: 0, p50Ms: null, p95Ms: null }, { metric: 'llm_ttft', count: 1, p50Ms: 0, p95Ms: 0 }], missingMetrics: ['e2e_latency'], costState: 'not_measured' } }; }
async function setup(options = {}) {
  const grants = { ...caps, ...options.caps }, role = options.role ?? 'admin';
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', e => errors.push(e.message));
  const requests = [], writes = [];
  let scenarios = [structuredClone(scenario)], runs = [testRun('past-left', 'completed'), testRun('past-right', 'completed')], operations = [], counter = 0;
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), raw = url.pathname;
    if (!raw.includes('/api/')) return route.continue();
    const api = raw, method = req.method();
    assert.ok(!raw.startsWith('/p/') && !raw.startsWith('/api/projects'), `Unexpected scoped request: ${raw}`);
    requests.push({ raw, method, search: url.search });
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = method === 'GET' ? null : req.postDataJSON();
    if (body) writes.push({ raw, method, body });
    if (api === '/api/auth/me') return json({ user: 'tester', role, source: 'db', capabilities: grants });
    if (api === '/api/config') return json({ wsUrl: 'wss://example.invalid' });
    if (api === '/api/inventory/agents') return json([{ id: 'agent-id', name: 'named-agent', aliases: ['named-agent'], firstSeenAt: null, lastSeenAt: null }]);
    if (api === '/api/deployments/targets') {
      if (options.unavailable) return json({ error: 'Helper offline' }, 503);
      return json({ configured: !options.unconfigured, targets: options.unconfigured ? [] : [{ ...target, ...(options.readonly ? { managed: false, actionsEnabled: false } : {}) }, { ...target, id: 'other', name: 'Other agent', agentName: 'other-agent', managed: false, actionsEnabled: false }], operations });
    }
    if (api.endsWith('/secrets')) return json({ revision: '2', keys: ['API_KEY'], allowedKeys: ['API_KEY'] });
    if (api.endsWith('/logs')) return json({ lines: ['bounded safe output'], truncated: true });
    if (api.endsWith('/actions')) { const op = { id: `op-${writes.length}`, targetId: 'managed', action: body.action, state: 'completed', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [{ at: new Date().toISOString(), state: 'completed', message: 'Health checked; registration unknown' }] }; operations = [op]; return json(op); }
    if (api === '/api/agent-tests/scenarios') {
      if (method === 'POST') { assert.ok(!JSON.stringify(body).includes('expectationAvailable')); const s = { id: 'created', revision: 1, ...body }; scenarios.push(s); return json(s, 201); }
      return json({ rows: scenarios });
    }
    if (api.startsWith('/api/agent-tests/scenarios/')) { const id = api.split('/').at(-1); if (method === 'DELETE') { scenarios = scenarios.filter(s => s.id !== id); return json({ deleted: true }); } const old = scenarios.find(s => s.id === id); assert.ok(!JSON.stringify(body).includes('expectationAvailable')); Object.assign(old, body, { revision: old.revision + 1 }); return json(old); }
    if (api === '/api/agent-tests/runs') {
      if (method === 'POST') { const run = testRun(`run-${++counter}`); if (!body.scenarioId) { run.scenario = null; run.scenarioId = null; run.scenarioRevision = null; } if (body.deploymentId) run.requestedDeployment = { id: body.deploymentId, agentName: body.agentName, version: 'old', image: target.image, imageId: target.imageId }; runs.push(run); return json({ run, token: 'short-room-token', wsUrl: 'wss://rtc.example.invalid' }, 201); }
      return json({ rows: runs });
    }
    if (api === '/api/agent-tests/compare') { const left = runs.find(r => r.id === url.searchParams.get('left')), right = structuredClone(runs.find(r => r.id === url.searchParams.get('right'))); if (options.incompatible) right.scenarioRevision = 2; return json({ left, right, compatibility: { sameScenarioRevision: !options.incompatible, expectationsComparable: !options.incompatible, versionRegressionComparable: false, reasons: ['actual_worker_version_unknown'] } }); }
    if (api.startsWith('/api/agent-tests/runs/')) {
      const [, id, action] = api.match(/^\/api\/agent-tests\/runs\/([^/]+)(?:\/(.*))?$/), run = runs.find(r => r.id === id);
      if (!run) return json({ error: 'Run not found' }, 404);
      if (action === 'reconnect') return json({ run, token: 'refreshed-room-token', wsUrl: 'wss://rtc.example.invalid' });
      if (action === 'results') for (const r of body.results) run.results.push({ ...r, outcome: r.status === 'received' ? 'passed' : 'failed', responseDelayMs: r.status === 'received' ? r.receivedAt - r.sentAt : null, delayBasis: 'browser_observed' });
      if (action === 'end') { run.state = run.scenario ? (run.results.length < run.scenario.prompts.length || run.results.some(r => r.status !== 'received') ? 'failed' : 'completed') : 'ended'; run.cleanupState = 'complete'; }
      return json({ run });
    }
    if (api === '/api/rooms' || api === '/api/agents/live') return json([]);
    return json({ rows: [], total: 0, items: [] });
  });
  return { page, requests, writes };
}
async function check(name, fn) { await fn(); passed.push(name); console.log('PASS', name); }
async function ready(page) { await page.goto(base + '/agent-testing'); await page.getByLabel('Source agent').selectOption('named-agent'); }
async function start(page, scenario = false) { if (scenario) await page.getByLabel('Scenario', { exact: true }).selectOption('scenario-1'); await page.getByRole('button', { name: 'Start test', exact: true }).click(); await page.getByRole('button', { name: 'Enable microphone', exact: true }).waitFor(); await page.waitForFunction(() => window.phase6RTC.connects.length > 0); }
try {
  await check('deployment allowlists, confirmation, progress, bounded logs and write-only secrets', async () => {
    const { page, requests, writes } = await setup();
    await page.goto(base + '/deployments?target=managed');
    await page.getByRole('heading', { name: 'Managed fixture', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'named-agent', exact: true }).getAttribute('href'), '/agents/agent-id');
    assert.ok(!(await page.locator('body').innerText()).includes('Invalid Date'));
    assert.equal(writes.length, 0);
    assert.equal(await page.getByRole('button', { name: 'Deploy', exact: true }).isDisabled(), true);
    await page.getByLabel('Allowed image').selectOption('fixture:new');
    for (const action of ['Build', 'Deploy', 'Drain', 'Rollback', 'Reconcile']) {
      await page.getByRole('button', { name: action, exact: true }).click();
      const previous = writes.length;
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click(); assert.equal(writes.length, previous);
      await page.getByRole('button', { name: action, exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: `Confirm ${action.toLowerCase()}` }).click();
      await page.getByText(/Health checked; registration unknown/).waitFor();
      await page.waitForFunction(action => document.querySelector('.toast')?.innerText.includes('Operation submitted') || !Array.from(document.querySelectorAll('button')).find(b => b.textContent === action)?.disabled, action);
      await page.waitForResponse(r => r.url().includes('/deployments/targets') && r.request().method() === 'GET').catch(() => {});
      const write = writes.at(-1); assert.equal(write.body.action, action.toLowerCase()); assert.equal(write.body.confirm, 'managed'); assert.ok(write.body.requestId); assert.deepEqual(Object.keys(write.body).sort(), ['action','confirm',...(action === 'Deploy' ? ['image'] : []),'requestId'].sort());
    }
    assert.equal(requests.some(r => r.raw.endsWith('/logs')), false);
    await page.getByRole('button', { name: 'Read logs', exact: true }).click(); await page.getByText('bounded safe output', { exact: true }).waitFor();
    assert.ok(requests.some(r => r.search === '?kind=runtime&lines=200'));
    await page.getByRole('button', { name: 'Update secrets' }).click(); await page.getByLabel('API_KEY', { exact: true }).fill('private-value');
    await page.getByRole('button', { name: 'Save secrets', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save secrets', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[type=password]').value === '');
    assert.deepEqual(writes.find(w => w.method === 'PUT').body, { values: { API_KEY: 'private-value' }, confirm: 'managed' });
    assert.ok(!await page.locator('body').innerText().then(t => t.includes('private-value')));
    assert.ok(requests.every(r => r.raw.startsWith('/api/')));
    await page.setViewportSize({ width: 375, height: 812 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.close();
  });
  await check('read-only, absent helper, unavailable helper and role/content grants', async () => {
    for (const options of [{ readonly: true }, { unconfigured: true }, { unavailable: true }, { role: 'viewer' }]) {
      const { page, writes, requests } = await setup(options); await page.goto(base + '/deployments?target=managed');
      await page.getByText(options.readonly ? 'This target is read-only. Managed actions are not enabled.' : options.unconfigured ? 'Deployment helper is not configured for this server.' : options.unavailable ? /Deployment helper unavailable/ : 'Administrator access is required.').waitFor();
      assert.equal(writes.length, 0); assert.equal(await page.getByRole('button', { name: 'Update secrets' }).count(), 0);
      if (options.role) assert.ok(!requests.some(r => r.raw.includes('/deployments/'))); await page.close();
    }
    for (const options of [{ role: 'viewer' }, { caps: { transcripts: false } }]) {
      const { page, requests } = await setup(options); await page.goto(base + '/agent-testing'); await page.getByText('Administrator and transcripts access are required for agent tests.').waitFor(); assert.ok(!requests.some(r => r.raw.includes('/agent-tests/'))); await page.close();
    }
    const { page, requests } = await setup({ caps: { logs: false } }); await ready(page);
    assert.equal(await page.getByRole('button', { name: 'Compare runs' }).count(), 0); assert.ok(!requests.some(r => r.raw.endsWith('/compare')));
    await page.goto(base + '/deployments?target=managed'); await page.getByText('Logs access is required to read deployment logs.').waitFor(); assert.ok(!requests.some(r => r.raw.endsWith('/logs'))); await page.close();
  });
  await check('scenario create/edit strips server fields and enforces ordered prompt bounds', async () => {
    const { page, writes } = await setup(); await ready(page);
    await page.getByRole('button', { name: 'Create scenario', exact: true }).click(); await page.getByLabel('Scenario name', { exact: true }).fill('New scenario'); await page.getByLabel('Prompt text 1', { exact: true }).fill('hello');
    await page.getByRole('button', { name: 'Save scenario', exact: true }).click(); await page.getByRole('heading', { name: 'New scenario', exact: true }).waitFor();
    assert.deepEqual(writes.find(w => w.raw.endsWith('/scenarios')).body, { name: 'New scenario', prompts: [{ text: 'hello', timeoutSeconds: 30 }] });
    await page.getByRole('button', { name: 'Edit Greeting', exact: true }).click(); await page.getByLabel('Prompt text 1', { exact: true }).fill('Edited hello'); await page.getByRole('button', { name: 'Save scenario', exact: true }).click(); await page.getByText('Revision 2 · 2 prompts', { exact: true }).waitFor(); assert.ok(writes.some(w => w.method === 'PATCH'));
    await page.close();
  });
  await check('RTC uses owned credentials, user microphone/audio, chat topic, native and stream receive, cleanup', async () => {
    const { page, writes } = await setup(); await ready(page); await page.getByLabel('Requested deployment snapshot').selectOption('managed'); await start(page);
    assert.deepEqual(writes.find(w => w.raw.endsWith('/runs')).body, { agentName: 'named-agent', deploymentId: 'managed' });
    assert.deepEqual(await page.evaluate(() => window.phase6RTC.mic), []);
    assert.deepEqual(await page.evaluate(() => window.phase6RTC.connects[0]), { wsUrl: 'wss://rtc.example.invalid', token: 'short-room-token' });
    await page.getByRole('button', { name: 'Enable audio playback' }).click(); await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.phase6RTC.mic), [true]);
    await page.getByLabel('Message', { exact: true }).fill('hello'); await page.getByRole('button', { name: 'Send text', exact: true }).click(); await page.getByText('hello observed answer', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.phase6RTC.sent[0].topic), 'lk.chat');
    await page.evaluate(() => { window.phase6RTC.mode = 'native'; }); await page.getByLabel('Message', { exact: true }).fill('native'); await page.getByRole('button', { name: 'Send text', exact: true }).click(); await page.getByText('hello native answer', { exact: true }).waitFor();
    assert.equal(await page.locator('body').innerText().then(t => t.includes('Selected agent answered')), false);
    const telemetry = await page.getByRole('link', { name: /Open retained correlated telemetry/ }).getAttribute('href'); assert.ok(telemetry.includes('RM_run-1') && !new URL(telemetry, base).searchParams.has('project'));
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click(); await page.waitForFunction(() => window.phase6RTC.connects.length === 2); assert.equal(await page.evaluate(() => window.phase6RTC.connects[1].token), 'refreshed-room-token');
    await page.getByRole('link', { name: 'Deployments', exact: true }).click(); await page.getByRole('heading', { name: 'Deployments', exact: true }).waitFor(); assert.ok(writes.some(w => w.raw.endsWith('/run-1/end'))); assert.ok(await page.evaluate(() => window.phase6RTC.disconnects >= 2));
    await page.close();
  });
  await check('scenario sequential actual responses, failure states, self echo cannot pass and no fake zero delays', async () => {
    for (const mode of ['stream', 'native', 'duplicate', 'failed', 'disconnect', 'echo', 'unknown', 'user', 'timeout']) {
      const { page, writes } = await setup(); await ready(page); await start(page, true); await page.evaluate(mode => { window.phase6RTC.mode = mode; }, mode);
      if (mode === 'disconnect') await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
      await page.getByRole('button', { name: 'Run scenario prompts', exact: true }).click();
      await page.waitForFunction(() => /cleanup/i.test(document.body.innerText) && /\bcomplete\b/.test(document.body.innerText), null, { timeout: 16000 });
      const records = writes.filter(w => w.raw.endsWith('/results')).flatMap(w => w.body.results);
      if (['stream','native','duplicate'].includes(mode)) { assert.equal(records.length, 2); assert.deepEqual(records.map(r => r.promptIndex), [0,1]); assert.ok(records.every(r => r.status === 'received')); assert.ok(records.every(r => r.source === (mode === 'native' ? 'transcription' : 'lk.transcription'))); if (mode === 'duplicate') assert.deepEqual(records.map(r => r.responseText), ['hello first answer','hello second answer']); }
      else { assert.equal(records.length, 1); assert.equal(records[0].status, mode === 'disconnect' ? 'disconnected' : mode === 'failed' ? 'failed' : 'timeout'); assert.ok(!('responseText' in records[0])); await page.getByText('Browser-observed delay: No data', { exact: true }).waitFor(); }
      if (mode === 'disconnect') { await page.getByText('Microphone: Off', { exact: true }).waitFor(); assert.deepEqual(await page.evaluate(() => window.phase6RTC.mic), [true, false]); }
      await page.close();
    }
  });

  await check('route navigation disconnects microphone and ends the owned room', async () => {
    const { page, writes } = await setup(); await ready(page); await start(page);
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await page.evaluate(() => { window.savedRTC = window.phase6RTC; window.savedRoom = window.phase6Room; history.pushState({}, '', '/deployments'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByRole('heading', { name: 'Deployments', exact: true }).waitFor();
    await page.waitForFunction(() => !window.savedRoom.localParticipant.isMicrophoneEnabled);
    assert.ok(writes.some(w => w.raw === '/api/agent-tests/runs/run-1/end'));
    assert.ok(await page.evaluate(() => window.savedRTC.disconnects > 0)); await page.close();
  });
  await check('compare compatibility/provenance/no-data and responsive layout', async () => {
    for (const incompatible of [false, true]) {
      const { page, requests } = await setup({ incompatible }); await ready(page); await page.getByLabel('Left run', { exact: true }).selectOption('past-left'); await page.getByLabel('Right run', { exact: true }).selectOption('past-right'); await page.getByRole('button', { name: 'Compare runs', exact: true }).click();
      await page.getByText(incompatible ? /Incompatible or unavailable expectations/ : /Same scenario revision: expectations are compatible/).waitFor(); await page.getByText(/Unverified version provenance/).waitFor();
      assert.equal(await page.getByText('e2e_latency: No data', { exact: true }).count(), 2); assert.equal(await page.getByText('llm_ttft: p50 0 ms · p95 0 ms · 1 samples', { exact: true }).count(), 2);
      assert.ok(requests.some(r => r.raw === '/api/agent-tests/compare'));
      await page.setViewportSize({ width: 375, height: 812 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: '/tmp/phase6-ui-mobile.png' }); await page.close();
    }
  });
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: passed.length, pageErrors: errors.length }));
} catch (e) { for (const context of browser.contexts()) for (const page of context.pages()) console.error('FAILED PAGE', page.url(), (await page.locator('body').innerText()).slice(-6000)); throw e; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(dist, { recursive: true, force: true }); }
