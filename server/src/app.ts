import cookieParser from 'cookie-parser';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforceRole, login, logout, me, requireAdmin, requireAuth, requireContent } from './auth.js';
import { createHash } from 'node:crypto';
import { safeProjectResponse } from './project-response.js';
import { operations, observeIngestion, startOperations } from './operations.js';
import { users } from './users.js';
import { diagnosticIngest, diagnosticReads, purgeDiagnostics } from './diagnostics.js';
import { config } from './config.js';
import { recordingRouter } from './recordings.js';
import { handleWebhook } from './collector.js';
import { history } from './history.js';
import { inventory } from './inventory.js';
import { api } from './routes.js';
import { startReconciler } from './reconcile.js';
import { startTrafficSync } from './traffic.js';
import { startWorkerPolling } from './workers.js';
import { agentInsights, telemetryIngest, startReportRetention } from './telemetry.js';

const app = express();
app.set('trust proxy', 1);
if (process.env.CONSOLE_PROJECT_CHILD === '1') app.use((_req, res, next) => {
  const json = res.json.bind(res);
  res.json = body => json(safeProjectResponse(body));
  next();
});
// LiveKit signs webhooks itself, so this route sits outside the session login.
app.post('/webhook', observeIngestion('webhook'), express.raw({ type: 'application/webhook+json' }), handleWebhook);
app.use('/api/telemetry', observeIngestion('telemetry'));
app.use('/api/telemetry/diagnostics', diagnosticIngest);
app.use('/api/telemetry', telemetryIngest);
app.use(express.json());
app.use(cookieParser());

app.get('/healthz', (_req, res) => res.json({ ok: true, projectId: process.env.CONSOLE_PROJECT_ID, instance: process.env.CONSOLE_GATEWAY_SECRET ? createHash('sha256').update(process.env.CONSOLE_GATEWAY_SECRET).digest('hex') : undefined }));
if (process.env.CONSOLE_PROJECT_CHILD !== '1') {
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.use('/api/users', requireAuth, requireAdmin, users);
}
app.get('/api/auth/me', requireAuth, me);
app.use('/api/diagnostics', diagnosticReads);
app.use('/api/recordings', recordingRouter());
app.use('/api/operations', operations);
app.use('/api/agent-insights', requireAuth, (req, res, next) => {
  const grants = /\/logs\/?$/.test(req.path) ? ['logs'] as const : /\/(telemetry|export)\/?$/.test(req.path) ? ['transcripts', 'logs'] as const : ['transcripts'] as const;
  requireContent(...grants)(req, res, next);
}, agentInsights);
app.use('/api/inventory', inventory);
app.use('/api/history', requireAuth, history);
app.use('/api', requireAuth, enforceRole, api);

// In production the built web app is served from here.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const host = process.env.HOST ?? '0.0.0.0';
startOperations();
startReconciler();
startWorkerPolling();
startReportRetention();
purgeDiagnostics();
setInterval(purgeDiagnostics,60_000).unref();
startTrafficSync();
app.listen(config.port, host, () => console.log(`livekit-console listening on ${host}:${config.port}`));
