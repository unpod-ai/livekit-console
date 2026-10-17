import { Router } from 'express';
import { statSync } from 'node:fs';
import { config } from './config.js';
import { db } from './db.js';
import { trafficState } from './traffic.js';
import { workerStatuses } from './workers.js';
import { redactCredentials } from './twirp.js';

export const history = Router();

const AGENT = `('AGENT','4')`;
const SIP = `('SIP','3')`;
const KINDS: Record<string, string> = { '0': 'STANDARD', '1': 'INGRESS', '2': 'EGRESS', '3': 'SIP', '4': 'AGENT' };
const kindName = (k: string | null): string => (k ? KINDS[k] ?? k : 'STANDARD');
// The collector stores enums as the numbers the SDK parses them to; the UI wants the protobuf names.
const EGRESS_STATUS: Record<string, string> = { '0': 'EGRESS_STARTING', '1': 'EGRESS_ACTIVE', '2': 'EGRESS_ENDING', '3': 'EGRESS_COMPLETE', '4': 'EGRESS_FAILED', '5': 'EGRESS_ABORTED', '6': 'EGRESS_LIMIT_REACHED' };
const egressStatus = (s: string | null): string | null => (s == null ? s : EGRESS_STATUS[s] ?? s);

// Agent participants carry the name of the agent they run as in their attributes.
const agentNameOf = (attrs: Record<string, string>): string => attrs['lk.agent.name'] ?? attrs['lk.agent_name'] ?? attrs['agent.name'] ?? 'unknown';

// Country by the calling code of a SIP participant's phone number: the closest self-hosted analogue of Cloud's
// "Top countries" (which uses client geolocation that SIP callers don't have).
const CALLING_CODES: Record<string, string> = {
  '1': 'United States / Canada', '7': 'Russia / Kazakhstan', '20': 'Egypt', '27': 'South Africa', '30': 'Greece', '31': 'Netherlands', '32': 'Belgium',
  '33': 'France', '34': 'Spain', '36': 'Hungary', '39': 'Italy', '40': 'Romania', '41': 'Switzerland', '43': 'Austria', '44': 'United Kingdom',
  '45': 'Denmark', '46': 'Sweden', '47': 'Norway', '48': 'Poland', '49': 'Germany', '51': 'Peru', '52': 'Mexico', '54': 'Argentina', '55': 'Brazil',
  '56': 'Chile', '57': 'Colombia', '58': 'Venezuela', '60': 'Malaysia', '61': 'Australia', '62': 'Indonesia', '63': 'Philippines', '64': 'New Zealand',
  '65': 'Singapore', '66': 'Thailand', '81': 'Japan', '82': 'South Korea', '84': 'Vietnam', '86': 'China', '90': 'Turkey', '91': 'India', '92': 'Pakistan',
  '93': 'Afghanistan', '94': 'Sri Lanka', '95': 'Myanmar', '98': 'Iran', '212': 'Morocco', '213': 'Algeria', '234': 'Nigeria', '254': 'Kenya',
  '351': 'Portugal', '353': 'Ireland', '358': 'Finland', '380': 'Ukraine', '420': 'Czechia', '880': 'Bangladesh', '960': 'Maldives', '966': 'Saudi Arabia',
  '971': 'United Arab Emirates', '972': 'Israel', '973': 'Bahrain', '974': 'Qatar', '975': 'Bhutan', '977': 'Nepal',
};
function countryOf(phone: string | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits || digits.startsWith('0')) return 'Unknown';
  return CALLING_CODES[digits.slice(0, 3)] ?? CALLING_CODES[digits.slice(0, 2)] ?? CALLING_CODES[digits.slice(0, 1)] ?? 'Unknown';
}
const percentile = (sorted: number[], p: number): number | null => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null);
const bucketFor = (hours: number): number => (hours <= 48 ? 3600 * 1000 : 24 * 3600 * 1000);

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
    providerCallId: a['sip.callIDFull'] ?? null,
    sipHost: a['sip.hostname'] ?? null,
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
  const agent = typeof req.query.agent === 'string' && req.query.agent ? `AND EXISTS(SELECT 1 FROM participants p WHERE p.room_sid = s.room_sid AND p.kind IN ${AGENT} AND p.attributes LIKE '%"lk.agent.name":' || json_quote(?) || '%')` : '';
  const where = `s.started_at >= ? AND (s.room_name LIKE ? OR s.room_sid LIKE ?) ${status} ${feature} ${agent}`;
  const rows = db
    .prepare(
      `SELECT s.room_sid, s.room_name, s.started_at, s.ended_at, s.partial,
        (SELECT COUNT(DISTINCT identity) FROM participants p WHERE p.room_sid = s.room_sid) AS participants,
        EXISTS(SELECT 1 FROM participants p WHERE p.room_sid = s.room_sid AND p.kind IN ${AGENT}) AS has_agent,
        EXISTS(SELECT 1 FROM participants p WHERE p.room_sid = s.room_sid AND p.kind IN ${SIP}) AS has_sip,
        EXISTS(SELECT 1 FROM egress e WHERE e.room_sid = s.room_sid) AS has_egress
       FROM sessions s WHERE ${where} ORDER BY s.started_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...[since(hours), q, q, ...(agent ? [String(req.query.agent)] : []), limit, offsetParam(req.query.offset)]);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM sessions s WHERE ${where}`).get(...[since(hours), q, q, ...(agent ? [String(req.query.agent)] : [])]) as { n: number };
  const rooms = db.prepare('SELECT COUNT(DISTINCT room_name) AS n, COUNT(DISTINCT room_sid) AS sessions FROM sessions WHERE started_at >= ?').get(since(hours)) as any;
  const people = db.prepare('SELECT COUNT(DISTINCT identity) AS n FROM participants WHERE joined_at >= ?').get(since(hours)) as { n: number };
  const bucketMs = hours <= 48 ? 3600 * 1000 : 24 * 3600 * 1000;
  const series = db.prepare(`SELECT (started_at / ${bucketMs}) * ${bucketMs} AS t, COUNT(*) AS n FROM sessions WHERE started_at >= ? GROUP BY t ORDER BY t`).all(since(hours));
  const peopleSeries = db.prepare(`SELECT (joined_at / ${bucketMs}) * ${bucketMs} AS t, COUNT(DISTINCT identity) AS n FROM participants WHERE joined_at >= ? GROUP BY t ORDER BY t`).all(since(hours));
  res.json({ total: total.n, rows, uniqueParticipants: people.n, totalRooms: rooms.n, bucketMs, series, peopleSeries });
});

history.get('/sessions/:sid', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE room_sid = ?').get(req.params.sid) as any;
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const rawParticipants = db.prepare('SELECT * FROM participants WHERE room_sid = ? ORDER BY joined_at').all(req.params.sid) as any[];
  const participants = rawParticipants.map((p) => ({ ...p, kind: kindName(p.kind), attributes: JSON.parse(p.attributes || '{}') }));
  const calls = rawParticipants
    .filter((p) => kindName(p.kind) === 'SIP')
    .map((p) => sipCall({ ...p, room_name: session.room_name }))
    .map(({ attributes: _a, ...c }) => c);
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
  res.json({ session, participants, calls, egress, events, timeline, totalBytes });
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

history.get('/agents', (req, res) => {
  const hours = intParam(req.query.hours, 168, 24 * 90);
  const now = Date.now();
  const rows = db
    .prepare(`SELECT p.room_sid, p.attributes, p.joined_at, p.left_at FROM participants p WHERE p.kind IN ${AGENT} AND p.joined_at >= ? ORDER BY p.joined_at`)
    .all(since(hours)) as { room_sid: string; attributes: string; joined_at: number; left_at: number | null }[];
  const byName = new Map<string, { name: string; sessions: Set<string>; jobs: number; ms: number; active: number; lastSeenAt: number; firstSeenAt: number }>();
  for (const r of rows) {
    const name = agentNameOf(JSON.parse(r.attributes || '{}'));
    const a = byName.get(name) ?? { name, sessions: new Set(), jobs: 0, ms: 0, active: 0, lastSeenAt: 0, firstSeenAt: r.joined_at };
    a.sessions.add(r.room_sid);
    a.jobs++;
    a.ms += (r.left_at ?? now) - r.joined_at;
    if (!r.left_at) a.active++;
    a.lastSeenAt = Math.max(a.lastSeenAt, r.left_at ?? now);
    byName.set(name, a);
  }
  res.json([...byName.values()].map((a) => ({ name: a.name, sessions: a.sessions.size, jobs: a.jobs, minutes: Math.round(a.ms / 60000), avgMs: a.jobs ? a.ms / a.jobs : 0, activeNow: a.active, lastSeenAt: a.lastSeenAt, firstSeenAt: a.firstSeenAt })).sort((x, y) => y.lastSeenAt - x.lastSeenAt));
});

// Worker status polled from each configured agent worker (see workers.ts), with uptime and load over the range.
// `former` lists workers that were polled in the past but are no longer configured; both kinds carry when they were
// last checked and last healthy, so a dead worker still shows when it stopped answering.
history.get('/agent-workers', (req, res) => {
  const hours = intParam(req.query.hours, 168, 24 * 90);
  const stats = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(ok),0) AS up, AVG(CASE WHEN ok = 1 THEN load END) AS avgLoad FROM agent_worker_samples WHERE url = ? AND at >= ?');
  const seen = db.prepare('SELECT MIN(at) AS firstSeenAt, MAX(CASE WHEN ok = 1 THEN at END) AS lastOkAt, MAX(at) AS lastCheckedAt FROM agent_worker_samples WHERE url = ?');
  const last = db.prepare('SELECT agent_name AS agentName, worker_type AS workerType, sdk_version AS sdkVersion, project_type AS projectType FROM agent_worker_samples WHERE url = ? AND agent_name IS NOT NULL ORDER BY at DESC LIMIT 1');
  // A worker's outages in the range: each run of failed checks, with when it began and when the worker came back.
  const samplesOf = db.prepare('SELECT at, ok FROM agent_worker_samples WHERE url = ? AND at >= ? ORDER BY at');
  const outagesOf = (url: string) => {
    const out: { from: number; to: number | null; checks: number }[] = [];
    let open: { from: number; to: number | null; checks: number } | null = null;
    for (const s of samplesOf.all(url, since(hours)) as { at: number; ok: number }[]) {
      if (!s.ok) {
        if (!open) out.push((open = { from: s.at, to: null, checks: 0 }));
        open.checks++;
      } else if (open) {
        open.to = s.at;
        open = null;
      }
    }
    return out.reverse().slice(0, 25);
  };
  const describe = (url: string) => {
    const x = stats.get(url, since(hours)) as { n: number; up: number; avgLoad: number | null };
    return {
      ...(seen.get(url) as { firstSeenAt: number | null; lastOkAt: number | null; lastCheckedAt: number | null }),
      uptimePct: x.n ? Math.round((x.up / x.n) * 1000) / 10 : null,
      avgLoadPct: x.avgLoad == null ? null : Math.round(x.avgLoad * 1000) / 10,
      samples: x.n,
      outages: outagesOf(url),
    };
  };
  const current = workerStatuses();
  const known = new Set([...config.workerUrls, ...current.map((w) => w.url)]);
  const retired = (db.prepare('SELECT DISTINCT url FROM agent_worker_samples').all() as { url: string }[]).map((r) => r.url).filter((u) => !known.has(u));
  res.json({
    configured: config.workerUrls.length > 0,
    // a dead worker can't report its type/SDK any more, so fall back to what it last reported
    workers: current.map((w) => {
      const was = (last.get(w.url) ?? {}) as { workerType?: string; sdkVersion?: string; projectType?: string };
      return { ...w, workerType: w.workerType ?? was.workerType ?? null, sdkVersion: w.sdkVersion ?? was.sdkVersion ?? null, projectType: w.projectType ?? was.projectType ?? null, ...describe(w.url) };
    }),
    former: retired.map((url) => ({ url, ok: false, ...(last.get(url) as object | undefined), ...describe(url) })),
  });
});

// Daily GitHub clone/view counts that the traffic sync (traffic.ts) has copied into the database.
history.get('/repo-traffic', (req, res) => {
  const days = intParam(req.query.days, 30, 365);
  const from = Date.now() - days * 86400_000;
  const rows = db.prepare('SELECT day AS t, kind, count, uniques FROM repo_traffic WHERE day >= ? ORDER BY day').all(from) as { t: number; kind: string; count: number; uniques: number }[];
  const byDay = new Map<number, Record<string, number>>();
  const totals = { clones: 0, uniqueCloners: 0, views: 0, uniqueVisitors: 0 };
  for (const r of rows) {
    const d = byDay.get(r.t) ?? { t: r.t, clones: 0, uniqueCloners: 0, views: 0, uniqueVisitors: 0 };
    if (r.kind === 'clones') { d.clones = r.count; d.uniqueCloners = r.uniques; totals.clones += r.count; totals.uniqueCloners += r.uniques; }
    else { d.views = r.count; d.uniqueVisitors = r.uniques; totals.views += r.count; totals.uniqueVisitors += r.uniques; }
    byDay.set(r.t, d);
  }
  res.json({ ...trafficState(), bucketMs: 86400_000, totals, series: [...byDay.values()] });
});

history.get('/agents/:name/overview', (req, res) => {
  const name = req.params.name;
  const hours = intParam(req.query.hours, 24, 24 * 90);
  const from = since(hours);
  const bucketMs = bucketFor(hours);
  const rows = db
    .prepare(
      `SELECT p.room_sid, p.joined_at, s.started_at FROM participants p JOIN sessions s ON s.room_sid = p.room_sid
       WHERE p.kind IN ${AGENT} AND p.joined_at >= ? AND p.attributes LIKE '%"lk.agent.name":' || json_quote(?) || '%'`,
    )
    .all(from, name) as { room_sid: string; joined_at: number; started_at: number }[];
  const bySessions = new Map<number, Set<string>>();
  const joinByBucket = new Map<number, number[]>();
  for (const r of rows) {
    const t = Math.floor(r.joined_at / bucketMs) * bucketMs;
    (bySessions.get(t) ?? bySessions.set(t, new Set()).get(t)!).add(r.room_sid);
    const join = r.joined_at - r.started_at;
    if (join >= 0 && join < 120_000) (joinByBucket.get(t) ?? joinByBucket.set(t, []).get(t)!).push(join);
  }
  const all: number[] = [];
  joinByBucket.forEach((v) => all.push(...v));
  all.sort((a, b) => a - b);
  const samples = db
    .prepare(`SELECT (at / ${bucketMs}) * ${bucketMs} AS t, AVG(ok) AS up, AVG(CASE WHEN ok = 1 THEN load END) AS load FROM agent_worker_samples WHERE agent_name = ? AND at >= ? GROUP BY t ORDER BY t`)
    .all(name, from) as { t: number; up: number; load: number | null }[];
  const tot = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(ok),0) AS up, AVG(CASE WHEN ok = 1 THEN load END) AS load FROM agent_worker_samples WHERE agent_name = ? AND at >= ?').get(name, from) as { n: number; up: number; load: number | null };
  res.json({
    bucketMs,
    sessions: [...bySessions.entries()].sort((a, b) => a[0] - b[0]).map(([t, set]) => ({ t, n: set.size })),
    joinLatency: [...joinByBucket.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => {
      const sorted = [...v].sort((a, b) => a - b);
      return { t, p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), p95: percentile(sorted, 0.95) };
    }),
    joinLatencyTotals: { p50: percentile(all, 0.5), p90: percentile(all, 0.9), p95: percentile(all, 0.95), count: all.length },
    uptime: samples.map((x) => ({ t: x.t, n: Math.round(x.up * 1000) / 10 })),
    load: samples.map((x) => ({ t: x.t, n: x.load == null ? 0 : Math.round(x.load * 1000) / 10 })),
    uptimePct: tot.n ? Math.round((tot.up / tot.n) * 1000) / 10 : null,
    avgLoadPct: tot.load == null ? null : Math.round(tot.load * 1000) / 10,
    samples: tot.n,
  });
});

// One agent: the sessions it has run in.
history.get('/agents/:name', (req, res) => {
  const sessions = db
    .prepare(
      `SELECT s.room_sid, s.room_name, p.joined_at, p.left_at FROM participants p JOIN sessions s ON s.room_sid = p.room_sid
       WHERE p.kind IN ${AGENT} AND p.attributes LIKE '%"lk.agent.name":' || json_quote(?) || '%' ORDER BY p.joined_at DESC LIMIT 10`,
    )
    .all(req.params.name);
  res.json({ sessions });
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
  const bucketMs = hours <= 48 ? 3600 * 1000 : 24 * 3600 * 1000;
  const byBucket = new Map<number, number>();
  for (const c of all) byBucket.set(Math.floor(c.joinedAt / bucketMs) * bucketMs, (byBucket.get(Math.floor(c.joinedAt / bucketMs) * bucketMs) ?? 0) + 1);
  res.json({
    bucketMs,
    series: [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ t, n })),
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

history.get('/egress/:id', (req, res) => {
  const row = db.prepare('SELECT egress_id, room_sid, room_name, status, started_at, ended_at, info FROM egress WHERE egress_id = ?').get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ error: 'Egress not found in history' });
    return;
  }
  const info = JSON.parse(row.info);
  const events = (db.prepare(`SELECT id, ts, type FROM events WHERE type LIKE 'egress_%' AND payload LIKE ? ORDER BY ts`).all(`%"egressId":"${req.params.id.replace(/[^A-Za-z0-9_-]/g, '')}"%`)) as any[];
  res.json({
    egress: { egressId: row.egress_id, roomSid: row.room_sid, roomName: row.room_name, status: egressStatus(row.status), startedAt: row.started_at, endedAt: row.ended_at, type: egressType(info), destination: egressDestination(info), files: egressFiles(info), error: info.error || null },
    request: redactCredentials(info.roomComposite ?? info.participant ?? info.trackComposite ?? info.track ?? info.web ?? {}),
    events,
  });
});

history.get('/insights', (req, res) => {
  const hours = intParam(req.query.hours, 168, 24 * 90);
  const from = since(hours);
  const bucketMs = bucketFor(hours);
  const one = (sql: string): any => db.prepare(sql).get(from);
  const sessions = one('SELECT COUNT(*) AS n, AVG(ended_at - started_at) AS avg_ms FROM sessions WHERE started_at >= ?');
  const withAgents = one(`SELECT COUNT(DISTINCT room_sid) AS n FROM participants WHERE kind IN ${AGENT} AND joined_at >= ?`);
  const withSip = one(`SELECT COUNT(DISTINCT room_sid) AS n FROM participants WHERE kind IN ${SIP} AND joined_at >= ?`);
  const people = one('SELECT COUNT(DISTINCT identity) AS n FROM participants WHERE joined_at >= ?');
  const agentMs = db
    .prepare(`SELECT COALESCE(SUM(COALESCE(left_at, ?) - joined_at),0) AS ms FROM participants WHERE kind IN ${AGENT} AND joined_at >= ?`)
    .get(Date.now(), from) as { ms: number };
  const grp = (sql: string) => db.prepare(sql.replaceAll('{B}', String(bucketMs))).all(from) as { t: number; n: number }[];
  const series = grp('SELECT (started_at / {B}) * {B} AS t, COUNT(*) AS n FROM sessions WHERE started_at >= ? GROUP BY t ORDER BY t');
  const agentSeries = grp(`SELECT (joined_at / {B}) * {B} AS t, COUNT(DISTINCT room_sid) AS n FROM participants WHERE kind IN ${AGENT} AND joined_at >= ? GROUP BY t ORDER BY t`);
  const sipSeries = grp(`SELECT (joined_at / {B}) * {B} AS t, COUNT(DISTINCT room_sid) AS n FROM participants WHERE kind IN ${SIP} AND joined_at >= ? GROUP BY t ORDER BY t`);
  const peopleSeries = grp('SELECT (joined_at / {B}) * {B} AS t, COUNT(DISTINCT identity) AS n FROM participants WHERE joined_at >= ? GROUP BY t ORDER BY t');
  const agentMinSeries = db
    .prepare(`SELECT (joined_at / ${bucketMs}) * ${bucketMs} AS t, ROUND(SUM(COALESCE(left_at, ?) - joined_at) / 60000.0, 1) AS n FROM participants WHERE kind IN ${AGENT} AND joined_at >= ? GROUP BY t ORDER BY t`)
    .all(Date.now(), from) as { t: number; n: number }[];

  const kinds: Record<string, number> = {};
  const countries: Record<string, number> = {};
  for (const p of db.prepare('SELECT kind, attributes FROM participants WHERE joined_at >= ?').all(from) as { kind: string | null; attributes: string }[]) {
    const k = kindName(p.kind);
    kinds[k] = (kinds[k] ?? 0) + 1;
    if (k === 'SIP') {
      const c = countryOf(JSON.parse(p.attributes || '{}')['sip.phoneNumber']);
      countries[c] = (countries[c] ?? 0) + 1;
    }
  }
  res.json({
    hours,
    sessions: sessions.n,
    sessionsWithAgents: withAgents.n,
    sessionsWithTelephony: withSip.n,
    avgSessionMs: sessions.avg_ms ?? 0,
    agentSessionMinutes: Math.round((agentMs.ms ?? 0) / 60000),
    participants: people.n,
    series,
    agentSeries,
    sipSeries,
    peopleSeries,
    agentMinSeries,
    kinds: Object.entries(kinds).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    countries: Object.entries(countries).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    bucketMs,
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
