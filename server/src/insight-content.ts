import type { RequestHandler } from 'express';
import { requireContent } from './auth.js';
export const insightContent: RequestHandler = (req,res,next) => {
 const route=req.path.toLowerCase();
 const grants = /\/logs\/?$/.test(route) ? ['logs'] as const : /\/(telemetry|export)\/?$/.test(route) ? ['transcripts','logs'] as const : ['transcripts'] as const;
 requireContent(...grants)(req,res,next);
};
