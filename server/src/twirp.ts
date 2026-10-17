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

export async function twirp(service: Service, method: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${config.httpUrl}/twirp/${SERVICES[service]}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await adminToken()}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as { msg?: string };
  if (!res.ok) throw new TwirpError(data.msg ?? res.statusText, res.status);
  return data;
}
