import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from './config.js';

export const requireTelemetry: RequestHandler = (req, res, next) => {
  if (!config.telemetryToken) { res.status(503).json({ error: 'Agent telemetry collection is disabled' }); return; }
  const auth = req.get('authorization') ?? '';
  const hash = (value: string) => createHash('sha256').update(value).digest();
  if (!auth.startsWith('Bearer ') || !timingSafeEqual(hash(auth.slice(7)), hash(config.telemetryToken))) {
    res.status(401).json({ error: 'Invalid telemetry token' }); return;
  }
  next();
};
