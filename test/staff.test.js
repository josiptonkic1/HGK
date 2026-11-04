import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ADMIN } from './helpers.js';
import { openDb } from '../src/db.js';
import { ensureSeedUsers, authenticate, listUsers } from '../src/store.js';

describe('hosting iza HTTPS proxyja (Render)', () => {
  test('prijava postavlja sigurni kolačić kad proxy javlja HTTPS', async () => {
    const { createApp } = await import('../src/app.js');
    const { createUser } = await import('../src/store.js');
    const request = (await import('supertest')).default;
    const db = openDb(':memory:');
    createUser(db, { username: 'admin', password: 'admin-lozinka-1', role: 'admin' });
    const app = createApp({ db, sessionSecret: 'test-secret-0123456789abcdef', secureCookies: true, trustProxy: 1 });
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').set('X-Forwarded-Proto', 'https').send({ username: 'admin', password: 'admin-lozinka-1' });
    assert.equal(res.status, 200);
    const cookie = res.headers['set-cookie'].join(';');
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /HttpOnly/i);
  });
});

describe('početni korisnici iz .env', () => {
  test('kreiraju se admin i moderator, ali samo jednom po ulozi', () => {
    const db = openDb(':memory:');
    const seeds = [
      { username: 'admin', password: 'admin-lozinka-1', name: 'Administrator', role: 'admin' },
      { username: 'moderator', password: 'mod-lozinka-1', name: 'Moderator', role: 'moderator' },
    ];
    assert.equal(ensureSeedUsers(db, seeds).length, 2);
    assert.equal(authenticate(db, 'admin', 'admin-lozinka-1').role, 'admin');
    assert.equal(authenticate(db, 'moderator', 'mod-lozinka-1').role, 'moderator');
    assert.equal(ensureSeedUsers(db, seeds).length, 0, 'ponovno pokretanje ne kreira duplikate');
    assert.equal(listUsers(db).length, 2);
    assert.equal(ensureSeedUsers(db, [{ username: '', password: '', role: 'moderator' }]).length, 0);
  });
});

describe('prijava i ovlasti', () => {
  test('bez prijave nema pristupa popisu', async () => {
    const { anon } = setup();
    assert.equal((await anon().get('/api/staff/invitations')).status, 401);
    assert.equal((await anon().get('/api/admin/export.xlsx')).status, 401);
    assert.equal((await anon().get('/api/auth/me')).status, 401);
  });

  test('pogrešna lozinka i ograničenje pokušaja', async () => {
    const { anon } = setup();
    const bad = await anon().post('/api/auth/login').send({ username: 'admin', password: 'krivo' });
    assert.equal(bad.status, 401);
    for (let i = 0; i < 10; i++) await anon().post('/api/auth/login').send({ username: 'admin', password: 'krivo' });
    const blocked = await anon().post('/api/auth/login').send(ADMIN);
    assert.equal(blocked.status, 429);
  });

  test('moderator vidi popis i skenira, ali nema admin funkcije', async () => {
    const { moderator } = setup();
    const m = await moderator();
    assert.equal((await m.get('/api/auth/me')).body.user.role, 'moderator');
    assert.equal((await m.get('/api/staff/invitations')).status, 200);
    assert.equal((await m.post('/api/admin/invitations').send({ firstName: 'A', lastName: 'B' })).status, 403);
    assert.equal((await m.get('/api/admin/export.pdf')).status, 403);
    assert.equal((await m.get('/api/admin/users')).status, 403);
    assert.equal((await m.put('/api/admin/settings').send({ openRegistration: false })).status, 403);
  });

  test('odjava briše sesiju', async () => {
    const { admin } = setup();
    const a = await admin();
    assert.equal((await a.get('/api/auth/me')).status, 200);
    await a.post('/api/auth/logout');
    assert.equal((await a.get('/api/auth/me')).status, 401);
  });

  test('upravljanje korisnicima', async () => {
    const { admin, anon } = setup();
    const a = await admin();
    const created = await a.post('/api/admin/users').send({ username: 'Ulaz1', name: 'Ulaz Jedan', password: 'lozinka123', role: 'moderator' });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.username, 'ulaz1');
    assert.equal((await a.post('/api/admin/users').send({ username: 'ulaz1', password: 'lozinka123', role: 'moderator' })).status, 409);
    assert.equal((await a.post('/api/admin/users').send({ username: 'kratka', password: '123', role: 'moderator' })).status, 400);
    assert.equal((await anon().post('/api/auth/login').send({ username: 'ULAZ1', password: 'lozinka123' })).status, 200);

    const me = (await a.get('/api/auth/me')).body.user;
    assert.equal((await a.delete(`/api/admin/users/${me.id}`)).status, 400, 'ne može obrisati sebe');
    assert.equal((await a.delete(`/api/admin/users/${created.body.user.id}`)).status, 200);
  });
});

describe('skeniranje i potvrda dolaska', () => {
  async function confirmedGuest(ctx, companions = [{ firstName: 'Maja', lastName: 'Jurić' }]) {
    const a = await ctx.admin();
    const res = await a.post('/api/admin/invitations').send({ firstName: 'Josip', lastName: 'Jurić', confirm: true, companions });
    return res.body.invitation;
  }

  test('QR kod pronalazi uzvanika i evidentira dolazak cijele grupe', async () => {
    const ctx = setup();
    const inv = await confirmedGuest(ctx);
    const m = await ctx.moderator();

    const scan = await m.post('/api/staff/scan').send({ code: inv.qrCode });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.invitation.fullName, 'Josip Jurić');
    assert.equal(scan.body.invitation.guests.length, 2);

    // Kod bez prefiksa također radi
    assert.equal((await m.post('/api/staff/scan').send({ code: inv.qrCode.split(':')[1] })).status, 200);

    const first = await m.post('/api/staff/checkin').send({ invitationId: inv.id });
    assert.equal(first.status, 200);
    assert.equal(first.body.newlyCheckedIn.length, 2);
    assert.equal(first.body.invitation.checkedInCount, 2);
    assert.equal(first.body.invitation.guests[0].checkedInBy, 'Moderator Test');

    const second = await m.post('/api/staff/checkin').send({ invitationId: inv.id });
    assert.equal(second.body.newlyCheckedIn.length, 0);
    assert.equal(second.body.alreadyCheckedIn.length, 2);
  });

  test('djelomičan dolazak (samo neke osobe) i poništavanje', async () => {
    const ctx = setup();
    const inv = await confirmedGuest(ctx);
    const m = await ctx.moderator();
    const primary = inv.guests.find((g) => !g.isCompanion);
    const res = await m.post('/api/staff/checkin').send({ invitationId: inv.id, guestIds: [primary.id] });
    assert.deepEqual(res.body.newlyCheckedIn, [primary.id]);
    assert.equal(res.body.invitation.checkedInCount, 1);

    const other = await ctx.admin();
    const foreign = (await other.post('/api/admin/invitations').send({ firstName: 'Drugi', lastName: 'Gost', confirm: true })).body.invitation;
    const wrong = await m.post('/api/staff/checkin').send({ invitationId: inv.id, guestIds: [foreign.guests[0].id] });
    assert.equal(wrong.status, 400, 'osoba iz druge pozivnice');

    const undo = await m.post('/api/staff/checkin/undo').send({ guestId: primary.id });
    assert.equal(undo.body.invitation.checkedInCount, 0);
  });

  test('nepotvrđen ili otkazan uzvanik: upozorenje, a evidentiranje samo uz potvrdu', async () => {
    const ctx = setup();
    const a = await ctx.admin();
    const pending = (await a.post('/api/admin/invitations').send({ firstName: 'Nina', lastName: 'Novak' })).body.invitation;
    const m = await ctx.moderator();
    const refused = await m.post('/api/staff/checkin').send({ invitationId: pending.id });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, 'not_confirmed');

    const forced = await m.post('/api/staff/checkin').send({ invitationId: pending.id, force: true });
    assert.equal(forced.status, 200);
    assert.equal(forced.body.invitation.status, 'confirmed');
    assert.equal(forced.body.invitation.checkedInCount, 1);
    assert.equal(forced.body.invitation.guests[0].fullName, 'Nina Novak');

    await ctx.anon().post(`/api/invite/${(await a.post('/api/admin/invitations').send({ firstName: 'Ot', lastName: 'Kazan' })).body.invitation.token}/respond`).send({ attending: false });
    const list = (await m.get('/api/staff/invitations')).body.invitations;
    const declined = list.find((i) => i.lastName === 'Kazan');
    const r = await m.post('/api/staff/checkin').send({ invitationId: declined.id });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /otkazao/);
  });

  test('nepoznat QR kod', async () => {
    const ctx = setup();
    const m = await ctx.moderator();
    const res = await m.post('/api/staff/scan').send({ code: 'ZK31:nepostojeci-kod-123' });
    assert.equal(res.status, 404);
    assert.equal((await m.post('/api/staff/scan').send({ code: '' })).status, 404);
  });
});

describe('administracija popisa', () => {
  test('dodavanje s automatskom potvrdom i statistika', async () => {
    const ctx = setup();
    const a = await ctx.admin();
    const conf = await a.post('/api/admin/invitations').send({
      firstName: 'Vlado', lastName: 'Vuk', organization: 'HEP', groupName: 'Dobitnici', confirm: true,
      companions: [{ firstName: 'Vesna', lastName: 'Vuk' }, { firstName: 'Vid', lastName: 'Vuk' }],
    });
    assert.equal(conf.status, 201);
    assert.equal(conf.body.invitation.status, 'confirmed');
    assert.equal(conf.body.invitation.source, 'admin');
    assert.equal(conf.body.invitation.maxCompanions, 2, 'admin smije dodati više pratnje od zadanog');
    await a.post('/api/admin/invitations').send({ firstName: 'Ana', lastName: 'Pending' });
    const dec = (await a.post('/api/admin/invitations').send({ firstName: 'Bo', lastName: 'Declined' })).body.invitation;
    await ctx.anon().post(`/api/invite/${dec.token}/respond`).send({ attending: false });

    const m = await ctx.moderator();
    await m.post('/api/staff/checkin').send({ invitationId: conf.body.invitation.id, guestIds: [conf.body.invitation.guests[0].id] });

    const { stats } = (await a.get('/api/staff/invitations')).body;
    assert.deepEqual(
      { inv: stats.invitations, conf: stats.confirmedPersons, comp: stats.companions, dec: stats.declinedInvitations, pend: stats.pendingInvitations, inn: stats.checkedInPersons },
      { inv: 3, conf: 3, comp: 2, dec: 1, pend: 1, inn: 1 },
    );
  });

  test('uređivanje čuva evidenciju dolaska, a ne dopušta brisanje osobe koja je došla', async () => {
    const ctx = setup();
    const a = await ctx.admin();
    const inv = (await a.post('/api/admin/invitations').send({
      firstName: 'Ema', lastName: 'Ban', confirm: true, companions: [{ firstName: 'Leo', lastName: 'Ban' }],
    })).body.invitation;
    const leo = inv.guests.find((g) => g.isCompanion);
    const m = await ctx.moderator();
    await m.post('/api/staff/checkin').send({ invitationId: inv.id, guestIds: [leo.id] });

    const renamed = await a.put(`/api/admin/invitations/${inv.id}`).send({
      organization: 'Podravka', companions: [{ id: leo.id, firstName: 'Leon', lastName: 'Ban' }, { firstName: 'Mia', lastName: 'Ban' }],
    });
    assert.equal(renamed.status, 200);
    const leon = renamed.body.invitation.guests.find((g) => g.id === leo.id);
    assert.equal(leon.fullName, 'Leon Ban');
    assert.ok(leon.checkedInAt, 'evidencija dolaska ostaje');
    assert.equal(renamed.body.invitation.guests.length, 3);
    assert.equal(renamed.body.invitation.organization, 'Podravka');

    const remove = await a.put(`/api/admin/invitations/${inv.id}`).send({ companions: [] });
    assert.equal(remove.status, 409);
  });

  test('skupni unos', async () => {
    const ctx = setup();
    const a = await ctx.admin();
    const res = await a.post('/api/admin/invitations/bulk').send({
      text: 'Ivan Ivić; Ina d.d.; Gospodarstvo; ivan@ina.hr\nAna Marija Kovač\tHRT\tMediji\nSamoime\nPetar Perić; ; ; krivi-email',
      groupName: 'Ostalo',
      confirm: false,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.created.length, 2);
    assert.deepEqual(res.body.errors.map((e) => e.line), [3, 4]);
    const [ivan, ana] = res.body.created;
    assert.equal(ivan.organization, 'Ina d.d.');
    assert.equal(ivan.email, 'ivan@ina.hr');
    assert.equal(ana.firstName, 'Ana Marija');
    assert.equal(ana.lastName, 'Kovač');
    assert.equal(ana.groupName, 'Mediji');
    assert.equal(ivan.status, 'pending');
  });

  test('brisanje uzvanika', async () => {
    const ctx = setup();
    const a = await ctx.admin();
    const inv = (await a.post('/api/admin/invitations').send({ firstName: 'Za', lastName: 'Brisanje', confirm: true })).body.invitation;
    assert.equal((await a.delete(`/api/admin/invitations/${inv.id}`)).status, 200);
    assert.equal((await a.delete(`/api/admin/invitations/${inv.id}`)).status, 404);
    assert.equal((await ctx.anon().get(`/api/invite/${inv.token}`)).status, 404);
  });
});
