import { db } from './db.js';
import { importFromLiveKit } from './importer.js';
import { rooms } from './livekit.js';

const GRACE_MS = 90_000;

// Webhooks can be missed (collector down, LiveKit restarted mid-call), which would leave sessions "Active" forever.
// Compare against the rooms LiveKit really has and close the ones that are gone. If LiveKit can't be reached we
// do nothing: a failed check must never close live sessions.
export async function reconcileSessions(): Promise<number> {
  let live: Set<string>;
  try {
    live = new Set((await rooms.listRooms()).map((r) => r.sid));
  } catch {
    return 0;
  }
  const open = db.prepare('SELECT room_sid, started_at FROM sessions WHERE ended_at IS NULL').all() as { room_sid: string; started_at: number }[];
  const lastEvent = db.prepare('SELECT MAX(ts) AS ts FROM events WHERE room_sid = ?');
  const endSession = db.prepare('UPDATE sessions SET ended_at = ? WHERE room_sid = ?');
  const endParticipants = db.prepare('UPDATE participants SET left_at = ? WHERE room_sid = ? AND left_at IS NULL');
  let closed = 0;
  for (const s of open) {
    if (live.has(s.room_sid)) continue;
    const endedAt = Math.max(s.started_at, (lastEvent.get(s.room_sid) as { ts: number | null }).ts ?? 0);
    if (Date.now() - endedAt < GRACE_MS) continue; // the room_finished webhook may still be in flight
    endSession.run(endedAt, s.room_sid);
    endParticipants.run(endedAt, s.room_sid);
    closed++;
  }
  return closed;
}

export function startReconciler(): void {
  const run = () =>
    reconcileSessions()
      .then((n) => n && console.log(`reconciler closed ${n} stale session(s)`))
      .catch((err) => console.error('reconcile failed', err));
  const sync = () =>
    importFromLiveKit()
      .then((n) => n && console.log(`synced ${n} egress record(s) from LiveKit`))
      .catch((err) => console.error('egress sync failed', err));
  setTimeout(run, 10_000);
  setInterval(run, 60_000).unref();
  // Covers egress that started before webhooks did, and any whose webhook was missed.
  setTimeout(sync, 5_000);
  setInterval(sync, 5 * 60_000).unref();
}
