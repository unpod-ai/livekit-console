import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

const COOKIE = 'lkc_session';

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export function login(req: Request, res: Response): void {
  const { username, password } = req.body ?? {};
  const ok =
    typeof username === 'string' &&
    typeof password === 'string' &&
    safeEqual(username, config.adminUser) &&
    safeEqual(password, config.adminPassword);
  if (!ok) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const token = jwt.sign({ sub: username }, config.sessionSecret, { expiresIn: '12h' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: 12 * 3600 * 1000,
  });
  res.json({ user: username });
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const payload = jwt.verify(req.cookies?.[COOKIE] ?? '', config.sessionSecret) as { sub: string };
    (req as Request & { user?: string }).user = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

export function me(req: Request, res: Response): void {
  res.json({ user: (req as Request & { user?: string }).user });
}
