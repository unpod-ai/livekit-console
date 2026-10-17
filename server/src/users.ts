import { Router } from 'express';
import { config } from './config.js';
import { authOf, hashPassword, type Role } from './auth.js';
import { db } from './db.js';

export const users = Router();

const ROLES: Role[] = ['admin', 'viewer'];
const validName = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9._@-]{3,64}$/.test(v);
const validPass = (v: unknown): v is string => typeof v === 'string' && v.length >= 10 && v.length <= 200;

users.get('/', (_req, res) => {
  const rows = db.prepare('SELECT id, username, role, created_at AS createdAt, last_login_at AS lastLoginAt FROM users ORDER BY username').all();
  // The .env admin isn't stored; show it so the list is the full picture of who can sign in.
  res.json([{ id: 'env', username: config.adminUser, role: 'admin', source: 'env', createdAt: null, lastLoginAt: null }, ...rows.map((r) => ({ ...r, source: 'db' }))]);
});

users.post('/', (req, res) => {
  const { username, password, role } = req.body ?? {};
  if (!validName(username)) return void res.status(400).json({ error: 'Username must be 3-64 characters: letters, digits, . _ @ -' });
  if (!validPass(password)) return void res.status(400).json({ error: 'Password must be at least 10 characters' });
  if (!ROLES.includes(role)) return void res.status(400).json({ error: 'Role must be admin or viewer' });
  if (username.toLowerCase() === config.adminUser.toLowerCase()) return void res.status(409).json({ error: 'That username is reserved for the bootstrap admin' });
  try {
    const r = db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)').run(username, hashPassword(password), role, Date.now());
    res.status(201).json({ id: Number(r.lastInsertRowid), username, role });
  } catch {
    res.status(409).json({ error: 'A user with that name already exists' });
  }
});

users.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { role, password } = req.body ?? {};
  const row = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!row) return void res.status(404).json({ error: 'User not found' });
  if (role !== undefined) {
    if (!ROLES.includes(role)) return void res.status(400).json({ error: 'Role must be admin or viewer' });
    if (authOf(req).id === id && role !== 'admin') return void res.status(400).json({ error: "You can't demote yourself" });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (password !== undefined) {
    if (!validPass(password)) return void res.status(400).json({ error: 'Password must be at least 10 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  }
  res.json({ ok: true });
});

users.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (authOf(req).id === id) return void res.status(400).json({ error: "You can't remove yourself" });
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (!r.changes) return void res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});
