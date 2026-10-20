import cookieParser from 'cookie-parser';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforceRole, login, logout, me, requireAdmin, requireAuth } from './auth.js';
import { users } from './users.js';
import { diagnosticIngest, diagnosticReads, purgeDiagnostics } from './diagnostics.js';
import { config } from './config.js';
import { recordingRouter } from './recordings.js';
import { handleWebhook } from './collector.js';
import { history } from './history.js';
import { api } from './routes.js';
import { startReconciler } from './reconcile.js';
import { startTrafficSync } from './traffic.js';
import { startWorkerPolling } from './workers.js';
import { agentInsights, telemetryIngest, startReportRetention } from './telemetry.js';

const app = express();
app.set('trust proxy', 1);
// LiveKit signs webhooks itself, so this route sits outside the session login.
app.post('/webhook', express.raw({ type: 'application/webhook+json' }), handleWebhook);
app.use('/api/telemetry/diagnostics', diagnosticIngest);
app.use('/api/telemetry', telemetryIngest);
app.use(express.json());
app.use(cookieParser());

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/me', requireAuth, me);
app.use('/api/diagnostics', diagnosticReads);
app.use('/api/recordings', recordingRouter());
app.use('/api/users', requireAuth, requireAdmin, users);
app.use('/api/agent-insights', requireAuth, requireAdmin, agentInsights);
app.use('/api/history', requireAuth, history);
app.use('/api', requireAuth, enforceRole, api);

// In production the built web app is served from here.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const host = process.env.HOST ?? '0.0.0.0';
startReconciler();
startWorkerPolling();
startReportRetention();
purgeDiagnostics();
setInterval(purgeDiagnostics,60_000).unref();
startTrafficSync();
app.listen(config.port, host, () => console.log(`livekit-console listening on ${host}:${config.port}`));
