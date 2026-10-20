export type RedactionMode = 'off' | 'standard' | 'strict';
const CONTENT = new Set(['text', 'message', 'name', 'logger', 'fromAgent', 'toAgent', 'source']);
export function redactContent<T>(value: T, mode: RedactionMode, terms: string[]): T {
  function redact(s: string): string {
    if (mode === 'strict') return s ? '[CONTENT REDACTED]' : s;
    s = s.replace(/\bBearer\s+[^\s,"'}]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(api[_-]?key|api[_-]?secret|access[_-]?token|access[_-]?key|secret|password|authorization|token)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1=[REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[TOKEN REDACTED]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g, '[TOKEN REDACTED]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL REDACTED]')
      .replace(/(?:\+\d[\d ().-]{6,}\d|\b\d{3}[ ().-]+\d{3}[ .-]+\d{4}\b|\b\d{10,15}\b)/g, v => { const n = v.replace(/\D/g, '').length; return n >= 8 && n <= 15 ? '[PHONE REDACTED]' : v; });
    for (const term of terms) s = s.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[REDACTED]');
    return s;
  }
  function visit(v: unknown, key = ''): unknown {
    if (typeof v === 'string') return CONTENT.has(key) ? redact(v) : v;
    if (Array.isArray(v)) return v.map(item => visit(item, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, visit(item, k)]));
    return v;
  }
  return mode === 'off' ? value : visit(value) as T;
}
