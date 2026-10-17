// Sends signed LiveKit-style webhooks to a running console, to test the collector or seed demo data.
// Usage: tsx --env-file=../.env scripts/simulate-webhooks.ts [http://localhost:8080] [callCount]
import { AccessToken } from 'livekit-server-sdk';
import { createHash } from 'node:crypto';

const base = process.argv[2] ?? 'http://localhost:8080';
const calls = Number(process.argv[3] ?? 3);
const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
if (!key || !secret) throw new Error('LIVEKIT_API_KEY / LIVEKIT_API_SECRET required');

let n = 0;
async function send(event: Record<string, unknown>, at: number): Promise<void> {
  const body = JSON.stringify({ id: `EV_sim_${Date.now()}_${n++}`, createdAt: String(Math.floor(at / 1000)), ...event });
  const token = new AccessToken(key, secret);
  (token as any).sha256 = createHash('sha256').update(body).digest('base64');
  const res = await fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/webhook+json', Authorization: await token.toJwt() },
    body,
  });
  if (!res.ok) throw new Error(`${event.event}: ${res.status} ${await res.text()}`);
}

for (let i = 0; i < calls; i++) {
  const t0 = Date.now() - (calls - i) * 600_000;
  const room = { sid: `RM_sim${i}`, name: `call_98760000${i}_sim`, creationTime: String(Math.floor(t0 / 1000)) };
  const phone = `+9198760000${i}`;
  // Inbound calls are matched by a dispatch rule; outbound calls go out through a trunk.
  const route = i % 2 === 0 ? { 'sip.ruleID': 'SDR_sim', 'sip.trunkID': 'ST_sim' } : { 'sip.trunkID': 'ST_sim' };
  await send({ event: 'room_started', room }, t0);
  await send({ event: 'participant_joined', room, participant: { sid: `PA_sip${i}`, identity: `sip_${phone}`, kind: 'SIP', joinedAt: String(Math.floor((t0 + 500) / 1000)), attributes: { 'sip.phoneNumber': phone, 'sip.trunkPhoneNumber': '+14155550100', 'sip.callStatus': 'active', 'sip.callID': `SCL_sim${i}`, ...route } } }, t0 + 500);
  await send({ event: 'participant_joined', room, participant: { sid: `PA_agent${i}`, identity: `agent-sim${i}`, kind: 'AGENT', joinedAt: String(Math.floor((t0 + 1500) / 1000)) } }, t0 + 1500);
  await send({ event: 'egress_started', egressInfo: { egressId: `EG_sim${i}`, roomId: room.sid, roomName: room.name, status: 'EGRESS_ACTIVE', startedAt: String((t0 + 2000) * 1e6) } }, t0 + 2000);
  await send({ event: 'egress_ended', egressInfo: { egressId: `EG_sim${i}`, roomId: room.sid, roomName: room.name, status: 'EGRESS_COMPLETE', startedAt: String((t0 + 2000) * 1e6), endedAt: String((t0 + 60_000) * 1e6) } }, t0 + 60_000);
  const left = { sid: `PA_sip${i}`, identity: `sip_${phone}`, kind: 'SIP', attributes: { 'sip.phoneNumber': phone, 'sip.trunkPhoneNumber': '+14155550100', 'sip.callStatus': 'hangup', 'sip.callID': `SCL_sim${i}`, ...route } };
  await send({ event: 'participant_left', room, participant: left }, t0 + 61_000);
  await send({ event: 'room_finished', room }, t0 + 62_000);
}
console.log(`sent ${n} webhooks for ${calls} simulated calls`);
