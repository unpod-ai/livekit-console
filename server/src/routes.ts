import { Router } from 'express';
import type { Request, Response } from 'express';
import { config } from './config.js';
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

api.get('/config', (_req, res) => res.json({ wsUrl: config.wsUrl }));

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
