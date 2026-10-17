import {
  AccessToken,
  AgentDispatchClient,
  EgressClient,
  IngressClient,
  RoomServiceClient,
  SipClient,
} from 'livekit-server-sdk';
import { config } from './config.js';

const { httpUrl, apiKey, apiSecret } = config;

export const rooms = new RoomServiceClient(httpUrl, apiKey, apiSecret);
export const agentDispatch = new AgentDispatchClient(httpUrl, apiKey, apiSecret);
export const sip = new SipClient(httpUrl, apiKey, apiSecret);
export const egress = new EgressClient(httpUrl, apiKey, apiSecret);
export const ingress = new IngressClient(httpUrl, apiKey, apiSecret);

export async function createToken(opts: {
  room: string;
  identity: string;
  name?: string;
  canPublish: boolean;
  canSubscribe: boolean;
  ttlSeconds: number;
}): Promise<string> {
  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: opts.ttlSeconds,
  });
  at.addGrant({
    room: opts.room,
    roomJoin: true,
    canPublish: opts.canPublish,
    canSubscribe: opts.canSubscribe,
  });
  return at.toJwt();
}
