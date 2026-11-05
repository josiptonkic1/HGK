import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/store.js';

export const ADMIN = { username: 'admin', password: 'admin-test-pass' };
export const MOD = { username: 'moderator', password: 'mod-test-pass' };

// Lažni poštanski servis: bilježi poslane poruke, može glumiti grešku.
export function fakeMailer({ fail = false } = {}) {
  const sent = [];
  return {
    from: 'Zlatna kuna <test@primjer.hr>',
    delayMs: 0,
    sent,
    async send(msg) {
      if (fail) throw new Error('SMTP nedostupan');
      sent.push(msg);
    },
    async verify() {},
  };
}

export function setup({ mailer = null } = {}) {
  const db = openDb(':memory:');
  createUser(db, { ...ADMIN, name: 'Admin Test', role: 'admin' });
  createUser(db, { ...MOD, name: 'Moderator Test', role: 'moderator' });
  const app = createApp({ db, sessionSecret: 'test-secret-0123456789abcdef', mailer });

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

// Dodijeli mjesta (e-karta) pozivnici po tokenu i vrati javni prikaz - tek tada gost ima QR kod.
export async function ticketFor(ctx, token) {
  const a = await ctx.admin();
  const inv = (await a.get('/api/staff/invitations')).body.invitations.find((i) => i.token === token);
  const seats = [`G-3-${2 * inv.id - 1}`, `G-3-${2 * inv.id}`].slice(0, inv.personCount);
  const r = await a.put(`/api/admin/invitations/${inv.id}/seats`).send({ seats });
  if (r.status !== 200) throw new Error(`seats failed: ${r.status} ${r.body?.message}`);
  return (await ctx.anon().get(`/api/invite/${token}`)).body;
}
