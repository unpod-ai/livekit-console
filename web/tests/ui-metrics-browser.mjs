// Local, isolated fixture tests. Run after npm run build -w web.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node web/tests/ui-metrics-browser.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Other UI work may rebuild web/dist while this suite is running. Serve a private snapshot.
const dist = await mkdtemp(path.join(tmpdir(), 'ui-metrics-dist-'));
await cp(fileURLToPath(new URL('../dist/', import.meta.url)), dist, { recursive: true });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const file = url.pathname.startsWith('/assets/') ? path.join(dist, 'assets', path.basename(url.pathname)) : ['/theme.js','/brand.svg'].includes(url.pathname) ? path.join(dist, url.pathname.slice(1)) : path.join(dist, 'index.html');
  try { const data = await readFile(file); res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html'); res.end(data); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
const now = Date.now(), bucketMs = 3600000, bucket = Math.floor((now - 10000) / bucketMs) * bucketMs;
const models = [
  { type: 'llm_usage', provider: 'Example', model: 'language', metrics: { input_tokens: 120, output_tokens: 30, input_cached_tokens: 20, input_audio_tokens: 10, session_duration: 0 } },
  { type: 'stt_usage', provider: 'Example', model: 'recognizer', metrics: { audio_duration: 12.5, input_tokens: 0, output_tokens: 0, input_audio_tokens: 0 } },
  { type: 'tts_usage', provider: 'Example', model: 'speaker', metrics: { audio_duration: 3.5, characters_count: 50, input_tokens: 0, output_tokens: 0 } },
  { type: 'eot_usage', provider: 'Example', model: 'detector', metrics: { total_requests: 4 } },
];
const items = [
  { id: 'user', type: 'message', role: 'user', at: now - 5000, metrics: { e2e_latency: 99 }, text: 'User timing must not contribute' },
  ...[.1, .3, .8, 1.5].map((value, i) => ({ id: `turn-${i}`, type: 'message', role: 'assistant', at: now - 4000 + i * 1000, turnId: `T${i}`, traceId: 'a'.repeat(32), text: `Assistant ${i}`, interrupted: i === 2, isError: i === 3, metrics: { e2e_latency: value, ...(i === 1 ? { llm_node_ttft: .05 } : {}) } })),
  { id: 'invalid', type: 'message', role: 'assistant', at: null, metrics: { tts_node_ttfb: -1 }, text: 'Missing timing' },
];
const report = { roomSid: 'RM_metrics', jobId: 'AJ_metrics', agentName: 'metrics-agent', reportedAt: now, receivedAt: now, expiresAt: now + 86400000, state: 'complete', content: { schemaVersion: 2, items, omittedItems: 0, usage: models, omittedUsage: 1 } };
const group = { agentName: 'metrics-agent', count: 4, p50: 300, p90: 1500, p95: 1500, p99: 1500 };
const sample = { id: 'native-sample', roomSid: 'RM_metrics', jobId: 'AJ_metrics', agentName: 'metrics-agent', itemId: 'span-record', at: now - 2000, valueMs: 800, metric: 'tts_duration', source: 'native_span', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), turnId: 'T2', interrupted: true, isError: false };
const wav = Buffer.alloc(44 + 8000 * 8 * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
const errors = [], passed = [];
async function setup({ empty = false, expired = false, transcripts = true, recording = false, theme = 'dark' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(theme => { localStorage.setItem('lkc.theme', theme); localStorage.setItem('lkc.range', '24'); }, theme);
  const requests = [];
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), api = url.pathname;
    if (api === '/branding.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'Example Console', domain: '', logoUrl: '/brand.svg', faviconUrl: '/brand.svg' }) });
    if (!api.startsWith('/api/')) return route.continue();
    requests.push({ api, search: url.search, method: req.method() });
    const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    if (api === '/api/auth/me') return json({ user: 'metrics', role: 'viewer', capabilities: { transcripts, recordings: recording, logs: false } });
    if (api === '/api/config') return json({ wsUrl: 'wss://invalid.example' });
    if (api === '/api/rooms' || api === '/api/agents/live') return json([]);
    if (api === '/api/inventory/agents/metrics-agent') return json({ agent: { id: 'metrics-agent', name: 'metrics-agent', aliases: [] }, workers: [], former: [] });
    if (api === '/api/history/agents/metrics-agent') return json({ sessions: [] });
    if (api.endsWith('/overview')) return json({ sessions: [], joinLatency: [] });
    if (api === '/api/agent-insights/agents/metrics-agent/usage') {
      const filter = url.searchParams.get('model');
      const active = filter ? models.filter(m => JSON.stringify([m.type,m.provider,m.model]) === filter) : models;
      return json({ enabled: true, from: now - 86400000, to: now, bucketMs, coverage: { totalReports: 5, retainedReports: 4, usageReports: 2, missingUsageReports: 1, emptyUsageReports: 1, expiredReports: 1, omittedUsage: 1 }, models: empty ? [] : models, series: [{ t: bucket, llmInput: active.some(m=>m.type==='llm_usage') ? 120 : 0, llmOutput: active.some(m=>m.type==='llm_usage') ? 30 : 0, sttAudio: active.some(m=>m.type==='stt_usage') ? 12.5 : 0, ttsAudio: active.some(m=>m.type==='tts_usage') ? 3.5 : 0 }], reports: [{ roomSid: 'RM_metrics', jobId: 'AJ_metrics', reportedAt: now, expiresAt: now + 86400000, sessionAvailable: true }], totalContributingReports: 1, page: 1, pageSize: 25 });
    }
    if (api === '/api/agent-insights/analytics') return json({ from: Number(url.searchParams.get('from')), to: Number(url.searchParams.get('to')), bucketMs, metric: url.searchParams.get('metric'), metricLabel: url.searchParams.get('metric') === 'tts_duration' ? 'TTS node duration' : 'Response latency', agents: ['metrics-agent'], groups: empty ? [] : [group], series: empty ? [] : [{ ...group, t: bucket }], stages: empty ? [] : [{ metric: 'tts_duration', label: 'TTS node duration', groups: [group] }], models: empty ? [] : models, usageCoverage: { totalReports: 5, usageReports: 2, expiredReports: 1, missingUsageReports: 1 }, modelsByAgent: [], totalSamples: empty ? 0 : 4, totalContributors: empty ? 0 : 1, rows: empty ? [] : [sample], selected: url.searchParams.has('sample') ? sample : null, bucket: url.searchParams.has('bucket') ? Number(url.searchParams.get('bucket')) : null, page: 1, pageSize: 25 });
    if (api === '/api/history/sessions/RM_metrics') return json({ session: { room_sid: 'RM_metrics', room_name: 'Metric fixture', started_at: now - 10000, ended_at: now }, participants: [], events: [], egress: [], timeline: [], calls: [] });
    if (api === '/api/agent-insights/sessions/RM_metrics') return json({ enabled: true, retentionDays: 30, total: 1, reports: [report], selected: expired ? { ...report, state: 'expired', content: null } : empty ? { ...report, content: { ...report.content, items: [], usage: [] } } : report });
    if (api === '/api/recordings/sessions/RM_metrics') return json({ files: recording ? [{ id: 'EG_metrics/0', egressId: 'EG_metrics', index: 0, name: 'test.wav', source: 'egress', state: 'ready', mime: 'audio/wav', startMs: now - 6000, durationMs: 8000, size: wav.length }] : [], accessDays: 30 });
    if (api.startsWith('/api/recordings/')) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers().range ?? '');
      if (range) { const start = Number(range[1]), end = Math.min(wav.length - 1, range[2] ? Number(range[2]) : wav.length - 1); return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${wav.length}` }, body: wav.subarray(start,end+1) }); }
      return route.fulfill({ contentType: 'audio/wav', body: wav });
    }
    if (api === '/api/history/usage') return json({ bucketMs, totals: { agentSessionMinutes: 15, webrtcParticipantMinutes: 20, sipParticipantMinutes: 4, sipInboundMinutes: 2, sipOutboundMinutes: 2, sipInboundCalls: 1, sipOutboundCalls: 1, roomSessions: 4, avgRoomSize: 2, avgRoomDurationMs: 3000, egressByType: { room: { count: 1, minutes: 3 } } }, series: [{ t: bucket, agentMin: 15, webrtcMin: 20, sipInMin: 2, sipOutMin: 2, sessions: 4, egressMin: 3 }] });
    return json({ rows: [], total: 0, items: [] });
  });
  return { page, requests };
}
async function check(name, fn) { await fn(); passed.push(name); console.log(`PASS ${name}`); }
const kpi = (page, label) => page.locator('.kpi').filter({ has: page.locator('.kpi-label', { hasText: label }) }).locator('.kpi-value');
async function contained(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${page.url()}`); }
try {
  await check('Performance chart first, global range and collapsed advanced controls', async () => {
    const { page, requests } = await setup(); await page.goto(base + '/agent-analytics');
    await page.getByRole('heading', { name: 'Latency over time' }).waitFor();
    assert.equal(await page.getByLabel('Performance from').isVisible(), false);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await kpi(page, 'metrics-agent · Response latency p50').innerText(), '300 ms');
    assert.equal(await page.locator('main .panel:visible').first().locator('h2').innerText(), 'Latency over time');
    const request = requests.find(r => r.api.endsWith('/analytics'));
    const q = new URLSearchParams(request.search); assert.equal(Number(q.get('to')) - Number(q.get('from')), 86400000);
    await page.getByTitle('Time range', { exact: true }).click();
    await Promise.all([page.waitForResponse(r => r.url().includes('/analytics?') && Number(new URL(r.url()).searchParams.get('to')) - Number(new URL(r.url()).searchParams.get('from')) === 21600000), page.getByRole('menuitemradio', { name: 'Past 6 hours' }).click()]);
    await page.getByText('Advanced filters', { exact: true }).click(); await page.getByLabel('Performance from').waitFor({ state: 'visible' });
    await page.getByText('Advanced filters', { exact: true }).click();
    await page.getByRole('button', { name: 'TTS node duration', exact: true }).click();
    await page.waitForURL(u=>u.searchParams.get('perfMetric')==='tts_duration');
    await page.getByRole('button', { name: `Inspect metrics-agent bucket ${bucket}` }).focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor(); assert.equal(new URL(page.url()).searchParams.get('perfBucket'), String(bucket));
    await page.reload(); await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: '800.00 ms', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Contributing measurement', exact: true }); await dialog.waitFor();
    const href = await dialog.getByRole('link', { name: 'Open session at measurement' }).getAttribute('href');
    const selection = new URL(href, base).searchParams; assert.equal(selection.get('insightView'), 'traces'); assert.equal(selection.get('selectedSpan'), sample.spanId); assert.equal(selection.get('selectedRecord'), sample.itemId); assert.equal(selection.get('mediaAt'), String(sample.at));
    await page.goBack(); await page.getByRole('button', { name: '800.00 ms', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    await contained(page); await page.close();
  });
  await check('Model tables separate speech counters and LLM subsets; agent headlines match retained usage', async () => {
    const { page } = await setup(); await page.goto(base + '/agents/metrics-agent?tab=usage');
    await page.getByRole('heading', { name: 'LLM tokens', exact: true }).waitFor();
    assert.equal(await kpi(page, 'LLM input tokens').innerText(), '120'); assert.equal(await kpi(page, 'STT audio seconds').innerText(), '12.5');
    const llm = page.getByRole('region', { name: 'LLM tokens', exact: true });
    assert.equal(await llm.getByRole('columnheader', { name: 'Audio seconds' }).count(), 0);
    const stt = page.getByRole('region', { name: 'Speech recognition (STT)', exact: true });
    assert.equal(await stt.getByRole('columnheader', { name: 'Input tokens', exact: true }).count(), 0);
    assert.equal(await stt.getByRole('columnheader', { name: 'Characters' }).count(), 0);
    await llm.getByText('Additional counters', { exact: true }).click(); await llm.getByText('input audio tokens: 10', { exact: true }).waitFor();
    await page.getByText(/Coverage is incomplete:/).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: 'Contributing reports (1)' }).click(); await page.getByRole('dialog').waitFor();
    await page.reload(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
    await page.getByLabel('Usage model').selectOption(JSON.stringify(['tts_usage','Example','speaker']));
    await page.getByRole('heading', { name: 'Speech synthesis (TTS)', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'LLM tokens by report time', exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'LLM tokens', exact: true }).count(), 0);
    await page.reload(); assert.equal(await page.getByLabel('Usage model').inputValue(), JSON.stringify(['tts_usage','Example','speaker']));
    await page.close();
  });
  await check('Session nearest-rank p50, accessible distribution, URL turn selection and recording seek', async () => {
    const { page } = await setup({ recording: true }); await page.goto(base + '/sessions/RM_metrics?tab=insights&insightView=metrics');
    await page.getByRole('heading', { name: 'Turn latency', exact: true }).waitFor();
    assert.equal(await kpi(page, 'Response latency · p50').innerText(), '300 ms');
    assert.equal(await kpi(page, 'Measured turns').innerText(), '4');
    assert.equal(await page.getByLabel('Session metric').locator('option').count(), 2);
    const button = page.getByRole('button', { name: 'Select turn turn-2: 800 ms', exact: true }); await button.focus(); await page.keyboard.press('Space');
    await page.waitForURL(u => u.searchParams.get('reportItem') === 'turn-2');
    assert.equal(new URL(page.url()).searchParams.get('liveTurn'), 'T2');
    await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 4) < .1);
    await page.reload(); await page.waitForFunction(() => Math.abs(document.querySelector('video')?.currentTime - 4) < .1);
    await page.getByRole('button', { name: /^Inspect distribution 1:/ }).click();
    assert.equal(new URL(page.url()).searchParams.get('sessionMetricBand'), '0');
    await page.getByLabel('Metric turn', { exact: true }).selectOption('turn-3');
    await page.waitForURL(u => !u.searchParams.has('sessionMetricBand') && u.searchParams.get('reportItem') === 'turn-3');
    await page.getByLabel('Session metric').selectOption('llm_node_ttft');
    assert.equal(await kpi(page, 'LLM first token · p50').innerText(), '50 ms');
    assert.equal(await page.getByRole('button', { name: 'Select turn turn-0: 100 ms', exact: true }).count(), 0);
    await page.reload(); assert.equal(await page.getByLabel('Session metric').inputValue(), 'llm_node_ttft');
    await page.goBack(); await page.getByLabel('Session metric').waitFor();
    await page.close();
  });
  await check('Transcript shows source turn timings inline and opens the exact turn metric', async () => {
    const { page } = await setup({ recording: true }); await page.goto(base + '/sessions/RM_metrics?tab=insights');
    const row = page.locator('.insights-turn').filter({ has: page.getByRole('button', { name: 'Inspect report item turn-1', exact: true }) });
    await row.getByRole('button', { name: 'LLM TTFT: 50 ms', exact: true }).waitFor();
    assert.match(await row.innerText(), /STT delay.*Not reported/s);
    assert.equal(await page.locator('.insights-turn').filter({ has: page.getByRole('button', { name: 'Inspect report item user', exact: true }) }).getByRole('button', { name: /Response:/ }).count(), 0);
    assert.equal(await page.locator('.insights-turn').filter({ has: page.getByRole('button', { name: 'Inspect report item invalid', exact: true }) }).getByRole('button', { name: /TTS TTFB:/ }).count(), 0);
    await row.getByRole('button', { name: 'LLM TTFT: 50 ms', exact: true }).click();
    await page.getByRole('heading', { name: 'Turn latency', exact: true }).waitFor();
    const params = new URL(page.url()).searchParams; assert.equal(params.get('reportItem'), 'turn-1'); assert.equal(params.get('sessionMetric'), 'llm_node_ttft');
    await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 3) < .1);
    await page.goBack(); await row.getByRole('button', { name: 'LLM TTFT: 50 ms', exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/turn-latency-transcript-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 375, height: 950 }); await contained(page);
    await page.screenshot({ path: '/tmp/turn-latency-transcript-mobile.png', fullPage: true });
    await page.close();
  });
  await check('Reported STT/end-of-turn/callback timings and valid zero values remain distinct', async () => {
    const { page } = await setup();
    const measured = { ...items[2], metrics: { e2e_latency: 0, llm_node_ttft: 0, tts_node_ttfb: .2, transcription_delay: .07, end_of_turn_delay: .08, on_user_turn_completed_delay: .04 } };
    const selected = { ...report, content: { ...report.content, items: [measured, { ...items[0], metrics: { e2e_latency: 99, llm_node_ttft: 99, transcription_delay: .12, end_of_turn_delay: .2 } }] } };
    await page.route(/\/api\/agent-insights\/sessions\/RM_metrics(?:\?|$)/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, retentionDays: 30, total: 1, reports: [selected], selected }) }));
    await page.goto(base + '/sessions/RM_metrics?tab=insights');
    const row = page.locator('.insights-turn').first();
    for (const name of ['Response: 0 ms','LLM TTFT: 0 ms','TTS TTFB: 200 ms','STT delay: 70 ms','End of turn: 80 ms','Turn callback: 40 ms']) await row.getByRole('button', { name, exact: true }).waitFor();
    await page.getByText('Models & timing coverage', { exact: true }).click();
    await page.getByText('Models are reported for this job as a whole; the report does not attribute a model to each turn.', { exact: true }).waitFor();
    await row.getByRole('button', { name: 'Turn callback: 40 ms', exact: true }).click();
    assert.equal(await kpi(page, 'Turn callback delay · p50').innerText(), '40 ms');
    await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
    await page.getByRole('dialog', { name: 'Conversation details', exact: true }).waitFor(); await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'detached'});
    const user = page.locator('.insights-turn').filter({ has: page.getByRole('button', { name: 'Inspect report item user', exact: true }) });
    await user.getByRole('button', { name: 'STT delay: 120 ms', exact: true }).click();
    assert.equal(await page.getByLabel('Session metric').inputValue(), 'transcription_delay');
    assert.equal(await kpi(page, 'Measured turns').innerText(), '2');
    assert.equal(new URL(page.url()).searchParams.get('reportItem'), 'user');
    await page.close();
  });
  await check('Agent overview exposes measured stage latency and links to its scoped metric', async () => {
    const { page, requests } = await setup(); await page.goto(base + '/agents/metrics-agent');
    const panel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Model & response latency', exact: true }) });
    await panel.getByRole('button', { name: 'Inspect TTS node duration', exact: true }).waitFor();
    const req = requests.find(r => r.api.endsWith('/analytics')); assert.deepEqual(JSON.parse(new URLSearchParams(req.search).get('agents')), ['metrics-agent']);
    await panel.getByRole('button', { name: 'Inspect TTS node duration', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'performance'); assert.equal(new URL(page.url()).searchParams.get('perfMetric'), 'tts_duration');
    await page.getByRole('tab', { name: 'Latency', exact: true }).first().waitFor();
    await page.close();
  });
  await check('Denied transcript access does not request agent latency or expose its summaries', async () => {
    const { page, requests } = await setup({ transcripts: false }); await page.goto(base + '/agents/metrics-agent');
    await page.getByRole('heading', { name: 'Sessions served', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Model & response latency', exact: true }).count(), 0);
    assert.ok(!requests.some(r=>r.api.endsWith('/analytics'))); await page.close();
  });
  await check('Night canvas restores the neutral near-black palette and light mode stays separate', async () => {
    for (const theme of ['dark', 'light']) {
      const { page } = await setup({ theme }); await page.goto(base + '/sessions/RM_metrics?tab=insights');
      await page.getByRole('heading', { name: 'Conversation', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), theme === 'dark' ? 'rgb(7, 7, 7)' : 'rgb(248, 250, 251)');
      await page.close();
    }
  });
  await check('Usage categories survive back/reload and preserve unrelated range parameters', async () => {
    const { page } = await setup(); await page.goto(base + '/usage?trafficDays=7');
    await page.getByRole('tab', { name: 'Telephony', exact: true }).click();
    await page.getByRole('heading', { name: 'Telephony', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('trafficDays'), '7');
    assert.equal(await page.getByRole('heading', { name: 'Participants', exact: true }).count(), 0);
    await page.reload(); await page.getByRole('tab', { name: 'Telephony', selected: true }).waitFor();
    await page.getByRole('tab', { name: 'Rooms', exact: true }).click(); await page.goBack(); await page.getByRole('tab', { name: 'Telephony', selected: true }).waitFor();
    await page.close();
  });
  await check('Empty/expired metrics and denied transcript access do not invent data', async () => {
    for (const options of [{ empty: true }, { expired: true }, { transcripts: false }]) {
      const { page, requests } = await setup(options); await page.goto(base + '/sessions/RM_metrics?tab=insights&insightView=metrics');
      await page.getByText(options.empty ? 'No turn timings reported' : options.expired ? 'Session metrics expired' : 'Transcript access is required to view agent reports.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Turn latency', exact: true }).count(), 0);
      if (!options.transcripts && 'transcripts' in options) assert.ok(!requests.some(r => r.api.startsWith('/api/agent-insights/')));
      await page.close();
    }
  });
  await check('Desktop/mobile light/dark populated and empty metrics contain layout and preserve branding', async () => {
    for (const theme of ['light', 'dark']) for (const empty of [false, true]) {
      const { page } = await setup({ theme, empty });
      for (const route of ['/agent-analytics','/agents/metrics-agent?tab=usage','/usage?usageCategory=telephony','/sessions/RM_metrics?tab=insights&insightView=metrics']) {
        await page.goto(base + route); await page.locator('main').waitFor();
        if (route.startsWith('/sessions')) await page.getByText(empty ? 'No turn timings reported' : 'Turn latency', { exact: true }).waitFor();
        else if (route.startsWith('/agents')) await page.getByText('Usage filter', { exact: true }).waitFor();
        else if (route.startsWith('/agent-analytics')) await (empty?page.getByText('No measured agent latency',{exact:true}):page.getByRole('heading',{name:'Latency over time'})).waitFor();
        else await page.getByRole('heading', { name: 'Telephony', exact: true }).waitFor();
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(350); await contained(page);
          assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
          for (const bar of await page.locator('.metrics-bar').all()) { const box=await bar.boundingBox(); if(box) assert.ok(box.x+box.width<=width+1, 'Metric chart exceeds viewport'); }
          await page.screenshot({ path: `/tmp/ui-metrics-${theme}-${empty?'empty':'populated'}-${width}-${route.split('?')[0].split('/')[1]}.png`, fullPage: true });
        }
      }
      assert.ok((await page.title()).includes('Example Console'));
      await page.close();
    }
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: passed.length, pageErrors: errors.length }));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) console.error('FAILED PAGE', page.url(), (await page.locator('body').innerText()).slice(0, 5000));
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(dist, { recursive: true, force: true }); }
