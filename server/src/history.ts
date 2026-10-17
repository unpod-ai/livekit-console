import { Router } from 'express';
import { statSync } from 'node:fs';
import { db } from './db.js';

export const history = Router();

const AGENT = `('AGENT','4')`;
const SIP = `('SIP','3')`;
const KINDS: Record<string, string> = { '0': 'STANDARD', '1': 'INGRESS', '2': 'EGRESS', '3': 'SIP', '4': 'AGENT' };
const kindName = (k: string | null): string => (k ? KINDS[k] ?? k : 'STANDARD');
// The collector stores enums as the numbers the SDK parses them to; the UI wants the protobuf names.
const EGRESS_STATUS: Record<string, string> = { '0': 'EGRESS_STARTING', '1': 'EGRESS_ACTIVE', '2': 'EGRESS_ENDING', '3': 'EGRESS_COMPLETE', '4': 'EGRESS_FAILED', '5': 'EGRESS_ABORTED', '6': 'EGRESS_LIMIT_REACHED' };
const egressStatus = (s: string | null): string | null => (s == null ? s : EGRESS_STATUS[s] ?? s);

const intParam = (v: unknown, dflt: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : dflt;
};
const offsetParam = (v: unknown): number => (Number(v) > 0 ? Number(v) : 0);
const since = (hours: number): number => Date.now() - hours * 3600 * 1000;
const like = (v: unknown): string => (typeof v === 'string' && v ? `%${v}%` : '%');

// SIP participants carry call details as attributes. Inbound calls are matched by a dispatch rule (sip.ruleID);
// outbound calls are placed through a trunk. LiveKit records no call detail records, so this is all there is.
function sipCall(row: any) {
  const a = JSON.parse(row.attributes || '{}');
  const direction: 'inbound' | 'outbound' | null = a['sip.ruleID'] ? 'inbound' : a['sip.trunkID'] ? 'outbound' : null;
  const remote = a['sip.phoneNumber'] ?? null; // the other party
  const ours = a['sip.trunkPhoneNumber'] ?? null; // our trunk number
  return {
    id: row.sid as string,
    callId: a['sip.callID'] ?? null,
    direction,
    from: direction === 'outbound' ? ours : remote,
    to: direction === 'outbound' ? remote : ours,
    callStatus: a['sip.callStatus'] ?? null,
    trunkId: a['sip.trunkID'] ?? null,
    ruleId: a['sip.ruleID'] ?? null,
    roomSid: row.room_sid as string,
    roomName: row.room_name as string,
    identity: row.identity as string,
    joinedAt: row.joined_at as number,
    leftAt: (row.left_at as number | null) ?? null,
    state: row.left_at ? 'completed' : 'active',
    attributes: a,
  };
}

history.get('/sessions', (req, res) => {
  const hours = intParam(req.query.hours, 24, 24 * 90);
  const limit = intParam(req.query.limit, 50, 200);
  const q = like(req.query.q);
  const status = req.query.status === 'active' ? 'AND s.ended_at IS NULL' : req.query.status === 'closed' ? 'AND s.ended_at IS NOT NULL' : '';
  const feature = ({
    agents: `AND EXISTS(SELECT 1 FROM participants p WHERE p.room_sid = s.room_sid AND p.kind IN ${AGENT})`,
    sip: `AND EXISTS(SELECT 1 FROM participants p WHERE p.room_sid = s.room_sid AND p.kind IN ${SIP})`,
    egress: 'AND EXISTS(SELECT 1 FROM egress e WHERE e.room_sid = s.room_sid)',
  } as Record<string, string>)[String(req.query.feature)] ?? '';
  const where = `s.started_at >= ? AND (s.room_name LIKE ? OR s.room_sid LIKE ?) ${status} ${feature}`;
  const rows = db
    .prepare(
      `SELECT s.room_sid, s.room_name, s.started_at, s.ended_at, s.partial,
        (SELECT COUNT(DISTINCT identity) FROM participants p WHERE p.room_sid = s.room_sid) AS participants,
        EXISTS(SELECT 1 FROM participants p WHERE p.room_sid = s.room_sid AND p.kind IN ${AGENT}) AS has_agent,
        EXISTS(SELECT 1 FROM participants p WHERE p.room_sid = s.room_sid AND p.kind IN ${SIP}) AS has_sip,
        EXISTS(SELECT 1 FROM egress e WHERE e.room_sid = s.room_sid) AS has_egress
       FROM sessions s WHERE ${where} ORDER BY s.started_at DESC LIMIT ? OFFSET ?`,
    )
    .all(since(hours), q, q, limit, offsetParam(req.query.offset));
  const total = db.prepare(`SELECT COUNT(*) AS n FROM sessions s WHERE ${where}`).get(since(hours), q, q) as { n: number };
  const rooms = db.prepare('SELECT COUNT(DISTINCT room_name) AS n, COUNT(DISTINCT room_sid) AS sessions FROM sessions WHERE started_at >= ?').get(since(hours)) as any;
  const people = db.prepare('SELECT COUNT(DISTINCT identity) AS n FROM participants WHERE joined_at >= ?').get(since(hours)) as { n: number };
  res.json({ total: total.n, rows, uniqueParticipants: people.n, totalRooms: rooms.n });
});

history.get('/sessions/:sid', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE room_sid = ?').get(req.params.sid) as any;
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const participants = (db.prepare('SELECT * FROM participants WHERE room_sid = ? ORDER BY joined_at').all(req.params.sid) as any[]).map((p) => ({
    ...p,
    kind: kindName(p.kind),
    attributes: JSON.parse(p.attributes || '{}'),
  }));
  const egress = (db.prepare('SELECT egress_id, status, started_at, ended_at, info FROM egress WHERE room_sid = ?').all(req.params.sid) as any[]).map(({ info, ...e }) => ({ ...e, status: egressStatus(e.status), destination: egressDestination(JSON.parse(info)), files: egressFiles(JSON.parse(info)) }));
  const events = db.prepare('SELECT id, ts, type, identity FROM events WHERE room_sid = ? ORDER BY ts').all(req.params.sid);

  // Participants-over-time step series.
  const edges: [number, number][] = [];
  for (const p of participants) {
    edges.push([p.joined_at, 1]);
    if (p.left_at) edges.push([p.left_at, -1]);
  }
  edges.sort((a, b) => a[0] - b[0]);
  let n = 0;
  const timeline = edges.map(([t, d]) => ({ t, n: (n += d) }));
  const totalBytes = null; // bandwidth is only known to LiveKit Cloud's analytics pipeline, not exposed by the OSS server
  res.json({ session, participants, egress, events, timeline, totalBytes });
});

history.get('/sessions/:sid/participants/:psid', (req, res) => {
  const p = db.prepare('SELECT * FROM participants WHERE room_sid = ? AND sid = ?').get(req.params.sid, req.params.psid) as any;
  if (!p) {
    res.status(404).json({ error: 'Participant not found' });
    return;
  }
  const sessions = (db.prepare('SELECT sid, joined_at, left_at FROM participants WHERE room_sid = ? AND identity = ? ORDER BY joined_at').all(req.params.sid, p.identity)) as any[];
  const events = db.prepare('SELECT id, ts, type, payload FROM events WHERE room_sid = ? AND identity = ? ORDER BY ts').all(req.params.sid, p.identity) as any[];
  const tracks = new Map<string, any>();
  for (const e of events) {
    if (e.type !== 'track_published' && e.type !== 'track_unpublished') continue;
    const t = JSON.parse(e.payload).track;
    if (!t?.sid) continue;
    tracks.set(t.sid, { ...(tracks.get(t.sid) ?? {}), sid: t.sid, name: t.name, type: t.type, source: t.source, mimeType: t.mimeType, publishedAt: tracks.get(t.sid)?.publishedAt ?? e.ts, unpublishedAt: e.type === 'track_unpublished' ? e.ts : null });
  }
  res.json({
    participant: { ...p, kind: kindName(p.kind), attributes: JSON.parse(p.attributes || '{}') },
    sessions,
    tracks: [...tracks.values()],
    events: events.map(({ id, ts, type }) => ({ id, ts, type })),
  });
});

history.get('/calls', (req, res) => {
  const hours = intParam(req.query.hours, 24, 24 * 90);
  const limit = intParam(req.query.limit, 50, 200);
  const q = like(req.query.q);
  const all = db
    .prepare(
      `SELECT p.sid, p.room_sid, s.room_name, p.identity, p.attributes, p.joined_at, p.left_at
       FROM participants p JOIN sessions s ON s.room_sid = p.room_sid
       WHERE p.kind IN ${SIP} AND p.joined_at >= ? AND (p.attributes LIKE ? OR s.room_name LIKE ?) ORDER BY p.joined_at DESC`,
    )
    .all(since(hours), q, q)
    .map(sipCall)
    .filter((c) => (req.query.direction ? c.direction === req.query.direction : true))
    .filter((c) => (req.query.state ? c.state === req.query.state : true));
  const offset = offsetParam(req.query.offset);
  const sum = (dir?: string) => all.filter((c) => !dir || c.direction === dir).reduce((s, c) => s + ((c.leftAt ?? Date.now()) - c.joinedAt), 0);
  res.json({
    total: all.length,
    active: all.filter((c) => c.state === 'active').length,
    totalDurationMs: sum(),
    avgDurationMs: all.length ? sum() / all.length : 0,
    rows: all.slice(offset, offset + limit).map(({ attributes: _a, ...c }) => c),
  });
});

history.get('/calls/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT p.sid, p.room_sid, s.room_name, p.identity, p.attributes, p.joined_at, p.left_at
       FROM participants p JOIN sessions s ON s.room_sid = p.room_sid WHERE p.sid = ? AND p.kind IN ${SIP}`,
    )
    .get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  const call = sipCall(row);
  const events = db.prepare('SELECT id, ts, type, identity FROM events WHERE room_sid = ? AND identity = ? ORDER BY ts').all(call.roomSid, call.identity);
  res.json({ call, events });
});

history.get('/egress', (req, res) => {
  const hours = intParam(req.query.hours, 168, 24 * 90);
  const rows = db
    .prepare('SELECT egress_id, room_sid, room_name, status, started_at, ended_at, info FROM egress WHERE COALESCE(started_at,0) >= ? ORDER BY started_at DESC LIMIT 500')
    .all(since(hours)) as any[];
  res.json(rows.map(({ info, ...r }) => { const i = JSON.parse(info); return { ...r, status: egressStatus(r.status), type: egressType(i), destination: egressDestination(i), files: egressFiles(i) }; }));
});

// Where an egress writes to, from the request that started it (never its credentials).
function egressDestination(info: any): string {
  const req = info.roomComposite ?? info.participant ?? info.trackComposite ?? info.track ?? info.web ?? {};
  const out = req.fileOutputs?.[0] ?? req.file ?? req.segmentOutputs?.[0] ?? {};
  if (out.s3?.bucket) return `s3://${out.s3.bucket}`;
  if (out.gcp?.bucket) return `gs://${out.gcp.bucket}`;
  if (out.azure?.containerName) return `azure://${out.azure.containerName}`;
  if (out.aliOSS?.bucket) return `oss://${out.aliOSS.bucket}`;
  if (req.streamOutputs?.length || req.stream) return 'stream';
  return out.filepath || info.fileResults?.length ? 'local' : '—';
}

function egressFiles(info: any): { name: string; location: string; size: number | null; durationMs: number | null }[] {
  const files = (info.fileResults ?? []).map((f: any) => ({ name: f.filename ?? '', location: f.location ?? '', size: f.size ? Number(f.size) : null, durationMs: f.duration ? Math.round(Number(f.duration) / 1e6) : null }));
  const segs = (info.segmentResults ?? []).map((f: any) => ({ name: f.playlistName ?? '', location: f.playlistLocation ?? '', size: f.size ? Number(f.size) : null, durationMs: f.duration ? Math.round(Number(f.duration) / 1e6) : null }));
  return [...files, ...segs].filter((f) => f.name || f.location);
}

function egressType(info: any): string {
  return info.roomComposite ? 'Room composite' : info.participant ? 'Participant' : info.trackComposite ? 'Track composite' : info.track ? 'Track' : info.web ? 'Web' : 'Unknown';
}

history.get('/insights', (req, res) => {
  const hours = intParam(req.query.hours, 168, 24 * 90);
  const from = since(hours);
  const one = (sql: string): any => db.prepare(sql).get(from);
  const sessions = one('SELECT COUNT(*) AS n, AVG(ended_at - started_at) AS avg_ms FROM sessions WHERE started_at >= ?');
  const withAgents = one(`SELECT COUNT(DISTINCT room_sid) AS n FROM participants WHERE kind IN ${AGENT} AND joined_at >= ?`);
  const withSip = one(`SELECT COUNT(DISTINCT room_sid) AS n FROM participants WHERE kind IN ${SIP} AND joined_at >= ?`);
  const people = one('SELECT COUNT(DISTINCT identity) AS n FROM participants WHERE joined_at >= ?');
  const agentMs = db
    .prepare(`SELECT COALESCE(SUM(COALESCE(left_at, ?) - joined_at),0) AS ms FROM participants WHERE kind IN ${AGENT} AND joined_at >= ?`)
    .get(Date.now(), from) as { ms: number };
  const bucket = hours <= 48 ? 3600 * 1000 : 24 * 3600 * 1000;
  const series = db
    .prepare(`SELECT (started_at / ${bucket}) * ${bucket} AS t, COUNT(*) AS n FROM sessions WHERE started_at >= ? GROUP BY t ORDER BY t`)
    .all(from);
  res.json({
    hours,
    sessions: sessions.n,
    sessionsWithAgents: withAgents.n,
    sessionsWithTelephony: withSip.n,
    avgSessionMs: sessions.avg_ms ?? 0,
    agentSessionMinutes: Math.round((agentMs.ms ?? 0) / 60000),
    participants: people.n,
    series,
    bucketMs: bucket,
  });
});

// Mirrors the Cloud "Usage" page. Everything is computed from stored webhook data and attributed to the bucket in
// which the session/participant started. Bandwidth/data transfer is not available on a self-hosted server.
history.get('/usage', (req, res) => {
  const hours = intParam(req.query.hours, 168, 24 * 90);
  const from = since(hours);
  const now = Date.now();
  const bucket = hours <= 48 ? 3600 * 1000 : 24 * 3600 * 1000;
  const b = (t: number) => Math.floor(t / bucket) * bucket;
  const mins = (s: number, e: number | null) => Math.max(0, ((e ?? now) - s) / 60000);

  const series = new Map<number, { t: number; sessions: number; agentMin: number; sipInMin: number; sipOutMin: number; webrtcMin: number; egressMin: number }>();
  const at = (t: number) => {
    const k = b(t);
    if (!series.has(k)) series.set(k, { t: k, sessions: 0, agentMin: 0, sipInMin: 0, sipOutMin: 0, webrtcMin: 0, egressMin: 0 });
    return series.get(k)!;
  };

  const sessions = db.prepare('SELECT room_sid, started_at, ended_at FROM sessions WHERE started_at >= ?').all(from) as any[];
  const parts = db.prepare('SELECT room_sid, kind, joined_at, left_at, attributes FROM participants WHERE joined_at >= ?').all(from) as any[];
  const egress = db.prepare('SELECT started_at, ended_at, info FROM egress WHERE COALESCE(started_at,0) >= ?').all(from) as any[];

  for (const s of sessions) at(s.started_at).sessions++;
  let agentMin = 0, webrtcMin = 0, sipIn = 0, sipOut = 0, sipInCalls = 0, sipOutCalls = 0;
  for (const p of parts) {
    const m = mins(p.joined_at, p.left_at);
    const kind = kindName(p.kind);
    const row = at(p.joined_at);
    if (kind === 'AGENT') { agentMin += m; row.agentMin += m; }
    else if (kind === 'SIP') {
      const a = JSON.parse(p.attributes || '{}');
      if (a['sip.ruleID']) { sipIn += m; sipInCalls++; row.sipInMin += m; } else { sipOut += m; sipOutCalls++; row.sipOutMin += m; }
    } else if (kind === 'STANDARD') { webrtcMin += m; row.webrtcMin += m; }
  }
  const egressByType: Record<string, { count: number; minutes: number }> = {};
  for (const e of egress) {
    const type = egressType(JSON.parse(e.info));
    const m = mins(e.started_at, e.ended_at);
    egressByType[type] ??= { count: 0, minutes: 0 };
    egressByType[type].count++;
    egressByType[type].minutes += m;
    at(e.started_at).egressMin += m;
  }
  const sizes = db.prepare('SELECT COUNT(DISTINCT identity) AS n FROM participants WHERE joined_at >= ? GROUP BY room_sid').all(from) as { n: number }[];
  const durations = sessions.filter((s) => s.ended_at).map((s) => s.ended_at - s.started_at);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0);

  res.json({
    hours,
    bucketMs: bucket,
    totals: {
      roomSessions: sessions.length,
      avgRoomSize: Math.round(avg(sizes.map((s) => s.n)) * 10) / 10,
      avgRoomDurationMs: avg(durations),
      agentSessionMinutes: Math.round(agentMin),
      webrtcParticipantMinutes: Math.round(webrtcMin),
      sipParticipantMinutes: Math.round(sipIn + sipOut),
      sipInboundMinutes: Math.round(sipIn),
      sipOutboundMinutes: Math.round(sipOut),
      sipInboundCalls: sipInCalls,
      sipOutboundCalls: sipOutCalls,
      egressByType,
    },
    series: [...series.values()].sort((x, y) => x.t - y.t),
  });
});

history.get('/collector', (_req, res) => {
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const span = db.prepare('SELECT MIN(ts) AS first, MAX(ts) AS last FROM events').get() as { first: number | null; last: number | null };
  let dbBytes = 0;
  try {
    dbBytes = statSync(process.env.DB_PATH ?? 'data/console.db').size;
  } catch {}
  res.json({ events: count('events'), sessions: count('sessions'), participants: count('participants'), egress: count('egress'), firstEventAt: span.first, lastEventAt: span.last, dbBytes });
});
