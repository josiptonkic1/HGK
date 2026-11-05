import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, parseFrom } from '../src/mail.js';
import { setup } from './helpers.js';

function fakeFetch(status = 201, body = '{"messageId":"<x@brevo>"}') {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return { ok: status < 400, status, text: async () => body };
  };
  fn.calls = calls;
  return fn;
}

describe('Brevo HTTP API (radi i kad hosting blokira SMTP)', () => {
  test('pošiljatelj iz MAIL_FROM', () => {
    assert.deepEqual(parseFrom('31. Zlatna kuna <josip@primjer.hr>'), { name: '31. Zlatna kuna', email: 'josip@primjer.hr' });
    assert.deepEqual(parseFrom('josip@primjer.hr'), { email: 'josip@primjer.hr' });
  });

  test('API ima prednost pred SMTP-om; bez MAIL_FROM nema slanja', () => {
    assert.equal(createMailer({ BREVO_API_KEY: 'k', SMTP_HOST: 'smtp.x', MAIL_FROM: 'a@b.hr' }).kind, 'brevo-api');
    assert.equal(createMailer({ SMTP_HOST: 'smtp.x', MAIL_FROM: 'a@b.hr' }).kind, 'smtp');
    assert.equal(createMailer({ BREVO_API_KEY: 'k' }), null);
    assert.equal(createMailer({}), null);
  });

  test('poziv API-ja: ključ, primatelj, sadržaj i privitak', async () => {
    const f = fakeFetch();
    const m = createMailer({ BREVO_API_KEY: 'xkeysib-test', MAIL_FROM: 'Zlatna kuna <z@k.hr>' }, { fetchImpl: f });
    await m.send({ to: 'gost@primjer.hr', subject: 'S', html: '<p>H</p>', text: 'T', attachments: [{ filename: 'qr.png', content: Buffer.from('PNGDATA') }] });
    const c = f.calls[0];
    assert.equal(c.url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(c.init.headers['api-key'], 'xkeysib-test');
    assert.deepEqual(c.body.sender, { name: 'Zlatna kuna', email: 'z@k.hr' });
    assert.deepEqual(c.body.to, [{ email: 'gost@primjer.hr' }]);
    assert.equal(c.body.htmlContent, '<p>H</p>');
    assert.deepEqual(c.body.attachment, [{ name: 'qr.png', content: Buffer.from('PNGDATA').toString('base64') }]);
  });

  test('greška API-ja se jasno prijavi', async () => {
    const m = createMailer({ BREVO_API_KEY: 'krivi', MAIL_FROM: 'z@k.hr' }, { fetchImpl: fakeFetch(401, '{"message":"Key not found"}') });
    await assert.rejects(m.send({ to: 'a@b.hr', subject: 's', html: 'h' }), /Brevo API \(401\): Key not found/);
  });

  test('QR e-mail preko API-ja: slika s poveznice + privitak', async () => {
    const f = fakeFetch();
    const mailer = createMailer({ BREVO_API_KEY: 'k', MAIL_FROM: 'z@k.hr' }, { fetchImpl: f });
    const ctx = setup({ mailer });
    const res = await ctx.anon().post('/api/register').send({ firstName: 'Ana', lastName: 'Anić', email: 'ana@primjer.hr' });
    assert.equal(res.body.mail, 'sent');
    const body = f.calls[0].body;
    assert.match(body.htmlContent, new RegExp(`/api/invite/${res.body.token}/qr\\.png`));
    assert.doesNotMatch(body.htmlContent, /cid:qr/);
    assert.equal(body.attachment[0].name, 'zlatna-kuna-qr.png');
  });
});
