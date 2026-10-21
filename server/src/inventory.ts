import { Router } from 'express';
import { requireAdmin, requireAuth } from './auth.js';
import { agentWorkerJobs, inventoryWorkerRows, linkAgentAlias, listAgents, resolveAgent, syncInventory, workerRollups } from './inventory-store.js';
export const inventory = Router();
inventory.use(requireAuth);
function daysOf(value: unknown): number | null {
 const days = value === undefined ? 365 : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
 return Number.isInteger(days) && days >= 1 && days <= 3650 ? days : null;
}
inventory.get('/agents', (_req, res) => { syncInventory(); res.json(listAgents()); });
inventory.get('/workers', (req, res) => {
 const days = daysOf(req.query.days);
 if (days === null || req.query.agent !== undefined && typeof req.query.agent !== 'string') { res.status(400).json({ error: 'Invalid inventory query' }); return; }
 res.json(inventoryWorkerRows(days * 24, req.query.agent as string | undefined));
});
inventory.get('/agents/:ref', (req, res) => {
 const days = daysOf(req.query.days);
 if (days === null) { res.status(400).json({ error: 'days must be an integer from 1 to 3650' }); return; }
 syncInventory(); const agent = resolveAgent(req.params.ref);
 if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
 const { workers, former } = inventoryWorkerRows(days * 24, agent.id);
 const jobs = agentWorkerJobs(agent.id);
 res.json({ agent, workers, former, rollups: workerRollups(agent.id, days), jobs: jobs.slice(0, 200), jobsCoverage: { limit: 200, truncated: jobs.length > 200 } });
});
inventory.post('/agents/:id/aliases', requireAdmin, (req, res) => {
 const b = req.body;
 if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.name !== 'string' || b.mergeAgentId !== undefined && typeof b.mergeAgentId !== 'string' || b.makeCanonical !== undefined && typeof b.makeCanonical !== 'boolean' || Object.keys(b).some(k => !['name', 'mergeAgentId', 'makeCanonical'].includes(k))) { res.status(400).json({ error: 'Invalid alias request' }); return; }
 syncInventory();
 if (!resolveAgent(req.params.id)) { res.status(404).json({ error: 'Agent not found' }); return; }
 try { res.json(linkAgentAlias(req.params.id, b)); }
 catch (e) { const error = e instanceof Error ? e.message : 'Invalid alias request'; res.status(error.includes('mergeAgentId') ? 409 : 400).json({ error }); }
});
