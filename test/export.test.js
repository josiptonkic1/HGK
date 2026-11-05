import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { setup, binary, ticketFor } from './helpers.js';
import { personRows } from '../src/export.js';
import { listInvitations } from '../src/store.js';

async function seeded() {
  const ctx = setup();
  const a = await ctx.admin();
  const add = (body) => a.post('/api/admin/invitations').send(body).then((r) => r.body.invitation);
  const ivan = await add({ firstName: 'Ivan', lastName: 'Horvat', confirm: true, companions: [{ firstName: 'Ana', lastName: 'Horvat' }] });
  await add({ firstName: 'Željka', lastName: 'Šimić', confirm: true });
  const dec = await add({ firstName: 'Đuro', lastName: 'Čačić' });
  await ctx.anon().post(`/api/invite/${dec.token}/respond`).send({ attending: false });
  await add({ firstName: 'Pero', lastName: 'Perić' });
  const m = await ctx.moderator();
  await m.post('/api/staff/checkin').send({ invitationId: ivan.id });
  return { ctx, a };
}

describe('izvoz', () => {
  let ctx;
  let a;
  before(async () => ({ ctx, a } = await seeded()));

  test('retci po osobi: pratnja je "Ime Prezime – pratnja" odmah ispod nositelja', () => {
    const rows = personRows(listInvitations(ctx.db), 'confirmed');
    const i = rows.findIndex((r) => r.name === 'Ivan Horvat');
    assert.equal(rows[i + 1].name, 'Ana Horvat – pratnja');
    assert.equal(rows[i + 1].host, 'Ivan Horvat');
    assert.equal(rows.length, 3);
  });

  test('filtri statusa', () => {
    const inv = listInvitations(ctx.db);
    assert.deepEqual(personRows(inv, 'declined').map((r) => r.name), ['Đuro Čačić']);
    assert.deepEqual(personRows(inv, 'pending').map((r) => r.name), ['Pero Perić']);
    assert.deepEqual(personRows(inv, 'checked_in').map((r) => r.name), ['Ivan Horvat', 'Ana Horvat – pratnja']);
    assert.ok(personRows(inv, 'all').every((r) => !('organization' in r) && !('groupName' in r)), 'nema organizacije ni grupe');
  });

  test('Excel: listovi po statusu, bez grupa, s hrvatskim znakovima', async () => {
    const res = await a.get('/api/admin/export.xlsx?filter=all').buffer(true).parse(binary);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /zlatna-kuna-31-all-.*\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Sažetak', 'Svi uzvanici', 'Dolaze', 'Ne dolaze', 'Nisu odgovorili', 'Došli (skenirani)']);
    const values = (name) => {
      const out = [];
      wb.getWorksheet(name).eachRow((row) => out.push(row.getCell(2).value));
      return out;
    };
    assert.deepEqual(values('Dolaze'), ['Ime i prezime', 'Ivan Horvat', 'Ana Horvat – pratnja', 'Željka Šimić']);
    assert.deepEqual(values('Ne dolaze'), ['Ime i prezime', 'Đuro Čačić']);
    assert.deepEqual(values('Došli (skenirani)'), ['Ime i prezime', 'Ivan Horvat', 'Ana Horvat – pratnja']);
  });

  test('Excel s filtrom ima samo jedan list', async () => {
    const res = await a.get('/api/admin/export.xlsx?filter=pending').buffer(true).parse(binary);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Nisu odgovorili']);
  });

  test('PDF se generira za svaki filtar', async () => {
    for (const filter of ['all', 'confirmed', 'declined', 'pending', 'checked_in']) {
      const res = await a.get(`/api/admin/export.pdf?filter=${filter}`).buffer(true).parse(binary);
      assert.equal(res.status, 200, filter);
      assert.equal(res.headers['content-type'], 'application/pdf');
      assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
      assert.ok(res.body.length > 5000);
    }
  });

  test('PDF s puno uzvanika ima više stranica', async () => {
    const big = setup();
    const ad = await big.admin();
    const text = Array.from({ length: 120 }, (_, i) => `Gost${i} Prezime${i}`).join('\n');
    await ad.post('/api/admin/invitations/bulk').send({ text, confirm: true });
    const res = await ad.get('/api/admin/export.pdf?filter=all').buffer(true).parse(binary);
    const pages = (res.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert.ok(pages >= 4, `očekivano više stranica, dobiveno ${pages}`);
  });

  test('nepoznat filtar ili format', async () => {
    assert.equal((await a.get('/api/admin/export.xlsx?filter=xyz')).status, 400);
    assert.equal((await a.get('/api/admin/export.csv')).status, 400);
  });
});

describe('QR kod', () => {
  test('generirani QR se može očitati i vodi do istog uzvanika', async () => {
    const ctx = setup();
    const reg = await ticketFor(ctx, (await ctx.anon().post('/api/register').send({ firstName: 'Dora', lastName: 'Đurić' })).body.token);

    // Slika koju gost dobije na zaslonu (data URL)
    const fromScreen = PNG.sync.read(Buffer.from(reg.qrImage.split(',')[1], 'base64'));
    const decoded = jsQR(new Uint8ClampedArray(fromScreen.data), fromScreen.width, fromScreen.height);
    assert.equal(decoded?.data, reg.qrCode);

    // Slika koju gost preuzme
    const dl = await ctx.anon().get(`/api/invite/${reg.token}/qr.png`).buffer(true).parse(binary);
    const png = PNG.sync.read(dl.body);
    assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, reg.qrCode);

    const m = await ctx.moderator();
    const scan = await m.post('/api/staff/scan').send({ code: decoded.data });
    assert.equal(scan.body.invitation.fullName, 'Dora Đurić');
  });

  test('QR sadrži samo nasumični kod, ne osobne podatke', async () => {
    const ctx = setup();
    const reg = await ticketFor(ctx, (await ctx.anon().post('/api/register').send({ firstName: 'Tajna', lastName: 'Osoba' })).body.token);
    assert.doesNotMatch(reg.qrCode, /Tajna|Osoba/);
    const other = await QRCode.toString(reg.qrCode);
    assert.ok(other.length > 0);
  });
});
