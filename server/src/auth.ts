import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';

const COOKIE = 'lkc_session';
export type Role = 'admin' | 'viewer';
export type ContentGrant = 'transcripts' | 'recordings' | 'logs';
export type ContentCapabilities = Record<ContentGrant, boolean>;
export type Auth = { user: string; role: Role; source: 'env' | 'db'; id?: number; capabilities?: ContentCapabilities };

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const calc = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}
const DUMMY = hashPassword('not-a-real-password'); // keeps unknown-user logins as slow as real ones

type UserRow = { id: number; username: string; password_hash: string; role: Role; transcripts: number; recordings: number; logs: number };
export const capabilitiesOf = (row: Pick<UserRow, 'transcripts'|'recordings'|'logs'>): ContentCapabilities => ({transcripts:!!row.transcripts,recordings:!!row.recordings,logs:!!row.logs});
const adminCapabilities: ContentCapabilities = {transcripts:true,recordings:true,logs:true};

export function login(req: Request, res: Response): void {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  let auth: Auth | null = null;
  // The .env admin is the bootstrap account: it always works, so a bad user table can never lock everyone out.
  if (safeEqual(username, config.adminUser) && safeEqual(password, config.adminPassword)) {
    auth = { user: config.adminUser, role: 'admin', source: 'env', capabilities: {...adminCapabilities} };
  } else {
    const row = db.prepare('SELECT id, username, password_hash, role, transcripts, recordings, logs FROM users WHERE username = ?').get(username) as UserRow | undefined;
    const ok = verifyPassword(password, row?.password_hash ?? DUMMY);
    if (row && ok) {
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id);
      auth = { user: row.username, role: row.role, source: 'db', id: row.id, capabilities: capabilitiesOf(row) };
    }
  }
  if (!auth) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const token = jwt.sign({ sub: auth.user, src: auth.source, uid: auth.id }, config.sessionSecret, { expiresIn: '12h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 12 * 3600 * 1000 });
  res.json({ user: auth.user, role: auth.role });
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}

export const authOf = (req: Request): Auth => (req as Request & { auth: Auth }).auth;

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const p = jwt.verify(req.cookies?.[COOKIE] ?? '', config.sessionSecret, {algorithms:['HS256']}) as { sub: string; src: 'env' | 'db'; uid?: number };
    if (!p || !['env','db'].includes(p.src)) throw new Error('Invalid session source');
    if (p.src === 'env') {
      if (p.sub !== config.adminUser) throw new Error('Bootstrap user changed');
      (req as Request & { auth: Auth }).auth = { user: p.sub, role: 'admin', source: 'env', capabilities: {...adminCapabilities} };
    } else {
      // Role is read from the table on every request, so demoting or removing someone takes effect immediately.
      const row = db.prepare('SELECT id, username, role, transcripts, recordings, logs FROM users WHERE id = ?').get(p.uid ?? -1) as UserRow | undefined;
      if (!row) throw new Error('user removed');
      (req as Request & { auth: Auth }).auth = { user: row.username, role: row.role, source: 'db', id: row.id, capabilities: capabilitiesOf(row) };
    }
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

export function me(req: Request, res: Response): void {
  const { user, role, source, capabilities } = authOf(req);
  res.json({ user, role, source, capabilities });
}

export const requireContent = (...grants: ContentGrant[]) => (req: Request, res: Response, next: NextFunction): void => {
  const auth = authOf(req);
  if (auth.capabilities ? grants.some(grant => !auth.capabilities?.[grant]) : auth.role !== 'admin') {
    res.status(403).json({ error: 'Content access required: ' + grants.join(', ') }); return;
  }
  next();
};

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (authOf(req).role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// Viewers may read everything but change nothing: GETs, plus LiveKit "List…" calls (which are POSTs on the wire).
export function enforceRole(req: Request, res: Response, next: NextFunction): void {
  if (authOf(req).role === 'admin' || req.method === 'GET' || /^\/lk\/[a-z]+\/List[A-Za-z]*$/.test(req.path)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Your account is read-only' });
}
