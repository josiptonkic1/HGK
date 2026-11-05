// Slanje e-maila. Dva načina (varijable okruženja):
//  1) Brevo HTTP API (preporučeno; radi i na besplatnom Renderu koji blokira SMTP portove):
//       BREVO_API_KEY=xkeysib-...   MAIL_FROM="31. Zlatna kuna <adresa@primjer.hr>"
//  2) SMTP (Brevo, Gmail, HGK mail server...): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
import nodemailer from 'nodemailer';
import { EVENT } from './event.js';

const TIMEOUT_MS = 20000;

// "31. Zlatna kuna <a@b.hr>" -> { name, email }
export function parseFrom(from) {
  const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: String(from || '').trim() };
}

function brevoApiMailer(env, fetchImpl = fetch) {
  const sender = parseFrom(env.MAIL_FROM);
  const call = async (path, init) => {
    const res = await fetchImpl(`https://api.brevo.com/v3${path}`, {
      ...init,
      headers: { 'api-key': env.BREVO_API_KEY, accept: 'application/json', 'content-type': 'application/json', ...(init?.headers || {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch { /* */ }
      throw new Error(`Brevo API (${res.status}): ${msg}`);
    }
    return text ? JSON.parse(text) : {};
  };
  return {
    kind: 'brevo-api',
    from: env.MAIL_FROM,
    inlineImages: false, // slika QR koda ide kao link + privitak
    async send(msg) {
      const payload = { sender, to: [{ email: msg.to }], subject: msg.subject, htmlContent: msg.html };
      if (msg.text) payload.textContent = msg.text;
      // Brevo odbija prazan popis privitaka ("attachment is missing") - polje se šalje samo kad ima privitaka
      const attachments = (msg.attachments || []).map((a) => ({ name: a.filename, content: Buffer.from(a.content).toString('base64') }));
      if (attachments.length) payload.attachment = attachments;
      await call('/smtp/email', { method: 'POST', body: JSON.stringify(payload) });
    },
    verify: () => call('/account', { method: 'GET' }),
  };
}

export function createMailer(env = process.env, { fetchImpl } = {}) {
  if (!env.MAIL_FROM) return null;
  if (env.BREVO_API_KEY) return brevoApiMailer(env, fetchImpl);
  if (!env.SMTP_HOST) return null;
  const port = Number(env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    // bez ovoga bi slanje "visjelo" minutama kad je port blokiran
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: TIMEOUT_MS,
  });
  return {
    kind: 'smtp',
    from: env.MAIL_FROM,
    inlineImages: true,
    send: (msg) => transporter.sendMail({ from: env.MAIL_FROM, ...msg }).catch((err) => {
      if (/timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(err.message)) {
        throw new Error(`SMTP poslužitelj nije dostupan (${err.message}). Hosting vjerojatno blokira SMTP – koristite BREVO_API_KEY.`);
      }
      throw err;
    }),
    verify: () => transporter.verify(),
  };
}

// ---------- predlošci ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rich = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#f2d892">$1</strong>');

// Slike u e-mailu idu s poveznice (Brevo ne podržava ugrađene slike) - adresa aplikacije iz linka pozivnice.
const originOf = (link) => { try { return new URL(link).origin; } catch { return ''; } };

function layout(title, body, link = '') {
  const origin = originOf(link);
  return `<!doctype html><html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#0c0a07;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c0a07;">
<tr><td align="center" style="padding:20px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#15120d;border:1px solid #3a3124;border-radius:14px;">
<tr><td align="center" style="padding:30px 24px 6px;font-family:Montserrat,Arial,Helvetica,sans-serif;">
  <div style="font-size:56px;font-weight:700;line-height:1;color:#e8c66a;">${esc(EVENT.edition)}</div>
  <div style="font-size:26px;font-weight:700;line-height:1.1;color:#e8c66a;letter-spacing:1px;">ZLATNA<br>KUNA</div>
</td></tr>
<tr><td style="padding:18px 22px 28px;font-family:Raleway,'Segoe UI',Arial,sans-serif;color:#ece4d4;font-size:16px;line-height:1.6;">
${body}
</td></tr>
<tr><td align="center" style="padding:6px 30px 26px;font-family:Arial,sans-serif;color:#a99d88;font-size:12px;line-height:1.5;border-top:1px solid #2a241b;">
  ${origin ? `<img src="${esc(origin)}/img/hgk-logo.png" width="120" alt="HGK – ${esc(EVENT.organizer)}" style="display:block;width:120px;max-width:40%;height:auto;margin:18px auto 12px;border:0;">` : ''}
  ${esc(EVENT.organizer)} · <a href="mailto:${esc(EVENT.contactEmail)}" style="color:#d8b25e;">${esc(EVENT.contactEmail)}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

// Ime primatelja kao zaseban redak iznad "Poštovani," (bez pogađanja roda u obraćanju).
// Ako ime još nije upisano (pozivnica na opću adresu), redak se izostavlja.
const personName = (inv) => `${inv.firstName || ''} ${inv.lastName || ''}`.trim();
// Ime u naslovu: Gmail inače spaja pozivnice za istu adresu (npr. tajništvo) u jednu nit.
const named = (subject, inv) => (personName(inv) ? `${subject} – ${personName(inv)}` : subject);

const recipient = (inv) => {
  const name = `${inv.firstName || ''} ${inv.lastName || ''}`.trim();
  return name ? `<p style="margin:0 0 6px;font-size:17px;color:#f2d892;"><strong>${esc(name)}</strong></p>` : '';
};

const button = (href, label) =>
  `<p style="text-align:center;margin:26px 0;"><a href="${esc(href)}" style="display:inline-block;background:#d9b15c;color:#1b1408;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;padding:14px 28px;border-radius:999px;">${esc(label)}</a></p>`;

// Popis osoba; uz svaku osobu i njezino mjesto ako je dodijeljeno (redom: nositelj, pratnja).
const people = (inv, { seats = true } = {}) =>
  `<ul style="list-style:none;padding:0;margin:14px 0;">${inv.guests
    .map((g, i) => {
      const seat = seats ? inv.seatLabels?.[i] : null;
      const who = g.isCompanion ? `${esc(g.fullName)} – pratnja` : `<strong>${esc(g.fullName)}</strong>`;
      return `<li style="padding:8px 0;border-bottom:1px solid #3a3124;">${who}${seat ? `<br><span style="color:#f2d892;">${esc(seat)}</span>` : ''}</li>`;
    })
    .join('')}</ul>`;

// E-karta: šalje se kad su mjesta određena (obično dan prije). QR kod + sjedeće mjesto za svaku osobu.
export function seatEmail(inv, link, qrPng, { imageUrl } = {}) {
  const subject = named(`Vaša e-karta – ${EVENT.title}`, inv);
  const n = inv.guests.length || 1;
  const html = layout(subject, `
${recipient(inv)}
<p>Poštovani,</p>
<p>u nastavku je Vaša e-karta za ${esc(EVENT.titleAccusative || EVENT.title)} u Hrvatskom narodnom kazalištu u Zagrebu${n > 1 ? ` – QR kod vrijedi za sve navedene osobe (${n})` : ''}.</p>
<p style="text-align:center;margin:20px 0;"><img src="${imageUrl ? esc(imageUrl) : 'cid:qr'}" width="240" alt="QR kod e-karte" style="width:240px;max-width:100%;height:auto;background:#fff;padding:10px;border-radius:12px;box-sizing:border-box;"></p>
<p style="margin:0 0 4px;font-size:13px;color:#a99d88;text-transform:uppercase;letter-spacing:1px;">Sjedeća mjesta</p>
${people(inv)}
<p style="border:1px solid #d8b25e;border-radius:10px;padding:14px;background:#1f1a12;">
  <strong style="color:#f2d892;">Važno:</strong> QR kod pokažite <strong>pri preuzimanju ulaznica</strong> na blagajni Hrvatskog narodnog kazališta i <strong>pri ulasku u dvoranu</strong>.
</p>
<p style="font-size:14px;color:#a99d88;">${EVENT.notes.map(esc).join('<br>')}</p>
${button(link, 'Otvori e-kartu')}`, link);
  const lines = inv.guests.map((g, i) => `${g.fullName}${g.isCompanion ? ' (pratnja)' : ''}: ${inv.seatLabels[i] || '-'}`).join('\n');
  const text = `E-karta – ${EVENT.title}\n${lines}\n\nQR kod je u privitku. Pokažite ga pri preuzimanju ulaznica i ulasku u dvoranu.\nVaša e-karta: ${link}`;
  return {
    subject, html, text,
    attachments: [{ filename: 'zlatna-kuna-e-karta.png', content: qrPng, contentType: 'image/png', ...(imageUrl ? {} : { cid: 'qr' }) }],
  };
}

// Potvrda dolaska: odmah nakon prihvaćanja, bez QR koda (on stiže s e-kartom).
export function confirmationEmail(inv, link) {
  const subject = named(`Potvrda dolaska – ${EVENT.title}`, inv);
  const html = layout(subject, `
${recipient(inv)}
<p>Poštovani,</p>
<p>hvala Vam što ste potvrdili dolazak na ${esc(EVENT.titleAccusative || EVENT.title)}. Vaša prijava je zaprimljena:</p>
${people(inv, { seats: false })}
<p style="border:1px solid #d8b25e;border-radius:10px;padding:14px;background:#1f1a12;">
  <strong style="color:#f2d892;">Online e-kartu</strong> s QR kodom i <strong>brojem sjedala</strong> dobit ćete na ovu e-mail adresu <strong>${esc(EVENT.ticketWhen)}</strong>
</p>
<p style="font-size:14px;color:#a99d88;">Ako se nešto promijeni, podatke možete izmijeniti putem svoje pozivnice.</p>
${button(link, 'Otvori svoju pozivnicu')}
<p>${esc(EVENT.regards)}<br>${esc(EVENT.organizer)}</p>`, link);
  const text = `Hvala na potvrdi dolaska na ${EVENT.title}.\nOnline e-kartu s QR kodom i brojem sjedala dobit ćete ${EVENT.ticketWhen}\nVaša pozivnica: ${link}`;
  return { subject, html, text };
}

export function invitationEmail(inv, link) {
  const subject = named(`Pozivnica – ${EVENT.title}`, inv);
  const html = layout(subject, `
${recipient(inv)}
<p>${esc(EVENT.greeting)}<br>${rich(EVENT.intro)}</p>
<p>Molimo potvrdite dolazak putem osobne pozivnice. Nakon potvrde ćete ${esc(EVENT.ticketWhen)} dobiti online e-kartu s QR kodom i brojem sjedala.</p>
${button(link, 'Otvori pozivnicu i potvrdi dolazak')}
<p style="font-size:13px;color:#a99d88;">Ako gumb ne radi, kopirajte ovaj link u preglednik:<br><a href="${esc(link)}" style="color:#d8b25e;word-break:break-all;">${esc(link)}</a></p>
<p>${esc(EVENT.closing)}<br><br>${esc(EVENT.signatureName)}<br>${esc(EVENT.signatureTitle)}</p>`, link);
  const text = `${EVENT.greeting}\n${EVENT.intro.replace(/\*\*/g, '')}\n\nPotvrdite dolazak: ${link}\n\n${EVENT.signatureName}, ${EVENT.signatureTitle}`;
  return { subject, html, text };
}

export function reminderEmail(inv, link) {
  const subject = named(`Podsjetnik: potvrda dolaska – ${EVENT.title}`, inv);
  const html = layout(subject, `
${recipient(inv)}
<p>Poštovani,</p>
<p>ljubazno Vas podsjećamo da još nismo zaprimili potvrdu Vašeg dolaska na ${esc(EVENT.titleAccusative || EVENT.title)}.</p>
${button(link, 'Potvrdi dolazak')}
<p style="font-size:13px;color:#a99d88;">Link: <a href="${esc(link)}" style="color:#d8b25e;word-break:break-all;">${esc(link)}</a></p>`, link);
  const text = `Podsjetnik: molimo potvrdite dolazak na ${EVENT.title}: ${link}`;
  return { subject, html, text };
}

// imageUrl: kad pružatelj ne podržava ugrađene slike (Brevo API), slika se učitava s poveznice
export function qrEmail(inv, link, qrPng, { imageUrl } = {}) {
  const subject = named(`Vaš QR kod – ${EVENT.title}`, inv);
  const n = inv.guests.length;
  const html = layout(subject, `
${recipient(inv)}
<p>Poštovani,</p>
<p>hvala na potvrdi dolaska. U nastavku je Vaš QR kod${n > 1 ? ` – vrijedi za sve navedene osobe (${n})` : ''}.</p>
<p style="text-align:center;margin:20px 0;"><img src="${imageUrl ? esc(imageUrl) : 'cid:qr'}" width="240" alt="QR kod pozivnice" style="width:240px;max-width:100%;height:auto;background:#fff;padding:10px;border-radius:12px;box-sizing:border-box;"></p>
${people(inv)}
<p style="border:1px solid #d8b25e;border-radius:10px;padding:14px;background:#1f1a12;">
  <strong style="color:#f2d892;">Važno:</strong> QR kod pokažite <strong>pri preuzimanju ulaznica</strong> na blagajni Hrvatskog narodnog kazališta i <strong>pri ulasku u dvoranu</strong>.
</p>
<p style="font-size:14px;color:#a99d88;">${EVENT.notes.map(esc).join('<br>')}</p>
${button(link, 'Otvori svoju pozivnicu')}`, link);
  const text = `Hvala na potvrdi dolaska na ${EVENT.title}.\nQR kod je u privitku. Pokažite ga pri preuzimanju ulaznica i ulasku u dvoranu.\nVaša pozivnica: ${link}`;
  return {
    subject, html, text,
    attachments: [{ filename: 'zlatna-kuna-qr.png', content: qrPng, contentType: 'image/png', ...(imageUrl ? {} : { cid: 'qr' }) }],
  };
}
