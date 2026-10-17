import { Router } from 'express';
import type { Request, Response } from 'express';
import { config } from './config.js';
import { JobStatus } from '@livekit/protocol';
import { randomBytes } from 'node:crypto';
import { PING_ROOM_PREFIX } from './collector.js';
import { db } from './db.js';
import { authOf } from './auth.js';
import { agentDispatch, createToken, rooms } from './livekit.js';
import { SERVICES, TwirpError, twirp, type Service } from './twirp.js';

// protobuf-es messages carry bigint fields that JSON.stringify rejects; toJson() handles them.
const toJson = (m: unknown): unknown =>
  m && typeof (m as { toJson?: unknown }).toJson === 'function'
    ? (m as { toJson: () => unknown }).toJson()
    : m;
const toJsonList = (list: unknown[]): unknown[] => list.map(toJson);

type Handler = (req: Request) => Promise<unknown>;
const wrap =
  (fn: Handler) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await fn(req));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  };

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`${name} is required`);
  return v;
};
export const api = Router();

api.get('/config', (_req, res) => res.json({ wsUrl: config.wsUrl, sipUri: config.sipUri || null }));

// Rooms
api.get('/rooms', wrap(async () => toJsonList(await rooms.listRooms())));
api.post(
  '/rooms',
  wrap(async (req) =>
    toJson(
      await rooms.createRoom({
        name: str(req.body.name, 'name'),
        emptyTimeout: Number(req.body.emptyTimeout ?? 300),
        maxParticipants: Number(req.body.maxParticipants ?? 0),
      }),
    ),
  ),
);
api.delete('/rooms/:name', wrap(async (req) => (await rooms.deleteRoom(req.params.name), { ok: true })));
api.get('/rooms/:name/participants', wrap(async (req) => toJsonList(await rooms.listParticipants(req.params.name))));
api.delete(
  '/rooms/:name/participants/:identity',
  wrap(async (req) => (await rooms.removeParticipant(req.params.name, req.params.identity), { ok: true })),
);

// Tokens
api.post(
  '/token',
  wrap(async (req) => ({
    token: await createToken({
      room: str(req.body.room, 'room'),
      identity: str(req.body.identity, 'identity'),
      name: req.body.name || undefined,
      canPublish: req.body.canPublish !== false,
      canSubscribe: req.body.canSubscribe !== false,
      ttlSeconds: Number(req.body.ttlSeconds ?? 3600),
    }),
    wsUrl: config.wsUrl,
  })),
);

// Agent dispatch (explicitly send an agent to a room)
api.get('/rooms/:name/dispatches', wrap(async (req) => toJsonList(await agentDispatch.listDispatch(req.params.name))));
api.post(
  '/rooms/:name/dispatches',
  wrap(async (req) =>
    toJson(await agentDispatch.createDispatch(req.params.name, str(req.body.agentName, 'agentName'), { metadata: req.body.metadata || undefined })),
  ),
);
api.delete(
  '/rooms/:name/dispatches/:id',
  wrap(async (req) => (await agentDispatch.deleteDispatch(req.params.id, req.params.name), { ok: true })),
);

// SIP / egress / ingress: forward the protobuf-JSON body to LiveKit's Twirp API (see twirp.ts).
api.post('/lk/:service/:method', async (req, res) => {
  const { service, method } = req.params;
  if (!(service in SERVICES) || !/^[A-Za-z]{3,40}$/.test(method)) {
    res.status(400).json({ error: 'Unknown service or method' });
    return;
  }
  try {
    res.json(await twirp(service as Service, method, req.body));
  } catch (err) {
    // Never relay LiveKit's 401/403 as-is: the UI would read it as "logged out of the console".
    const status = err instanceof TwirpError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 ? err.status : 502;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Agents that are inside a live room right now, straight from LiveKit.
api.get(
  '/agents/live',
  wrap(async () => {
    const out: unknown[] = [];
    for (const r of (await rooms.listRooms()).filter((x) => !x.name.startsWith(PING_ROOM_PREFIX)).slice(0, 100)) {
      for (const p of await rooms.listParticipants(r.name)) {
        if (p.kind !== 4) continue; // ParticipantInfo.Kind.AGENT
        const a = p.attributes ?? {};
        out.push({
          agentName: a['lk.agent.name'] ?? a['lk.agent_name'] ?? a['agent.name'] ?? 'unknown',
          state: a['lk.agent.state'] ?? null,
          identity: p.identity,
          roomName: r.name,
          roomSid: r.sid,
          joinedAt: Number(p.joinedAt) * 1000,
        });
      }
    }
    return out;
  }),
);

// Agent ping: ask LiveKit to dispatch the agent into a throwaway empty room. A job only starts if a worker for that
// name is registered and accepts it, so this proves the agent is up even when it is idle. The room is always removed.
const PING_TIMEOUT_MS = 15_000;
api.post(
  '/agents/ping',
  wrap(async (req) => {
    const agentName = str(req.body.agentName, 'agentName');
    const room = `${PING_ROOM_PREFIX}${randomBytes(4).toString('hex')}`;
    const t0 = Date.now();
    let ok = false;
    let workerId: string | null = null;
    let error: string | null = null;
    try {
      await rooms.createRoom({ name: room, emptyTimeout: 30, departureTimeout: 5 });
      await agentDispatch.createDispatch(room, agentName, { metadata: JSON.stringify({ ping: true }) });
      while (Date.now() - t0 < PING_TIMEOUT_MS && !ok) {
        await new Promise((r) => setTimeout(r, 400));
        const jobs = (await agentDispatch.listDispatch(room)).flatMap((d) => d.state?.jobs ?? []);
        const accepted = jobs.find((j) => j.state && j.state.status !== JobStatus.JS_PENDING);
        if (accepted) {
          ok = true;
          workerId = accepted.state?.workerId || null;
        }
      }
      if (!ok) error = `No worker accepted the job within ${PING_TIMEOUT_MS / 1000}s. The agent is probably not running or not registered under this name.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      await rooms.deleteRoom(room).catch(() => {});
    }
    const latencyMs = Date.now() - t0;
    db.prepare('INSERT INTO agent_pings (agent_name, at, ok, latency_ms, worker_id, error, by_user) VALUES (?,?,?,?,?,?,?)').run(agentName, Date.now(), ok ? 1 : 0, ok ? latencyMs : null, workerId, error, authOf(req).user);
    return { ok, latencyMs, workerId, error, at: Date.now() };
  }),
);
