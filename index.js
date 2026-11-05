import { randomBytes } from 'node:crypto';
import { openDb } from './src/db.js';
import { createApp } from './src/app.js';
import { ensureSeedUsers } from './src/store.js';
import { createMailer } from './src/mail.js';

const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || './data/zlatna-kuna.db';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = randomBytes(32).toString('hex');
  console.warn('UPOZORENJE: SESSION_SECRET nije postavljen - prijave osoblja vrijede samo do ponovnog pokretanja.');
}

const db = openDb(DB_FILE);
const seed = ensureSeedUsers(db, [
  { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD, name: 'Administrator', role: 'admin' },
  { username: process.env.MODERATOR_USERNAME, password: process.env.MODERATOR_PASSWORD, name: 'Moderator', role: 'moderator' },
]);
for (const u of seed.created) console.log(`Kreiran korisnik "${u.username}" (${u.role}).`);
for (const u of seed.updated) console.log(`Lozinka za "${u.username}" (${u.role}) usklađena s varijablama okruženja.`);
for (const e of seed.errors) console.error(`GREŠKA: korisnik "${e.username}" (${e.role}) nije postavljen: ${e.message}`);

const mailer = createMailer(process.env);
if (mailer) {
  console.log(`E-mail: slanje preko ${process.env.SMTP_HOST} (pošiljatelj ${process.env.MAIL_FROM}).`);
  mailer.verify().then(() => console.log('E-mail: SMTP prijava uspješna.')).catch((err) => console.error(`E-mail: SMTP prijava NIJE uspjela: ${err.message}`));
} else {
  console.log('E-mail: nije podešeno (SMTP_HOST i MAIL_FROM) - pozivnice i QR kodovi se ne šalju e-mailom.');
}

const app = createApp({
  mailer,
  db,
  sessionSecret,
  secureCookies: process.env.COOKIE_SECURE === 'true',
  trustProxy: !process.env.TRUST_PROXY ? false : /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY,
});

// Zadano samo lokalno (127.0.0.1) - na poslovnom laptopu tako ne treba dozvola vatrozida.
// Na serveru postavite HOST=0.0.0.0 (ili iza reverse proxyja ostavite 127.0.0.1).
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`Zlatna kuna pozivnice: http://localhost:${PORT} (sluša na ${HOST})`));
