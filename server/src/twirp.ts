import { AccessToken } from 'livekit-server-sdk';
import { config } from './config.js';

// LiveKit's admin APIs are Twirp (HTTP + protobuf-JSON). Passing the JSON straight through gives the UI every
// field the Cloud forms expose (the Cloud "JSON editor" tabs do the same) without wrapping each one in the SDK.
export const SERVICES = { sip: 'livekit.SIP', egress: 'livekit.Egress', ingress: 'livekit.Ingress' } as const;
export type Service = keyof typeof SERVICES;

export class TwirpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function adminToken(): Promise<string> {
  const at = new AccessToken(config.apiKey, config.apiSecret, { ttl: '1m' });
  at.addGrant({ roomCreate: true, roomList: true, roomRecord: true, ingressAdmin: true });
  at.addSIPGrant({ admin: true, call: true });
  return at.toJwt();
}

// Twirp answers with proto field names (snake_case) and every default value; the rest of the app uses camelCase.
// Keys of user-defined maps (attributes, headers) are data, so they are left exactly as stored.
const MAP_FIELDS = new Set(['attributes', 'headers', 'headers_to_attributes', 'attributes_to_headers', 'participant_attributes']);
const camel = (k: string): string => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function camelize(v: unknown, inMap = false): unknown {
  if (Array.isArray(v)) return v.map((x) => camelize(x, inMap));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [inMap ? k : camel(k), camelize(x, inMap || MAP_FIELDS.has(k))]));
  }
  return v;
}

export async function twirp(service: Service, method: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${config.httpUrl}/twirp/${SERVICES[service]}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await adminToken()}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as { msg?: string };
  if (!res.ok) throw new TwirpError(data.msg ?? res.statusText, res.status);
  return camelize(data);
}
