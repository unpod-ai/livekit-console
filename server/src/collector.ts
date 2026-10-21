import type { Request, Response } from 'express';
import { WebhookReceiver } from 'livekit-server-sdk';
import { noteSourceTimestamp } from './operations-observability.js';
import { config } from './config.js';
import { db } from './db.js';

const receiver = new WebhookReceiver(config.apiKey, config.apiSecret);

const secs = (v: unknown): number => (Number(v) || 0) * 1000;
const nanos = (v: unknown): number => Math.round((Number(v) || 0) / 1e6);

const insertEvent = db.prepare(
  'INSERT OR IGNORE INTO events (id, ts, type, room_sid, room_name, identity, payload) VALUES (?,?,?,?,?,?,?)',
);
const ensureSession = db.prepare(
  'INSERT OR IGNORE INTO sessions (room_sid, room_name, started_at, partial) VALUES (?,?,?,?)',
);
const upsertParticipant = db.prepare(`
  INSERT INTO participants (room_sid, sid, identity, name, kind, joined_at, attributes) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(room_sid, sid) DO UPDATE SET name = excluded.name, kind = excluded.kind, attributes = excluded.attributes
`);
const upsertEgress = db.prepare(`
  INSERT INTO egress (egress_id, room_sid, room_name, status, started_at, ended_at, info) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(egress_id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at,
    ended_at = excluded.ended_at, info = excluded.info
`);

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  let event;
  try {
    event = await receiver.receive(req.body.toString('utf8'), req.get('Authorization') ?? undefined);
  } catch (err) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }
  try {
    record(event as any);
    noteSourceTimestamp('webhook',secs((event as any).createdAt));
    res.json({ ok: true });
  } catch (err) {
    console.error('webhook processing failed');
    res.status(500).json({ error: 'processing failed' });
  }
}

function record(e: any): void {
  const ts = secs(e.createdAt) || Date.now();
  const roomSid: string | null = e.room?.sid || e.egressInfo?.roomId || null;
  const roomName: string | null = e.room?.name || e.egressInfo?.roomName || null;
  const p = e.participant;
  const payload = typeof e.toJson === 'function' ? e.toJson() : e;

  db.exec('BEGIN');
  try {
    insertEvent.run(e.id, ts, e.event, roomSid, roomName, p?.identity ?? null, JSON.stringify(payload));

    // Webhooks only start flowing when the collector does, so a room may already be running: mark such sessions partial.
    if (roomSid && roomName && e.event !== 'egress_started' && e.event !== 'egress_updated' && e.event !== 'egress_ended') {
      const startedAt = e.event === 'room_started' ? secs(e.room?.creationTime) || ts : ts;
      ensureSession.run(roomSid, roomName, startedAt, e.event === 'room_started' ? 0 : 1);
    }
    if (e.event === 'room_finished' && roomSid) {
      db.prepare('UPDATE sessions SET ended_at = ? WHERE room_sid = ?').run(ts, roomSid);
      db.prepare('UPDATE participants SET left_at = ? WHERE room_sid = ? AND left_at IS NULL').run(ts, roomSid);
    }
    if (p && roomSid && (e.event === 'participant_joined' || e.event === 'participant_left' || e.event === 'participant_connection_aborted')) {
      const kind = typeof p.kind === 'number' ? String(p.kind) : p.kind;
      upsertParticipant.run(roomSid, p.sid, p.identity, p.name || null, kind ?? null, secs(p.joinedAt) || ts, JSON.stringify(p.attributes ?? {}));
      if (e.event !== 'participant_joined') {
        db.prepare('UPDATE participants SET left_at = ? WHERE room_sid = ? AND sid = ?').run(ts, roomSid, p.sid);
      }
    }
    if (e.egressInfo) {
      const i = e.egressInfo;
      upsertEgress.run(
        i.egressId, i.roomId || null, i.roomName || null, String(i.status), nanos(i.startedAt) || null, nanos(i.endedAt) || null,
        JSON.stringify(typeof i.toJson === 'function' ? i.toJson() : i),
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
