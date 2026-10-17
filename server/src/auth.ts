import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';

const COOKIE = 'lkc_session';
export type Role = 'admin' | 'viewer';
export type Auth = { user: string; role: Role; source: 'env' | 'db'; id?: number };

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

type UserRow = { id: number; username: string; password_hash: string; role: Role };

export function login(req: Request, res: Response): void {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  let auth: Auth | null = null;
  // The .env admin is the bootstrap account: it always works, so a bad user table can never lock everyone out.
  if (safeEqual(username, config.adminUser) && safeEqual(password, config.adminPassword)) {
    auth = { user: config.adminUser, role: 'admin', source: 'env' };
  } else {
    const row = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?').get(username) as UserRow | undefined;
    const ok = verifyPassword(password, row?.password_hash ?? DUMMY);
    if (row && ok) {
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id);
      auth = { user: row.username, role: row.role, source: 'db', id: row.id };
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
    const p = jwt.verify(req.cookies?.[COOKIE] ?? '', config.sessionSecret) as { sub: string; src: 'env' | 'db'; uid?: number };
    if (p.src === 'env') {
      (req as Request & { auth: Auth }).auth = { user: p.sub, role: 'admin', source: 'env' };
    } else {
      // Role is read from the table on every request, so demoting or removing someone takes effect immediately.
      const row = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(p.uid ?? -1) as { id: number; username: string; role: Role } | undefined;
      if (!row) throw new Error('user removed');
      (req as Request & { auth: Auth }).auth = { user: row.username, role: row.role, source: 'db', id: row.id };
    }
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

export function me(req: Request, res: Response): void {
  const { user, role, source } = authOf(req);
  res.json({ user, role, source });
}

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
