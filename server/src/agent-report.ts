/** Version 1 accepts the snake_case projection from Python Agents SessionReport.to_dict(). */
type ObjectValue = Record<string, unknown>;
export class ReportValidationError extends Error {}
const invalid = (message: string): never => { throw new ReportValidationError(message); };
function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(`${label} must be an object`);
  return value as ObjectValue;
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid(`${label} must be a nonempty string of at most ${max} characters`);
  return value;
}
function optionalText(value: unknown, label: string): string | null {
  return value == null || value === '' ? null : text(value, label);
}
function seconds(value: unknown, label: string, required = false): number | null {
  if (value == null && !required) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8640000000000) return invalid(`${label} must be a nonnegative Unix timestamp in seconds`);
  return Math.round(value * 1000);
}
const METRICS = ['llm_node_ttft', 'tts_node_ttfb', 'e2e_latency', 'transcription_delay', 'end_of_turn_delay', 'on_user_turn_completed_delay'];

export type ReportItem = {
  id: string; type: 'message' | 'function_call' | 'function_call_output' | 'agent_handoff'; at: number | null;
  role?: 'user' | 'assistant'; text?: string; interrupted?: boolean; metrics?: Record<string, number>;
  name?: string | null; callId?: string | null; isError?: boolean; fromAgent?: string | null; toAgent?: string;
};
export type ReportContent = { schemaVersion: 1; items: ReportItem[]; omittedItems: number };

export function normalizeReport(value: unknown) {
  const envelope = object(value, 'request');
  if (envelope.schemaVersion !== 1) invalid('schemaVersion must be 1');
  const report = object(envelope.report, 'report');
  const roomSid = text(report.room_id, 'report.room_id', 100);
  const jobId = text(report.job_id, 'report.job_id', 100);
  if (!/^RM_[A-Za-z0-9_-]+$/.test(roomSid)) invalid('report.room_id must be a room SID');
  if (!/^AJ_[A-Za-z0-9_-]+$/.test(jobId)) invalid('report.job_id must be a job ID');
  const history = object(report.chat_history, 'report.chat_history');
  if (!Array.isArray(history.items) || history.items.length > 5000) invalid('chat_history.items must be an array of at most 5000 items');
  const sourceItems = history.items as unknown[];
  const items: ReportItem[] = [];
  let omittedItems = 0;
  for (const [index, value] of sourceItems.entries()) {
    const item = object(value, `item ${index}`);
    if (typeof item.type !== 'string') invalid('item.type must be a string');
    if (!['message', 'function_call', 'function_call_output', 'agent_handoff'].includes(item.type as string) ||
      (item.type === 'message' && item.role !== 'user' && item.role !== 'assistant')) { omittedItems++; continue; }
    const common = { id: item.id == null ? `item-${index}` : text(item.id, 'item.id'), at: seconds(item.created_at, 'item.created_at') };
    if (item.type === 'message') {
      const content = typeof item.content === 'string' ? [item.content] : item.content;
      if (!Array.isArray(content)) invalid('message.content must be text or an array');
      const plain = (content as unknown[]).filter((part): part is string => typeof part === 'string').join('\n');
      if (plain.length > 64000) invalid('message text exceeds 64000 characters');
      const metrics: Record<string, number> = {};
      if (item.metrics != null) {
        const raw = object(item.metrics, 'item.metrics');
        for (const key of METRICS) if (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0) metrics[key] = raw[key] as number;
      }
      items.push({ ...common, type: 'message', role: item.role as 'user' | 'assistant', text: plain, interrupted: item.interrupted === true, metrics });
    } else if (item.type === 'agent_handoff') {
      items.push({ ...common, type: 'agent_handoff', fromAgent: optionalText(item.old_agent_id, 'old_agent_id'), toAgent: text(item.new_agent_id, 'new_agent_id') });
    } else {
      items.push({ ...common, type: item.type as 'function_call' | 'function_call_output', name: optionalText(item.name, 'tool name'), callId: optionalText(item.call_id, 'call_id'), ...(item.type === 'function_call_output' ? { isError: item.is_error === true } : {}) });
    }
  }
  return {
    roomSid, jobId, agentName: text(envelope.agentName, 'agentName'),
    participantSid: optionalText(envelope.participantSid, 'participantSid'), workerId: optionalText(envelope.workerId, 'workerId'),
    sdkVersion: optionalText(report.sdk_version, 'sdk_version'), reportedAt: seconds(report.timestamp, 'report.timestamp', true)!,
    content: { schemaVersion: 1, items, omittedItems } satisfies ReportContent,
  };
}
