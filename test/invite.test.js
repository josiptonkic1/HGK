import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

describe('pozivnica (gost)', () => {
  test('stranice se poslužuju', async () => {
    const { anon } = setup();
    for (const path of ['/pozivnica', '/p/nesto', '/prijava', '/staff']) {
      const res = await anon().get(path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers['content-type'], /text\/html/);
    }
    assert.equal((await anon().get('/')).headers.location, '/pozivnica');
    assert.equal((await anon().get('/vendor/html5-qrcode.min.js')).status, 200);
    assert.equal((await anon().get('/vendor/fontsource/montserrat/700.css')).status, 200);
    assert.equal((await anon().get('/css/style.css')).status, 200);
  });

  test('web aplikacija (PWA): manifest, service worker i ikone', async () => {
    const { anon } = setup();
    const manifest = await anon().get('/manifest.webmanifest');
    assert.equal(manifest.status, 200);
    const m = JSON.parse(manifest.text);
    assert.equal(m.display, 'standalone');
    assert.equal(m.start_url, '/staff');
    for (const icon of m.icons) {
      const res = await anon().get(icon.src);
      assert.equal(res.status, 200, icon.src);
      assert.equal(res.headers['content-type'], 'image/png');
    }
    const sw = await anon().get('/sw.js');
    assert.equal(sw.status, 200);
    assert.match(sw.headers['content-type'], /javascript/);
    assert.match(sw.text, /\/api\//, 'service worker mora preskakati /api');
    const staff = await anon().get('/staff');
    assert.match(staff.text, /rel="manifest"/);
  });

  test('podaci o događaju sadrže 31. Zlatnu kunu', async () => {
    const { anon } = setup();
    const res = await anon().get('/api/event');
    assert.equal(res.status, 200);
    assert.equal(res.body.event.title, '31. Zlatna kuna');
    assert.match(res.body.event.intro, /31\. svečanu dodjelu/);
    assert.equal(res.body.openRegistration, true);
    // Android aplikacija provjerava adresu poslužitelja s druge domene
    assert.equal(res.headers['access-control-allow-origin'], '*');
    // ...ali podaci osoblja nisu dostupni s drugih domena
    const staff = await anon().get('/api/staff/invitations');
    assert.equal(staff.headers['access-control-allow-origin'], undefined);
  });

  test('osobni link: potvrda dolaska s pratnjom generira QR kod', async () => {
    const { anon, admin } = setup();
    const a = await admin();
    const created = await a.post('/api/admin/invitations').send({ firstName: 'Ivan', lastName: 'Horvat', maxCompanions: 2, organization: 'Končar' });
    assert.equal(created.status, 201);
    const token = created.body.invitation.token;
    assert.equal(created.body.invitation.status, 'pending');

    const before = await anon().get(`/api/invite/${token}`);
    assert.equal(before.status, 200);
    assert.equal(before.body.firstName, 'Ivan');
    assert.equal(before.body.qrImage, null);
    assert.equal(before.body.maxCompanions, 2);
    assert.equal(before.body.email, undefined, 'javni prikaz ne smije otkrivati e-mail');

    const res = await anon().post(`/api/invite/${token}/respond`).send({
      attending: true, firstName: 'Ivan', lastName: 'Horvat',
      companions: [{ firstName: 'Ana', lastName: 'Horvat' }, { firstName: '', lastName: '' }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'confirmed');
    assert.match(res.body.qrImage, /^data:image\/png;base64,/);
    assert.match(res.body.qrCode, /^ZK31:[A-Za-z0-9_-]{16}$/);
    assert.deepEqual(res.body.guests.map((g) => [g.fullName, g.isCompanion]), [['Ivan Horvat', false], ['Ana Horvat', true]]);

    // Ponovno otvaranje linka prikazuje isti QR
    const again = await anon().get(`/api/invite/${token}`);
    assert.equal(again.body.qrCode, res.body.qrCode);

    const png = await anon().get(`/api/invite/${token}/qr.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-type'], 'image/png');
    assert.match(png.headers['content-disposition'], /ZK31-Ivan-Horvat\.png/);
  });

  test('previše pratnje i nepotpuna pratnja se odbijaju', async () => {
    const { anon, admin } = setup();
    const a = await admin();
    const { token } = (await a.post('/api/admin/invitations').send({ firstName: 'Marko', lastName: 'Marić', maxCompanions: 1 })).body.invitation;
    const tooMany = await anon().post(`/api/invite/${token}/respond`).send({
      firstName: 'Marko', lastName: 'Marić', companions: [{ firstName: 'A', lastName: 'B' }, { firstName: 'C', lastName: 'D' }],
    });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error, 'too_many_companions');
    const partial = await anon().post(`/api/invite/${token}/respond`).send({ firstName: 'Marko', lastName: 'Marić', companions: [{ firstName: 'Samo' }] });
    assert.equal(partial.status, 400);
    const noName = await anon().post(`/api/invite/${token}/respond`).send({ firstName: ' ', lastName: 'Marić' });
    assert.equal(noName.status, 400);
    assert.match(noName.body.message, /Ime/);
  });

  test('isprika (ne dolazi) i naknadna potvrda', async () => {
    const { anon, admin } = setup();
    const a = await admin();
    const { token } = (await a.post('/api/admin/invitations').send({ firstName: 'Petra', lastName: 'Kos' })).body.invitation;
    const declined = await anon().post(`/api/invite/${token}/respond`).send({ attending: false });
    assert.equal(declined.body.status, 'declined');
    assert.equal(declined.body.qrImage, null);
    assert.equal((await anon().get(`/api/invite/${token}/qr.png`)).status, 404);
    const confirmed = await anon().post(`/api/invite/${token}/respond`).send({ attending: true, firstName: 'Petra', lastName: 'Kos' });
    assert.equal(confirmed.body.status, 'confirmed');
  });

  test('nepostojeća pozivnica vraća 404', async () => {
    const { anon } = setup();
    const res = await anon().get('/api/invite/ne-postoji');
    assert.equal(res.status, 404);
    assert.match(res.body.message, /nije pronađena/);
  });

  test('opći link: prijava se odmah potvrđuje, može se zatvoriti', async () => {
    const { anon, admin } = setup();
    const res = await anon().post('/api/register').send({ firstName: 'Luka', lastName: 'Babić', companions: [{ firstName: 'Iva', lastName: 'Babić' }] });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'confirmed');
    assert.ok(res.body.qrImage);
    assert.equal(res.body.guests.length, 2);

    const tooMany = await anon().post('/api/register').send({
      firstName: 'X', lastName: 'Y', companions: [{ firstName: 'A', lastName: 'B' }, { firstName: 'C', lastName: 'D' }],
    });
    assert.equal(tooMany.status, 400, 'zadani limit pratnje je 1');

    const a = await admin();
    await a.put('/api/admin/settings').send({ openRegistration: false });
    const closed = await anon().post('/api/register').send({ firstName: 'Ana', lastName: 'Anić' });
    assert.equal(closed.status, 403);
    assert.equal((await anon().get('/api/event')).body.openRegistration, false);
  });

  test('nakon evidentiranog dolaska gost više ne može mijenjati podatke', async () => {
    const { anon, moderator } = setup();
    const reg = (await anon().post('/api/register').send({ firstName: 'Tea', lastName: 'Tomić' })).body;
    const m = await moderator();
    const scan = await m.post('/api/staff/scan').send({ code: reg.qrCode });
    await m.post('/api/staff/checkin').send({ invitationId: scan.body.invitation.id });
    const res = await anon().post(`/api/invite/${reg.token}/respond`).send({ firstName: 'Tea', lastName: 'Tomić' });
    assert.equal(res.status, 409);
    assert.equal((await anon().get(`/api/invite/${reg.token}`)).body.editable, false);
  });
});
