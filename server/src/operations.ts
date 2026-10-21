import { auditRows } from './audit.js';
import express, { Router, type ErrorRequestHandler } from 'express';
import { requireAuth, requireAdmin, requireContent } from './auth.js';
import { bounds, category, getPolicy, updatePolicy, deleteCategory, exportCategory, storageMeasurements, initializePolicy, maintainOperations, OperationsError } from './operations-policy.js';
import { collectorStates, ruleRows, saveRule, evaluateAlerts, alertRows, transitionAlert, ruleKinds } from './operations-observability.js';
export { observeIngestion } from './operations-observability.js';
export const operations=Router();
operations.use(requireAuth,requireAdmin,(_req,res,next)=>{res.set('Cache-Control','no-store');next();},express.json({limit:'32kb'}));
operations.get('/summary',(_req,res)=>{maintainOperations();evaluateAlerts();const storage=storageMeasurements();res.json({backend:{state:'ready'},collectors:collectorStates(),storage,categories:storage.categories,alerts:alertRows()});});
operations.get('/audit',(_req,res)=>res.json({rows:auditRows()}));
operations.get('/policy',(_req,res)=>res.json({...getPolicy(),bounds}));
operations.patch('/policy',(req,res)=>res.json({...updatePolicy(req.body),bounds}));
operations.get('/rules',(_req,res)=>res.json(ruleRows()));
operations.post('/rules',(req,res)=>res.status(201).json(saveRule(req.body)));
operations.patch('/rules/:id',(req,res)=>res.json(saveRule(req.body,req.params.id)));
operations.get('/alerts',(_req,res)=>{evaluateAlerts();res.json({rows:alertRows()});});
operations.post('/alerts/:id/ack',(req,res)=>res.json(transitionAlert(req.params.id,'acknowledged')));
operations.post('/alerts/:id/resolve',(req,res)=>res.json(transitionAlert(req.params.id,'resolved')));
operations.get('/export/:category',(req,res,next)=>{
 const kind=category(req.params.category);
 const caps:('transcripts'|'logs'|'recordings')[]=kind==='reports'?['transcripts']:kind==='live'?['transcripts','logs']:kind==='logs'||kind==='history'?['logs']:kind==='recordings'?['recordings']:[];
 requireContent(...caps)(req,res,()=>{
  try{if(req.query.content!==undefined&&!['true','false'].includes(String(req.query.content)))throw new OperationsError('Invalid export mode');res.set('Content-Disposition',`attachment; filename="operations-${kind}.json"`);res.json(exportCategory(kind,req.query.content==='true'));}catch(e){next(e);}
 });
});
operations.delete('/data/:category',(req,res)=>{const kind=category(req.params.category);if(req.body?.confirm!==kind)throw new OperationsError('Confirm the exact category');res.json(deleteCategory(kind));});
const errors:ErrorRequestHandler=(error,_req,res,_next)=>{res.status(error instanceof OperationsError?error.status:error.type==='entity.too.large'?413:error.type==='entity.parse.failed'?400:500).json({error:error instanceof OperationsError?error.message:'Operations request failed'});};
operations.use(errors);
let started=false;
export function startOperations(){if(started)return;initializePolicy();started=true;setInterval(()=>{try{maintainOperations();evaluateAlerts();}catch{console.error('Operations maintenance failed');}},60000).unref();}
