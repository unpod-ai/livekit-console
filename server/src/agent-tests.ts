import express, { Router, type ErrorRequestHandler } from 'express';
import { AccessToken, RoomAgentDispatch, TrackSource } from 'livekit-server-sdk';
import { rooms } from './livekit.js';
import { config } from './config.js';
import { authOf, requireAuth, requireAdmin, requireContent } from './auth.js';
import { AgentTestError, object, keys, boundedText, agentTestProcessId, listScenarios, saveScenario, deleteScenario, scenarioById, createRun, runRow, readRun, listRuns, activateRun, setCleanup, failRun, isActive, saveResults, endRun, maintainAgentTestContent, pendingCleanup, type RequestedDeployment } from './agent-test-store.js';
export { maintainAgentTestContent, deleteAgentTestContent, scrubAgentTestContent, agentTestStorage, exportAgentTestContent } from './agent-test-store.js';

export const agentTests = Router();
const cleanupInFlight = new Map<string, Promise<void>>();
function ownedName(row: Record<string, any>) { return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.id) && row.room_name === 'console-test-' + row.id; }
async function ownedRoom(row: Record<string, any>) {
  if (!ownedName(row)) throw new AgentTestError('Room ownership cannot be verified', 409);
  const found = (await rooms.listRooms([row.room_name])).find(r => r.name === row.room_name);
  if (!found) return null;
  let metadata: Record<string, unknown> = {}; try { metadata = JSON.parse(found.metadata); } catch { /* fail closed */ }
  if ((row.room_sid && found.sid !== row.room_sid) || metadata.consoleTestRunId !== row.id) throw new AgentTestError('Room ownership cannot be verified', 409);
  return found;
}
async function cleanup(id: string) {
  const running = cleanupInFlight.get(id); if (running) return running;
  const work = (async () => {
    const row = runRow(id);
    if (isActive(row) || row.cleanup_state === 'complete') return;
    try { const room = await ownedRoom(row); if (room) await rooms.deleteRoom(row.room_name); setCleanup(id, 'complete'); }
    catch { setCleanup(id, 'failed'); }
  })();
  cleanupInFlight.set(id, work);
  try { await work; } finally { cleanupInFlight.delete(id); }
}
export async function maintainAgentTests(at = Date.now()) {
  maintainAgentTestContent(at);
  for (const row of pendingCleanup()) await cleanup(row.id);
}
// Expiry is a server responsibility even after the browser closes. Import does not contact LiveKit.
const maintenance = setInterval(() => { void maintainAgentTests().catch(() => console.error('Agent test maintenance failed')); }, 60000);
maintenance.unref();
function telemetryAllowed(req: express.Request) { const auth = authOf(req); return auth.capabilities ? auth.capabilities.logs : auth.role === 'admin'; }
function pagination(value: unknown, fallback: number, max: number) { if (value === undefined) return fallback; if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) > max) throw new AgentTestError('Invalid pagination'); return Number(value); }
const asyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler => (req, res, next) => { void handler(req, res).catch(next); };
agentTests.use(requireAuth, requireAdmin, requireContent('transcripts'), (_req, res, next) => { res.set('Cache-Control', 'no-store'); maintainAgentTestContent(); next(); }, express.json({ limit: '384kb' }));
agentTests.get('/scenarios', (_req, res) => res.json({ rows: listScenarios() }));
agentTests.post('/scenarios', (req, res) => res.status(201).json(saveScenario(req.body)));
agentTests.patch('/scenarios/:id', (req, res) => res.json(saveScenario(req.body, req.params.id)));
agentTests.delete('/scenarios/:id', (req, res) => { deleteScenario(req.params.id); res.json({ deleted: true }); });
agentTests.get('/runs', (req, res) => { const limit = pagination(req.query.limit, 50, 100), offset = pagination(req.query.offset, 0, 10000); if (!limit) throw new AgentTestError('Invalid limit'); res.json({ rows: listRuns(limit, offset), limit, offset }); });
agentTests.get('/runs/:id', (req, res) => res.json({ run: readRun(req.params.id, telemetryAllowed(req)) }));
agentTests.post('/runs', asyncRoute(async (req, res) => {
  const body = object(req.body); keys(body, ['agentName', 'scenarioId', 'deploymentId']);
  const agentName = boundedText(body.agentName, 'agent name');
  const scenarioId = body.scenarioId === undefined ? null : boundedText(body.scenarioId, 'scenario ID');
  let requestedDeployment: RequestedDeployment | null = null;
  if (body.deploymentId !== undefined) {
    const id = boundedText(body.deploymentId, 'deployment ID');
    const { deploymentTargetSnapshot } = await import('./deployments.js');
    let snapshot: RequestedDeployment;
    try { snapshot = await deploymentTargetSnapshot(id); }
    catch (error) {
      const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' && [400,403,404,409,422,502,503].includes(error.status) ? error.status : 502;
      throw new AgentTestError(status === 503 ? 'Deployment integration is not configured or unavailable' : status === 404 ? 'Deployment target not found' : 'Could not read deployment target', status);
    }
    if (snapshot.agentName !== agentName) throw new AgentTestError('Deployment does not match selected agent');
    requestedDeployment = { id: snapshot.id, agentName: snapshot.agentName, image: snapshot.image, imageId: snapshot.imageId, version: snapshot.version, observedAt: snapshot.observedAt };
  }
  // Re-read after asynchronous helper work so policy changes/deletion cannot revive cached content.
  maintainAgentTestContent();
  const scenario = scenarioId === null ? null : scenarioById(scenarioId);
  const row = createRun(agentName, scenario, requestedDeployment);
  try {
    const room = await rooms.createRoom({ name: row.room_name, emptyTimeout: 60, departureTimeout: 30, maxParticipants: 4,
      metadata: JSON.stringify({ consoleTestRunId: row.id }),
      agents: [new RoomAgentDispatch({ agentName })] });
    activateRun(row.id, room.sid);
    const current = runRow(row.id);
    if (current.state !== 'active' || current.process_id !== agentTestProcessId) throw new AgentTestError('Test ended during room creation', 409);
    const token = await tokenFor(current);
    if (runRow(row.id).state !== 'active') throw new AgentTestError('Test ended during token creation', 409);
    res.status(201).json({ run: readRun(row.id, telemetryAllowed(req)), token, wsUrl: config.wsUrl });
  } catch (error) {
    if (isActive(runRow(row.id))) failRun(row.id);
    setCleanup(row.id, 'pending'); await cleanup(row.id);
    if (error instanceof AgentTestError) throw error;
    throw new AgentTestError('Could not create agent test room', 502);
  }
}));
async function tokenFor(row: Record<string, any>) {
  const token = new AccessToken(config.apiKey, config.apiSecret, { identity: 'console-test-browser-' + row.id, ttl: Math.max(1, Math.min(300, Math.floor((row.expires_at - Date.now()) / 1000))) });
  token.addGrant({ room: row.room_name, roomJoin: true, canPublish: true, canPublishSources: [TrackSource.MICROPHONE], canPublishData: true, canSubscribe: true, canUpdateOwnMetadata: false });
  return token.toJwt();
}
agentTests.post('/runs/:id/results', (req, res) => { saveResults(req.params.id, req.body); res.json({ run: readRun(req.params.id, telemetryAllowed(req)) }); });
agentTests.post('/runs/:id/end', asyncRoute(async (req, res) => { endRun(req.params.id); await cleanup(req.params.id); res.json({ run: readRun(req.params.id, telemetryAllowed(req)) }); }));
agentTests.post('/runs/:id/reconnect', asyncRoute(async (req, res) => {
  const row = runRow(req.params.id);
  if (row.state !== 'active' || row.expires_at <= Date.now() || !row.room_sid || !row.content || row.content_expires_at <= Date.now()) throw new AgentTestError('Run is no longer active', 409);
  if (!await ownedRoom(row)) { failRun(row.id); setCleanup(row.id, 'complete'); throw new AgentTestError('Test room no longer exists', 409); }
  const token = await tokenFor(row);
  if (runRow(row.id).state !== 'active') throw new AgentTestError('Test ended during reconnect', 409);
  res.json({ run: readRun(row.id, telemetryAllowed(req)), token, wsUrl: config.wsUrl });
}));
agentTests.get('/compare', requireContent('logs'), (req, res) => {
  const left = readRun(boundedText(req.query.left, 'left run ID'), true), right = readRun(boundedText(req.query.right, 'right run ID'), true);
  if (['active', 'creating'].includes(left.state) || ['active', 'creating'].includes(right.state)) throw new AgentTestError('End both runs before comparing', 409);
  const sameScenarioRevision = !!left.scenarioId && left.scenarioId === right.scenarioId && left.scenarioRevision === right.scenarioRevision;
  const expectationsAvailable = !!left.scenario && !!right.scenario && left.scenario.prompts.every(p => p.expectationAvailable) && right.scenario.prompts.every(p => p.expectationAvailable);
  const versionsAvailable = [left, right].every(run => run.provenance.actualWorkers.length > 0 && run.provenance.actualWorkers.every(w => w.version && w.agentName === run.agentName) && new Set(run.provenance.actualWorkers.map(w => w.version)).size === 1);
  const completed = left.state === 'completed' && right.state === 'completed';
  const sharedMeasurements = left.telemetry!.metrics.some(metric => metric.count > 0 && right.telemetry!.metrics.some(other => other.metric === metric.metric && other.count > 0));
  res.json({ left, right, compatibility: { sameScenarioRevision, expectationsComparable: sameScenarioRevision && expectationsAvailable, versionRegressionComparable: sameScenarioRevision && expectationsAvailable && versionsAvailable && completed && sharedMeasurements,
    provenanceBasis: 'server_retrieved_self_reported', cryptographicallyVerified: false, reasons: [...(!sameScenarioRevision ? ['different_or_missing_scenario_revision'] : []), ...(!expectationsAvailable ? ['expectations_missing_or_redacted'] : []), ...(!versionsAvailable ? ['actual_worker_version_unknown_or_ambiguous'] : []), ...(!completed ? ['scenario_not_completed'] : []), ...(!sharedMeasurements ? ['shared_native_measurements_missing'] : [])] }, measuredCoverage: { left: left.telemetry, right: right.telemetry } });
});
const errors: ErrorRequestHandler = (error, _req, res, _next) => { res.status(error instanceof AgentTestError ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500).json({ error: error instanceof AgentTestError ? error.message : error.type === 'entity.too.large' ? 'Agent test request exceeds size limit' : error.type === 'entity.parse.failed' ? 'Invalid JSON' : 'Agent test request failed' }); };
agentTests.use(errors);
