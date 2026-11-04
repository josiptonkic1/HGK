// Prvo pokretanje: kreira .env s nasumičnim tajnim ključem i lozinkama
// te zapisuje PRISTUPNI-PODACI.txt. Postojeći .env se nikad ne dira.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomInt } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
const credFile = join(root, 'PRISTUPNI-PODACI.txt');

if (existsSync(envFile)) {
  console.log('.env već postoji - ništa nije promijenjeno.');
  process.exit(0);
}

// Bez sličnih znakova (0/O, 1/l/I) da se lozinka lakše prepiše.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const password = (n = 14) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const values = {
  SESSION_SECRET: randomBytes(32).toString('hex'),
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: password(),
  MODERATOR_USERNAME: 'moderator',
  MODERATOR_PASSWORD: password(),
};

const template = readFileSync(join(root, '.env.example'), 'utf8');
const env = template
  .split(/\r?\n/)
  .map((line) => {
    const m = line.match(/^([A-Z_]+)=/);
    return m && m[1] in values ? `${m[1]}=${values[m[1]]}` : line;
  })
  .join('\n');
writeFileSync(envFile, env);

const port = (env.match(/^PORT=(\d+)/m) || [])[1] || '3000';
const creds = `31. ZLATNA KUNA - PRISTUPNI PODACI
==================================
Ne slati javno. Lozinke se mijenjaju u datoteci .env (prije prvog pokretanja ili
brisanjem baze u mapi data/).

Prijava osoblja:     http://localhost:${port}/prijava
Opći link pozivnice: http://localhost:${port}/pozivnica

ADMINISTRATOR
  Korisničko ime: ${values.ADMIN_USERNAME}
  Lozinka:        ${values.ADMIN_PASSWORD}

MODERATOR
  Korisničko ime: ${values.MODERATOR_USERNAME}
  Lozinka:        ${values.MODERATOR_PASSWORD}
`;
writeFileSync(credFile, creds);

console.log('\n' + creds);
console.log(`Podaci su spremljeni u ${credFile}\n`);
