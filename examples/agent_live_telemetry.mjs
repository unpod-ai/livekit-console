/** LiveKit Agents Node 1.9.3 adapter. Install alongside your worker, not in the console. */
import { createHash, randomUUID } from 'node:crypto';
const snake = key => key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const metricKeys = new Set(['llm_node_ttft','tts_node_ttfb','e2e_latency','transcription_delay','end_of_turn_delay','on_user_turn_completed_delay','duration','ttft','ttfb','audio_duration','input_tokens','output_tokens','tokens_per_second','playback_latency','total_requests']);
export function measured(raw = {}) {
  return Object.fromEntries(Object.entries(raw).map(([key, v]) => [snake(key), v]).filter(([key,v]) => metricKeys.has(key) && typeof v === 'number' && Number.isFinite(v) && v >= 0));
}
export function usageRows(rows = []) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, v]) => key === 'audioDurationMs' ? ['audio_duration', v / 1000] : key === 'sessionDurationMs' ? ['session_duration', v / 1000] : [snake(key), v])));
}
export function reportEnvelope(report, agentName, sdkVersion) {
  const items = report.chatHistory.items.map(item => ({
    id: item.id, type: item.type, role: item.role, content: (item.content ?? []).filter(p => typeof p === 'string'),
    interrupted: item.interrupted, created_at: item.createdAt / 1000, metrics: measured(item.metrics),
    name: item.name, call_id: item.callId, is_error: item.isError, old_agent_id: item.oldAgentId, new_agent_id: item.newAgentId,
  }));
  return { schemaVersion: 2, agentName, report: { room_id: report.roomId, room: report.room, job_id: report.jobId,
    sdk_version: sdkVersion, timestamp: report.timestamp / 1000, chat_history: { items }, usage: report.modelUsage == null ? null : usageRows(report.modelUsage) } };
}
export function transport({ url = process.env.CONSOLE_URL, token = process.env.AGENT_TELEMETRY_TOKEN } = {}) {
  return async (route, body) => {
    if (!url || !token) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url.replace(/\/$/, '') + route, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(3000), headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } });
        await res.arrayBuffer();
        if (res.ok) return true;
        if (res.status < 500 && res.status !== 429) return false;
      } catch { /* Retry the same serialized body; never log credentials or content. */ }
      if (!attempt) await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  };
}
export class SessionTelemetry {
  constructor(ctx, agentName, { sdkVersion = '1.9.3', send = transport(), capacity = 1000, background = true } = {}) {
    Object.assign(this, { ctx, agentName, sdkVersion, send, capacity });
    this.queue = []; this.pending = null; this.seen = new Set(); this.total = 0; this.dropped = 0;
    this.mode = 'unknown'; this.capabilities = ['events','metrics','usage','report']; this.listeners = []; this.lastHeartbeat = Date.now();
    if (background) { this.timer = setInterval(() => { if (Date.now() - this.lastHeartbeat >= 30000) { this.emit('collection', { state: 'receiving', droppedCount: this.dropped }); this.lastHeartbeat = Date.now(); } this.flush().catch(() => {}); }, 1000); this.timer.unref(); }
  }
  emit(kind, fields = {}) {
    if (this.closed) return false;
    const entry = { id: randomUUID(), kind, at: Date.now() / 1000, ...fields };
    if (this.seen.has(entry.id)) return true;
    // Cap deduplication metadata as well as the upload queue for very long sessions.
    this.total += kind === 'collection' ? 0 : 1;
    if (this.seen.size >= 100000 || this.queue.length + (this.pending?.entries.length ?? 0) >= this.capacity) { this.dropped++; return false; }
    this.seen.add(entry.id); this.queue.push(entry); return true;
  }
  envelope(entries) {
    return { schemaVersion: 1, roomSid: this.ctx.job.room.sid, jobId: this.ctx.job.id, agentName: this.agentName,
      batchId: randomUUID(), sdk: { language: 'node', version: this.sdkVersion }, mode: this.mode,
      participantSid: this.ctx.room?.localParticipant?.sid || null, workerId: process.env.LIVEKIT_WORKER_ID || null,
      capabilities: this.capabilities, entries };
  }
  async post(body) { try { return await this.send('/api/telemetry/events', body); } catch { return false; } }
  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushBatch();
    try { return await this.flushing; } finally { this.flushing = null; }
  }
  async flushBatch() {
    if (!this.pending && this.queue.length) {
      const entries = [];
      while (this.queue.length && entries.length < 25) {
        const entry = this.queue.shift();
        try {
          if (Buffer.byteLength(JSON.stringify(this.envelope([...entries, entry]))) > 256 * 1024) {
            if (entries.length) { this.queue.unshift(entry); break; }
            this.dropped++; continue;
          }
          entries.push(entry);
        } catch { this.dropped++; }
      }
      if (entries.length) this.pending = { entries, body: JSON.stringify(this.envelope(entries)) };
    }
    if (this.pending) { if (!await this.post(this.pending.body)) return false; this.pending = null; }
    return true;
  }
  attach(session, { mode = 'unknown', context = () => ({}) } = {}) {
    this.mode = mode;
    const listen = (event, handler) => { const guarded = e => { try { handler(e); } catch { this.dropped++; } }; session.on(event, guarded); this.listeners.push([session,event,guarded]); };
    listen('conversation_item_added', e => {
      const i = e.item;
      if (i.type === 'agent_handoff') this.emit('handoff', { at: i.createdAt / 1000, fromAgent: i.oldAgentId, toAgent: i.newAgentId, ...context() });
      else if (i.type === 'message' && ['user','assistant'].includes(i.role)) {
        const fields = { messageId: i.id, role: i.role, text: i.content.filter(p => typeof p === 'string').join('\n'), interrupted: !!i.interrupted, metrics: measured(i.metrics) };
        this.emit('message', { id: 'msg_' + createHash('sha256').update(JSON.stringify(fields)).digest('hex'), at: i.createdAt / 1000, ...fields, ...context() });
      }
    });
    listen('function_tools_executed', e => { for (const call of e.functionCalls) { const output = e.functionCallOutputs.find(o => o?.callId === call.callId); this.emit('tool', { at: e.createdAt / 1000, name: call.name, callId: call.callId, isError: !!output?.isError, status: output ? 'completed' : 'unavailable', ...context() }); } });
    listen('agent_state_changed', e => this.emit('state', { at: e.createdAt / 1000, state: e.newState, ...context() }));
    listen('error', e => this.emit('error', { at: e.createdAt / 1000, message: String(e.error?.error?.message ?? e.error?.message ?? e.error).slice(0,4000), source: e.source?.constructor?.name ?? 'SDK', recoverable: e.error?.recoverable === true, ...context() }));
    listen('metrics_collected', e => { const m = e.metrics; const stage = m.type.replace('_metrics','').replace('realtime_model','realtime'); if (stage !== 'vad') this.emit('metrics', { at: e.createdAt / 1000, stage: ['stt','llm','tts','eou','realtime'].includes(stage) ? stage : 'other', metrics: measured({ ...m, inputTokens: m.promptTokens ?? m.inputTokens, outputTokens: m.completionTokens ?? m.outputTokens }), ...(m.speechId && { turnId: m.speechId }), ...context() }); });
    listen('session_usage_updated', e => this.emit('usage', { at: e.createdAt / 1000, models: usageRows(e.usage.modelUsage), ...context() }));
    this.emit('collection', { state: 'receiving' });
  }
  recordSpan(span) {
    const a = span.attributes ?? {}, c = span.spanContext(), n = span.name.toLowerCase();
    const stage = ['realtime','llm','tts','stt','tool'].find(s => n.includes(s)) ?? (n === 'agent_session' ? 'session' : /turn|speaking|eou/.test(n) ? 'turn' : 'other');
    const seconds = ([s, ns]) => s + ns / 1e9;
    const metrics = {};
    for (const [key, target] of [['lk.response.ttft','llm_node_ttft'],['lk.response.ttfb','tts_node_ttfb'],['lk.e2e_latency','e2e_latency'],['lk.transcription_delay','transcription_delay'],['lk.end_of_turn_delay','end_of_turn_delay']]) if (a[key] != null) metrics[target] = a[key];
    this.emit('span', { id: 'span_' + c.traceId + c.spanId, at: seconds(span.startTime), end: seconds(span.endTime),
      name: span.name.slice(0,200), stage, traceId: c.traceId, spanId: c.spanId, parentSpanId: span.parentSpanContext?.spanId ?? null,
      turnId: a['lk.generation_id'] ?? a['lk.speech_id'] ?? null, status: span.status.code === 2 ? 'error' : span.status.code === 1 ? 'ok' : 'unset', interrupted: a['lk.interrupted'] === true, metrics: measured(metrics) });
  }
  async configureTracing() {
    const { NodeTracerProvider, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
    const { telemetry } = await import('@livekit/agents');
    const exporter = { export: (spans, done) => { for (const span of spans) this.recordSpan(span); done({ code: 0 }); }, shutdown: async () => {} };
    const fanout = new telemetry.FanoutSpanProcessor();
    this.provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter), fanout] });
    telemetry.setTracerProvider(this.provider, { allowPii: false, registerSpanProcessor: processor => fanout.add(processor) });
    this.capabilities.push('spans');
  }
  close() { return this.closing ??= this.finish(); }
  async finish() {
    clearInterval(this.timer);
    for (const [session,event,handler] of this.listeners) session.off(event,handler);
    await this.provider?.forceFlush();
    if (this.flushing) await this.flushing;
    while (this.pending || this.queue.length) if (!await this.flush()) { this.dropped += this.queue.length + (this.pending?.entries.length ?? 0); this.queue = []; this.pending = null; break; }
    const terminal = { id: randomUUID(), kind: 'collection', at: Date.now()/1000, state: this.dropped ? 'incomplete' : 'complete', expectedCount: this.total, droppedCount: this.dropped };
    const ok = await this.post(JSON.stringify(this.envelope([terminal]))); this.closed = true; return ok && !this.dropped;
  }
}
