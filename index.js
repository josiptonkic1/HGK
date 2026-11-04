import { randomBytes } from 'node:crypto';
import { openDb } from './src/db.js';
import { createApp } from './src/app.js';
import { ensureAdmin } from './src/store.js';

const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || './data/zlatna-kuna.db';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = randomBytes(32).toString('hex');
  console.warn('UPOZORENJE: SESSION_SECRET nije postavljen - prijave osoblja vrijede samo do ponovnog pokretanja.');
}

const db = openDb(DB_FILE);
const created = ensureAdmin(db, { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
if (created) console.log(`Kreiran administrator "${created.username}".`);

const app = createApp({
  db,
  sessionSecret,
  secureCookies: process.env.COOKIE_SECURE === 'true',
  trustProxy: !process.env.TRUST_PROXY ? false : /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY,
});

// Zadano samo lokalno (127.0.0.1) - na poslovnom laptopu tako ne treba dozvola vatrozida.
// Na serveru postavite HOST=0.0.0.0 (ili iza reverse proxyja ostavite 127.0.0.1).
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`Zlatna kuna pozivnice: http://localhost:${PORT} (sluša na ${HOST})`));
