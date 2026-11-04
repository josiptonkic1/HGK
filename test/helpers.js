import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/store.js';

export const ADMIN = { username: 'admin', password: 'admin-test-pass' };
export const MOD = { username: 'moderator', password: 'mod-test-pass' };

export function setup() {
  const db = openDb(':memory:');
  createUser(db, { ...ADMIN, name: 'Admin Test', role: 'admin' });
  createUser(db, { ...MOD, name: 'Moderator Test', role: 'moderator' });
  const app = createApp({ db, sessionSecret: 'test-secret-0123456789abcdef' });

  const login = async (creds) => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send(creds);
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
    return agent;
  };

  return { db, app, anon: () => request(app), admin: () => login(ADMIN), moderator: () => login(MOD) };
}

// Binarni odgovor (xlsx/pdf/png) kao Buffer.
export const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
