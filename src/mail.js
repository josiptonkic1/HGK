// Slanje e-maila preko SMTP-a (Brevo, Gmail, HGK mail server...).
// Podešava se varijablama okruženja: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
import nodemailer from 'nodemailer';
import { EVENT } from './event.js';

export function createMailer(env = process.env) {
  if (!env.SMTP_HOST || !env.MAIL_FROM) return null;
  const port = Number(env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return {
    from: env.MAIL_FROM,
    send: (msg) => transporter.sendMail({ from: env.MAIL_FROM, ...msg }),
    verify: () => transporter.verify(),
  };
}

// ---------- predlošci ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rich = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#f2d892">$1</strong>');

function layout(title, body) {
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
<tr><td align="center" style="padding:0 30px 26px;font-family:Arial,sans-serif;color:#a99d88;font-size:12px;line-height:1.5;">
  ${esc(EVENT.organizer)} · <a href="mailto:${esc(EVENT.contactEmail)}" style="color:#d8b25e;">${esc(EVENT.contactEmail)}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<p style="text-align:center;margin:26px 0;"><a href="${esc(href)}" style="display:inline-block;background:#d9b15c;color:#1b1408;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;padding:14px 28px;border-radius:999px;">${esc(label)}</a></p>`;

const people = (inv) =>
  `<ul style="list-style:none;padding:0;margin:14px 0;">${inv.guests
    .map((g) => `<li style="padding:6px 0;border-bottom:1px solid #3a3124;">${g.isCompanion ? `${esc(g.fullName)} – pratnja` : `<strong>${esc(g.fullName)}</strong>`}</li>`)
    .join('')}</ul>`;

export function invitationEmail(inv, link) {
  const subject = `Pozivnica – ${EVENT.title}`;
  const html = layout(subject, `
<p>${esc(EVENT.greeting)}<br>${rich(EVENT.intro)}</p>
<p>Molimo potvrdite dolazak putem osobne pozivnice. Nakon potvrde dobit ćete QR kod za preuzimanje ulaznica i ulazak u dvoranu.</p>
${button(link, 'Otvori pozivnicu i potvrdi dolazak')}
<p style="font-size:13px;color:#a99d88;">Ako gumb ne radi, kopirajte ovaj link u preglednik:<br><a href="${esc(link)}" style="color:#d8b25e;word-break:break-all;">${esc(link)}</a></p>
<p>${esc(EVENT.closing)}<br><br>${esc(EVENT.signatureName)}<br>${esc(EVENT.signatureTitle)}</p>`);
  const text = `${EVENT.greeting}\n${EVENT.intro.replace(/\*\*/g, '')}\n\nPotvrdite dolazak: ${link}\n\n${EVENT.signatureName}, ${EVENT.signatureTitle}`;
  return { subject, html, text };
}

export function reminderEmail(inv, link) {
  const subject = `Podsjetnik: potvrda dolaska – ${EVENT.title}`;
  const html = layout(subject, `
<p>Poštovani${inv.firstName ? ` ${esc(inv.firstName)} ${esc(inv.lastName)}` : ''},</p>
<p>ljubazno Vas podsjećamo da još nismo zaprimili potvrdu Vašeg dolaska na ${esc(EVENT.titleAccusative || EVENT.title)}.</p>
${button(link, 'Potvrdi dolazak')}
<p style="font-size:13px;color:#a99d88;">Link: <a href="${esc(link)}" style="color:#d8b25e;word-break:break-all;">${esc(link)}</a></p>`);
  const text = `Podsjetnik: molimo potvrdite dolazak na ${EVENT.title}: ${link}`;
  return { subject, html, text };
}

export function qrEmail(inv, link, qrPng) {
  const subject = `Vaš QR kod – ${EVENT.title}`;
  const n = inv.guests.length;
  const html = layout(subject, `
<p>Poštovani ${esc(inv.firstName)} ${esc(inv.lastName)},</p>
<p>hvala na potvrdi dolaska. U nastavku je Vaš QR kod${n > 1 ? ` – vrijedi za sve navedene osobe (${n})` : ''}.</p>
<p style="text-align:center;margin:20px 0;"><img src="cid:qr" width="240" alt="QR kod pozivnice" style="width:240px;max-width:100%;height:auto;background:#fff;padding:10px;border-radius:12px;box-sizing:border-box;"></p>
${people(inv)}
<p style="border:1px solid #d8b25e;border-radius:10px;padding:14px;background:#1f1a12;">
  <strong style="color:#f2d892;">Važno:</strong> QR kod pokažite <strong>pri preuzimanju ulaznica</strong> na blagajni Hrvatskog narodnog kazališta i <strong>pri ulasku u dvoranu</strong>.
</p>
<p style="font-size:14px;color:#a99d88;">${EVENT.notes.map(esc).join('<br>')}</p>
${button(link, 'Otvori svoju pozivnicu')}`);
  const text = `Hvala na potvrdi dolaska na ${EVENT.title}.\nQR kod je u privitku. Pokažite ga pri preuzimanju ulaznica i ulasku u dvoranu.\nVaša pozivnica: ${link}`;
  return {
    subject, html, text,
    attachments: [{ filename: 'zlatna-kuna-qr.png', content: qrPng, cid: 'qr', contentType: 'image/png' }],
  };
}
