export type Json = Record<string, any>;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status);
  return data as T;
}

export type LkService = 'sip' | 'egress' | 'ingress';

/** Calls LiveKit's admin API through the console server (protobuf-JSON in and out). */
export const lk = <T = any>(service: LkService, method: string, body: unknown = {}) =>
  api<T>(`/lk/${service}/${method}`, { method: 'POST', body });
