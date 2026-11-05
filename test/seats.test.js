import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fakeMailer, binary } from './helpers.js';
import { seatingRows } from '../src/seating-pdf.js';
import { allSeats, isSeat, seatLabel } from '../public/js/seatplan.js';

describe('tlocrt: model dvorane', () => {
  test('oznake su jedinstvene i čitljive', () => {
    const seats = allSeats();
    assert.equal(new Set(seats.map((s) => s.id)).size, seats.length);
    assert.ok(seats.length > 600);
    assert.equal(seatLabel('P-5-12'), 'Parter, red 5, sjedalo 12');
    assert.equal(seatLabel('L-7-2'), 'Loža 7, mjesto 2');
    assert.equal(seatLabel('B-1-3'), 'Balkon, red 1, sjedalo 3');
    assert.equal(isSeat('P-1-99'), false);
  });
});

describe('tlocrt: dodjela sjedećih mjesta', () => {
  async function seeded() {
    const mailer = fakeMailer();
    const ctx = setup({ mailer });
    const a = await ctx.admin();
    const add = (body) => a.post('/api/admin/invitations').send(body).then((r) => r.body.invitation);
    const ivan = await add({ firstName: 'Ivan', lastName: 'Horvat', email: 'ivan@primjer.hr', confirm: true, companions: [{ firstName: 'Maja', lastName: 'Horvat' }] });
    const ana = await add({ firstName: 'Ana', lastName: 'Kovač', email: 'ana@primjer.hr', confirm: true });
    const pending = await add({ firstName: 'Pero', lastName: 'Perić', email: 'pero@primjer.hr' });
    return { mailer, ctx, a, ivan, ana, pending };
  }
  const put = (a, inv, body) => a.put(`/api/admin/invitations/${inv.id}/seats`).send(body);

  test('spremi mjesta za osobu i pratnju te pošalji e-mail', async () => {
    const { mailer, a, ivan } = await seeded();
    assert.equal(ivan.personCount, 2);
    const r = await put(a, ivan, { seats: ['P-5-12', 'P-5-13'], notify: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.mail, 'sent');
    assert.deepEqual(r.body.invitation.seatLabels, ['Parter, red 5, sjedalo 12', 'Parter, red 5, sjedalo 13']);
    assert.ok(r.body.invitation.seatSentAt);
    const msg = mailer.sent.at(-1);
    assert.equal(msg.to, 'ivan@primjer.hr');
    assert.match(msg.subject, /sjedeće mjesto.*Ivan Horvat/);
    assert.match(msg.html, /Parter, red 5, sjedalo 12/);
    assert.match(msg.html, /Maja Horvat – pratnja<br><span[^>]*>Parter, red 5, sjedalo 13/);

    // mjesta su vidljiva i u popisu za moderatore
    const list = (await a.get('/api/staff/invitations')).body.invitations;
    assert.deepEqual(list.find((i) => i.id === ivan.id).seats, ['P-5-12', 'P-5-13']);
  });

  test('zauzeto mjesto, previše mjesta, nepotvrđen dolazak i nepoznato mjesto', async () => {
    const { a, ivan, ana, pending } = await seeded();
    await put(a, ivan, { seats: ['L-3-1'] });
    const clash = await put(a, ana, { seats: ['L-3-1'] });
    assert.equal(clash.status, 409);
    assert.match(clash.body.message, /Loža 3, mjesto 1.*Ivan Horvat/);
    assert.equal((await put(a, ana, { seats: ['P-1-1', 'P-1-2'] })).status, 400);
    assert.equal((await put(a, pending, { seats: ['P-1-1'] })).status, 400);
    assert.equal((await put(a, ana, { seats: ['X-1-1'] })).status, 400);
    // bez slanja e-maila
    const ok = await put(a, ana, { seats: ['P-1-1'] });
    assert.equal(ok.body.mail, 'skipped');
    assert.equal(ok.body.invitation.seatSentAt, null);
  });

  test('otkazani dolazak oslobađa mjesto; skupno slanje mjesta bez ponavljanja', async () => {
    const { mailer, a, ivan, ana } = await seeded();
    await put(a, ana, { seats: ['G-2-10'] });
    await put(a, ivan, { seats: ['B-1-1', 'B-1-2'] });
    await a.put(`/api/admin/invitations/${ana.id}`).send({ status: 'declined' });
    const freed = await put(a, ivan, { seats: ['G-2-10'] });
    assert.equal(freed.status, 200, 'mjesto otkazanog uzvanika je slobodno');

    const before = mailer.sent.length;
    const r1 = (await a.post('/api/admin/mail/bulk').send({ kind: 'seat' })).body;
    assert.equal(r1.sent, 1);
    assert.equal(mailer.sent.length, before + 1);
    const r2 = (await a.post('/api/admin/mail/bulk').send({ kind: 'seat' })).body;
    assert.equal(r2.sent, 0);

    const preview = (await a.get(`/api/admin/invitations/${ivan.id}/preview?kind=seat`)).body;
    assert.match(preview.html, /Galerija, red 2, sjedalo 10/);
  });

  test('prvo raspored bez slanja, zatim e-mail samo odabranima (i ponovno slanje)', async () => {
    const { mailer, a, ivan, ana, pending } = await seeded();
    await put(a, ivan, { seats: ['P-2-1', 'P-2-2'] });
    await put(a, ana, { seats: ['P-2-3'] });
    assert.equal(mailer.sent.filter((m) => /sjedeće/.test(m.subject)).length, 0, 'spremanje ne šalje e-mail');

    const r1 = (await a.post('/api/admin/mail/bulk').send({ kind: 'seat', ids: [ana.id, pending.id] })).body;
    assert.equal(r1.sent, 1, 'samo odabrani i samo oni s mjestom');
    assert.equal(mailer.sent.at(-1).to, 'ana@primjer.hr');

    const r2 = (await a.post('/api/admin/mail/bulk').send({ kind: 'seat', ids: [ana.id, ivan.id] })).body;
    assert.equal(r2.sent, 2, 'odabranima se šalje i ako su već dobili e-mail');

    const bad = await a.post('/api/admin/mail/bulk').send({ kind: 'invite', ids: [ana.id] });
    assert.equal(bad.status, 400);
  });

  test('PDF rasporeda sjedenja: redoslijed po mjestima, bez mjesta, abecedno', async () => {
    const { a, ivan, ana } = await seeded();
    await put(a, ivan, { seats: ['B-1-1'] });
    await put(a, ana, { seats: ['P-3-4'] });
    const list = (await a.get('/api/staff/invitations')).body.invitations;
    const { seated, unseated, alphabetical } = seatingRows(list);
    assert.deepEqual(seated.map((r) => r.name), ['Ana Kovač', 'Ivan Horvat'], 'parter prije balkona');
    assert.deepEqual(unseated.map((r) => r.name), ['Maja Horvat'], 'pratnja bez mjesta');
    assert.equal(unseated[0].host, 'Ivan Horvat');
    assert.deepEqual(alphabetical.map((r) => r.name), ['Ana Kovač', 'Ivan Horvat']);

    const res = await a.get('/api/admin/seating.pdf').buffer(true).parse(binary);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
  });

  test('stranica /raspored i podaci za nju dostupni su moderatoru', async () => {
    const { ctx, a, ivan } = await seeded();
    await put(a, ivan, { seats: ['P-9-9', 'P-9-10'] });
    const page = await ctx.anon().get('/raspored');
    assert.equal(page.status, 200);
    assert.match(page.text, /Raspored sjedenja/);
    const m = await ctx.moderator();
    const inv = (await m.get('/api/staff/invitations')).body.invitations.find((i) => i.id === ivan.id);
    assert.deepEqual(inv.seatLabels, ['Parter, red 9, sjedalo 9', 'Parter, red 9, sjedalo 10']);
    assert.equal((await ctx.anon().get('/api/staff/invitations')).status, 401, 'bez prijave nema podataka');
  });

  test('link za dijeljenje: bez prijave, bez e-mailova, može se zamijeniti i isključiti', async () => {
    const { ctx, a, ivan, pending } = await seeded();
    await put(a, ivan, { seats: ['P-1-1', 'P-1-2'] });
    assert.equal((await a.get('/api/admin/seatmap-share')).body.token, null);
    assert.equal((await ctx.anon().get('/api/seatmap/nesto')).status, 404, 'bez linka nema pristupa');

    const m = await ctx.moderator();
    assert.equal((await m.post('/api/admin/seatmap-share')).status, 403, 'samo admin pravi link');

    const t1 = (await a.post('/api/admin/seatmap-share')).body.token;
    assert.ok(t1.length >= 20);
    assert.equal((await ctx.anon().get(`/raspored/${t1}`)).status, 200);
    const pub = await ctx.anon().get(`/api/seatmap/${t1}`);
    assert.equal(pub.status, 200);
    const inv = pub.body.invitations.find((i) => i.id === ivan.id);
    assert.deepEqual(inv.seats, ['P-1-1', 'P-1-2']);
    assert.equal(inv.guests[1].fullName, 'Maja Horvat');
    assert.ok(!pub.body.invitations.some((i) => i.id === pending.id), 'samo potvrđeni');
    assert.doesNotMatch(JSON.stringify(pub.body), /@primjer\.hr|token|qrCode|note/, 'bez e-mailova, tokena i napomena');

    const t2 = (await a.post('/api/admin/seatmap-share')).body.token;
    assert.notEqual(t2, t1);
    assert.equal((await ctx.anon().get(`/api/seatmap/${t1}`)).status, 404, 'stari link više ne radi');
    assert.equal((await ctx.anon().get(`/api/seatmap/${t2}`)).status, 200);

    await a.delete('/api/admin/seatmap-share');
    assert.equal((await ctx.anon().get(`/api/seatmap/${t2}`)).status, 404, 'isključen link ne radi');
    assert.ok(!('seatmapShareToken' in (await a.get('/api/admin/settings')).body.settings));
  });

  test('moderator ne može dodjeljivati mjesta', async () => {
    const { ctx, ivan } = await seeded();
    const m = await ctx.moderator();
    assert.equal((await m.put(`/api/admin/invitations/${ivan.id}/seats`).send({ seats: ['P-1-1'] })).status, 403);
  });
});
