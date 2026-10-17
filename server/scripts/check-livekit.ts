// Verifies the console's LiveKit credentials by calling each admin API once. Prints counts only.
// Usage: tsx --env-file=../.env scripts/check-livekit.ts
import { egress, ingress, rooms, sip } from '../src/livekit.js';
import { config } from '../src/config.js';

console.log(`target: ${config.httpUrl}`);
const checks: [string, () => Promise<unknown[]>][] = [
  ['rooms', () => rooms.listRooms()],
  ['sip inbound trunks', () => sip.listSipInboundTrunk()],
  ['sip outbound trunks', () => sip.listSipOutboundTrunk()],
  ['sip dispatch rules', () => sip.listSipDispatchRule()],
  ['egress', () => egress.listEgress()],
  ['ingress', () => ingress.listIngress()],
];
for (const [name, fn] of checks) {
  try {
    console.log(`ok    ${name}: ${(await fn()).length}`);
  } catch (err) {
    console.log(`FAIL  ${name}: ${err instanceof Error ? err.message : err}`);
  }
}
