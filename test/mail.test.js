import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fakeMailer } from './helpers.js';

describe('e-mail: QR kod gostu', () => {
  test('opći link: e-mail je obavezan i QR kod stiže na e-mail', async () => {
    const mailer = fakeMailer();
    const ctx = setup({ mailer });
    assert.equal((await ctx.anon().get('/api/event')).body.emailEnabled, true);

    const noMail = await ctx.anon().post('/api/register').send({ firstName: 'Ana', lastName: 'Anić' });
    assert.equal(noMail.status, 400);
    assert.match(noMail.body.message, /e-mail/i);

    const res = await ctx.anon().post('/api/register').send({
      firstName: 'Ana', lastName: 'Anić', email: 'Ana@Primjer.hr', companions: [{ firstName: 'Ivo', lastName: 'Ivić' }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.mail, 'sent');
    assert.equal(mailer.sent.length, 1);
    const msg = mailer.sent[0];
    assert.equal(msg.to, 'ana@primjer.hr');
    assert.match(msg.subject, /QR kod/);
    assert.match(msg.html, /Ivo Ivić – pratnja/);
    assert.match(msg.html, new RegExp(`/p/${res.body.token}`));
    assert.equal(msg.attachments[0].cid, 'qr');
    assert.equal(msg.attachments[0].content.subarray(1, 4).toString(), 'PNG');
  });

  test('osobni link: e-mail je unaprijed upisan, gost ga može promijeniti', async () => {
    const mailer = fakeMailer();
    const ctx = setup({ mailer });
    const a = await ctx.admin();
    const inv = (await a.post('/api/admin/invitations').send({ firstName: 'Marko', lastName: 'Marić', email: 'marko@primjer.hr' })).body.invitation;
    assert.equal((await ctx.anon().get(`/api/invite/${inv.token}`)).body.email, 'marko@primjer.hr');

    const res = await ctx.anon().post(`/api/invite/${inv.token}/respond`).send({ firstName: 'Marko', lastName: 'Marić', email: 'novi@primjer.hr' });
    assert.equal(res.body.mail, 'sent');
    assert.equal(mailer.sent.at(-1).to, 'novi@primjer.hr');
    const list = (await a.get('/api/staff/invitations')).body.invitations;
    assert.ok(list[0].qrSentAt, 'zabilježeno slanje QR koda');
  });

  test('greška u slanju ne kvari potvrdu dolaska', async () => {
    const ctx = setup({ mailer: fakeMailer({ fail: true }) });
    const res = await ctx.anon().post('/api/register').send({ firstName: 'Iva', lastName: 'Ivić', email: 'iva@primjer.hr' });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'confirmed');
    assert.equal(res.body.mail, 'failed');
    assert.ok(res.body.qrImage);
  });

  test('bez podešenog e-maila: e-mail nije obavezan, slanje se ne nudi', async () => {
    const ctx = setup();
    assert.equal((await ctx.anon().get('/api/event')).body.emailEnabled, false);
    const res = await ctx.anon().post('/api/register').send({ firstName: 'Ana', lastName: 'Anić' });
    assert.equal(res.status, 201);
    assert.equal(res.body.mail, 'disabled');
    const a = await ctx.admin();
    assert.equal((await a.get('/api/admin/mail')).body.enabled, false);
    const bulk = await a.post('/api/admin/mail/bulk').send({ kind: 'invite' });
    assert.equal(bulk.status, 400);
    assert.equal(bulk.body.error, 'mail_disabled');
  });
});

describe('pozivnica na opću adresu (samo e-mail, bez imena)', () => {
  test('dodavanje samo s e-mailom; osoba sama upisuje ime', async () => {
    const mailer = fakeMailer();
    const ctx = setup({ mailer });
    const a = await ctx.admin();
    const res = await a.post('/api/admin/invitations').send({ email: 'gospodarstvo@tvrtka.hr' });
    assert.equal(res.status, 201);
    const inv = res.body.invitation;
    assert.equal(inv.hasName, false);
    assert.equal(inv.fullName, 'gospodarstvo@tvrtka.hr', 'u popisu se prikazuje e-mail');

    // pozivnica bez imena: nema retka s imenom, generičko "Poštovani,"
    await a.post(`/api/admin/invitations/${inv.id}/send`).send({ kind: 'invite' });
    assert.doesNotMatch(mailer.sent[0].html, /font-size:17px;color:#f2d892;"><strong>/);

    // osoba otvori link: ime prazno, e-mail upisan
    const pub = (await ctx.anon().get(`/api/invite/${inv.token}`)).body;
    assert.equal(pub.firstName, '');
    assert.equal(pub.email, 'gospodarstvo@tvrtka.hr');
    const noName = await ctx.anon().post(`/api/invite/${inv.token}/respond`).send({ firstName: '', lastName: '' });
    assert.equal(noName.status, 400, 'pri potvrdi ime je obavezno');
    const ok = await ctx.anon().post(`/api/invite/${inv.token}/respond`).send({ firstName: 'Iva', lastName: 'Ivić' });
    assert.equal(ok.body.status, 'confirmed');
    assert.equal(ok.body.mail, 'sent');
    assert.match(mailer.sent.at(-1).html, /<strong>Iva Ivić<\/strong>/);
  });

  test('s imenom je pozivnica personalizirana', async () => {
    const mailer = fakeMailer();
    const ctx = setup({ mailer });
    const a = await ctx.admin();
    const inv = (await a.post('/api/admin/invitations').send({ firstName: 'Ivan', lastName: 'Horvat', email: 'gospodarstvo@tvrtka.hr' })).body.invitation;
    await a.post(`/api/admin/invitations/${inv.id}/send`).send({ kind: 'invite' });
    assert.match(mailer.sent[0].html, /<strong>Ivan Horvat<\/strong>/);
  });

  test('ime se može dodati kasnije, a bez imena i e-maila nema pozivnice', async () => {
    const ctx = setup();
    const a = await ctx.admin();
    assert.equal((await a.post('/api/admin/invitations').send({})).status, 400);
    assert.equal((await a.post('/api/admin/invitations').send({ email: 'info@tvrtka.hr', confirm: true })).status, 400, 'automatska potvrda traži ime');
    const inv = (await a.post('/api/admin/invitations').send({ email: 'info@tvrtka.hr' })).body.invitation;
    const blank = await a.put(`/api/admin/invitations/${inv.id}`).send({ firstName: '', lastName: '', email: 'info@tvrtka.hr' });
    assert.equal(blank.status, 200, 'spremanje bez imena dok nije odgovorio');
    const named = await a.put(`/api/admin/invitations/${inv.id}`).send({ firstName: 'Ana', lastName: 'Anić' });
    assert.equal(named.body.invitation.fullName, 'Ana Anić');
  });

  test('pregled personalizirane pozivnice prije slanja (i bez podešenog slanja)', async () => {
    const ctx = setup();
    const a = await ctx.admin();
    const inv = (await a.post('/api/admin/invitations').send({ email: 'gospodarstvo@tvrtka.hr' })).body.invitation;
    const p1 = (await a.get(`/api/admin/invitations/${inv.id}/preview?kind=invite`)).body;
    assert.equal(p1.to, 'gospodarstvo@tvrtka.hr');
    assert.equal(p1.hasName, false);
    assert.match(p1.subject, /Pozivnica/);
    assert.equal(p1.subject.includes('–  '), false);
    assert.match(p1.html, new RegExp(`/p/${inv.token}`));
    // upiše se osoba -> pregled je personaliziran
    await a.put(`/api/admin/invitations/${inv.id}`).send({ firstName: 'Marija', lastName: 'Marić' });
    const p2 = (await a.get(`/api/admin/invitations/${inv.id}/preview?kind=invite`)).body;
    assert.equal(p2.hasName, true);
    assert.match(p2.subject, /Pozivnica – .* – Marija Marić$/, 'ime je u naslovu pa Gmail ne spaja pozivnice za istu adresu');
    assert.match(p2.html, /<strong>Marija Marić<\/strong>/);
    assert.match((await a.get(`/api/admin/invitations/${inv.id}/preview?kind=reminder`)).body.subject, /Podsjetnik/);
    const m = await ctx.moderator();
    assert.equal((await m.get(`/api/admin/invitations/${inv.id}/preview`)).status, 403);
  });

  test('skupni unos: redak samo s e-mailom', async () => {
    const ctx = setup();
    const a = await ctx.admin();
    const res = (await a.post('/api/admin/invitations/bulk').send({ text: 'gospodarstvo@tvrtka.hr\nIvan Horvat; ivan@primjer.hr' })).body;
    assert.equal(res.created.length, 2);
    assert.equal(res.created[0].email, 'gospodarstvo@tvrtka.hr');
    assert.equal(res.created[0].hasName, false);
    assert.equal(res.created[1].fullName, 'Ivan Horvat');
  });
});

describe('e-mail: pozivnice i podsjetnici iz aplikacije', () => {
  async function seeded() {
    const mailer = fakeMailer();
    const ctx = setup({ mailer });
    const a = await ctx.admin();
    const add = (body) => a.post('/api/admin/invitations').send(body).then((r) => r.body.invitation);
    const ivan = await add({ firstName: 'Ivan', lastName: 'Horvat', email: 'ivan@primjer.hr' });
    const ana = await add({ firstName: 'Ana', lastName: 'Kovač', email: 'ana@primjer.hr' });
    await add({ firstName: 'Bez', lastName: 'Maila' });
    const vip = await add({ firstName: 'Vip', lastName: 'Gost', email: 'vip@primjer.hr', confirm: true });
    return { mailer, ctx, a, ivan, ana, vip };
  }

  test('pregled, skupno slanje pozivnica bez ponavljanja i podsjetnik', async () => {
    const { mailer, ctx, a, ivan } = await seeded();
    const pre = (await a.get('/api/admin/mail/preview')).body;
    assert.deepEqual(pre.invite, { withEmail: 2, withoutEmail: 1 });
    assert.deepEqual(pre.qr, { withEmail: 1, withoutEmail: 0 });

    const r1 = (await a.post('/api/admin/mail/bulk').send({ kind: 'invite' })).body;
    assert.equal(r1.sent, 2);
    assert.deepEqual(r1.withoutEmail, ['Bez Maila']);
    const invMsg = mailer.sent.find((m) => m.to === 'ivan@primjer.hr');
    assert.match(invMsg.subject, /Pozivnica/);
    assert.match(invMsg.html, new RegExp(`/p/${ivan.token}`));

    const r2 = (await a.post('/api/admin/mail/bulk').send({ kind: 'invite' })).body;
    assert.equal(r2.sent, 0, 'pozivnica se ne šalje dvaput');

    // Ivan potvrdi -> dobije QR, više ne dobiva podsjetnik
    await ctx.anon().post(`/api/invite/${ivan.token}/respond`).send({ firstName: 'Ivan', lastName: 'Horvat' });
    const before = mailer.sent.length;
    const r3 = (await a.post('/api/admin/mail/bulk').send({ kind: 'reminder' })).body;
    assert.equal(r3.sent, 1);
    assert.equal(mailer.sent.length, before + 1);
    assert.equal(mailer.sent.at(-1).to, 'ana@primjer.hr');
    assert.match(mailer.sent.at(-1).subject, /Podsjetnik/);
  });

  test('QR kodovi potvrđenima koji ga još nisu dobili', async () => {
    const { mailer, a } = await seeded();
    const r = (await a.post('/api/admin/mail/bulk').send({ kind: 'qr' })).body;
    assert.equal(r.sent, 1);
    assert.equal(mailer.sent[0].to, 'vip@primjer.hr');
    assert.equal((await a.post('/api/admin/mail/bulk').send({ kind: 'qr' })).body.sent, 0);
  });

  test('pojedinačno slanje i greške', async () => {
    const { a, ana, ctx } = await seeded();
    const ok = await a.post(`/api/admin/invitations/${ana.id}/send`).send({ kind: 'invite' });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.invitation.inviteSentAt);

    const qrPending = await a.post(`/api/admin/invitations/${ana.id}/send`).send({ kind: 'qr' });
    assert.equal(qrPending.status, 400, 'QR samo potvrđenima');

    const list = (await a.get('/api/staff/invitations')).body.invitations;
    const noMail = list.find((i) => i.lastName === 'Maila');
    const r = await a.post(`/api/admin/invitations/${noMail.id}/send`).send({ kind: 'invite' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'no_email');

    const m = await ctx.moderator();
    assert.equal((await m.post(`/api/admin/invitations/${ana.id}/send`).send({ kind: 'invite' })).status, 403, 'samo admin');
  });

  test('probni e-mail', async () => {
    const { mailer, a } = await seeded();
    assert.equal((await a.post('/api/admin/mail/test').send({ to: 'krivo' })).status, 400);
    const ok = await a.post('/api/admin/mail/test').send({ to: 'ja@primjer.hr' });
    assert.equal(ok.status, 200);
    assert.equal(mailer.sent.at(-1).to, 'ja@primjer.hr');
  });
});
