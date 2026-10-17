import { db } from './db.js';
import { twirp } from './twirp.js';

const nanosToMs = (v: unknown): number | null => (Number(v) ? Math.round(Number(v) / 1e6) : null);

const upsertEgress = db.prepare(`
  INSERT INTO egress (egress_id, room_sid, room_name, status, started_at, ended_at, info) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(egress_id) DO UPDATE SET room_sid = excluded.room_sid, room_name = excluded.room_name, status = excluded.status,
    started_at = excluded.started_at, ended_at = excluded.ended_at, info = excluded.info
`);
const insertSession = db.prepare('INSERT OR IGNORE INTO sessions (room_sid, room_name, started_at, ended_at, partial) VALUES (?,?,?,?,2)');

/**
 * Webhooks only describe what happens after they were enabled, but LiveKit still retains its recent egress records.
 * Import those, and rebuild the session each belongs to (room name, id and times are all in the egress record) so
 * recordings link to their session and back. Reconstructed sessions are flagged (partial = 2) and have no participants.
 */
export async function importFromLiveKit(): Promise<number> {
  let items: any[];
  try {
    items = ((await twirp('egress', 'ListEgress', {})) as { items?: any[] }).items ?? [];
  } catch {
    return 0; // LiveKit unreachable: leave what we have
  }
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const e of items) {
      if (!e.egressId) continue;
      const started = nanosToMs(e.startedAt);
      const ended = nanosToMs(e.endedAt);
      upsertEgress.run(e.egressId, e.roomId || null, e.roomName || null, String(e.status ?? ''), started, ended, JSON.stringify(e));
      if (e.roomId && e.roomName && started) insertSession.run(e.roomId, e.roomName, started, ended);
      n++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return n;
}
