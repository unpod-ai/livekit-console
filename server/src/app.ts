import cookieParser from 'cookie-parser';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { loadBranding, brandHtml } from './branding.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforceRole, login, logout, me, requireAdmin, requireAuth } from './auth.js';
import { safeResponse } from './response-privacy.js';
import { auditRequests, pruneAudit } from './audit.js';
import { insightContent } from './insight-content.js';
import { operations, observeIngestion, startOperations } from './operations.js';
import { deployments } from './deployments.js';
import { agentTests, maintainAgentTests, maintainAgentTestContent, scrubAgentTestContent, deleteAgentTestContent, agentTestStorage, exportAgentTestContent } from './agent-tests.js';
import { registerOperationsStore } from './operations-stores.js';
import { OperationsError } from './operations-policy.js';
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

const branding = loadBranding(process.env);
const app = express();
app.get('/branding.json', (_req,res) => {res.set('Cache-Control','no-store');res.json(branding);});
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  const json = res.json.bind(res);
  res.json = body => json(safeResponse(body));
  next();
});
// LiveKit signs webhooks itself, so this route sits outside the session login.
app.post('/webhook', observeIngestion('webhook'), express.raw({ type: 'application/webhook+json' }), handleWebhook);
app.use('/api/telemetry', observeIngestion('telemetry'));
app.use('/api/telemetry/diagnostics', diagnosticIngest);
app.use('/api/telemetry', telemetryIngest);
app.use(express.json());
app.use(cookieParser());

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api', auditRequests);
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.use('/api/users', requireAuth, requireAdmin, users);
app.get('/api/auth/me', requireAuth, me);
app.use('/api/diagnostics', diagnosticReads);
app.use('/api/recordings', recordingRouter());
app.use('/api/operations', operations);
app.use('/api/deployments', deployments);
app.use('/api/agent-tests', agentTests);
app.use('/api/agent-insights', requireAuth, insightContent, agentInsights);
app.use('/api/inventory', inventory);
app.use('/api/history', requireAuth, history);
app.use('/api', requireAuth, enforceRole, api);

app.use('/api', (_req,res) => res.status(404).json({error:'Not found'}));
app.use('/p', (_req,res) => res.status(404).json({error:'Not found'}));

// In production the built web app is served from here.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  const html = brandHtml(readFileSync(path.join(webDist,'index.html'),'utf8'),branding);
  app.get('/index.html', (_req, res) => res.type('html').set('Cache-Control','no-store').send(html));
  app.use(express.static(webDist, {index:false}));
  app.get('*', (_req, res) => res.type('html').set('Cache-Control','no-store').send(html));
}

const host = process.env.HOST ?? '0.0.0.0';
registerOperationsStore('agent-tests', {category:'live',maintain:maintainAgentTestContent,scrub:scrubAgentTestContent,delete:deleteAgentTestContent,storage:agentTestStorage,export:(content,limits)=>{
  try{return exportAgentTestContent(content,limits);}catch(error){if((error as {status?:number}).status===413)throw new OperationsError('Export exceeds record or byte budget',413);throw error;}
}});
pruneAudit();
setInterval(pruneAudit,86400000).unref();
startOperations();
void maintainAgentTests().catch(() => console.error('Agent test startup cleanup failed'));
startReconciler();
startWorkerPolling();
startReportRetention();
purgeDiagnostics();
setInterval(purgeDiagnostics,60_000).unref();
startTrafficSync();
app.listen(config.port, host, () => console.log(`livekit-console listening on ${host}:${config.port}`));
