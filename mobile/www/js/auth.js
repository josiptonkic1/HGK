// Prijava bez poslužitelja: lozinke za "admin" i "moderator" postavljaju se pri prvom
// pokretanju i spremaju na uređaju kao PBKDF2 sažetak (lozinka se nigdje ne sprema u izvornom obliku).
const USERS = 'zk31_users';
const SESSION = 'zk31_session';
const SESSION_HOURS = 12;
export const ROLES = { admin: 'Administrator', moderator: 'Moderator' };

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function derive(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256));
}

async function record(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await derive(password, salt) };
}

export function validatePassword(pw) {
  if (String(pw || '').length < 6) throw new Error('Lozinka mora imati barem 6 znakova.');
}

export const isSetUp = () => {
  const u = read(USERS);
  return Boolean(u?.admin && u?.moderator);
};

export async function setup(adminPassword, moderatorPassword) {
  validatePassword(adminPassword);
  validatePassword(moderatorPassword);
  if (adminPassword === moderatorPassword) throw new Error('Lozinke za admina i moderatora moraju biti različite.');
  write(USERS, { admin: await record(adminPassword), moderator: await record(moderatorPassword) });
}

export async function changePassword(role, password) {
  validatePassword(password);
  const users = read(USERS) || {};
  users[role] = await record(password);
  write(USERS, users);
}

// Vraća ulogu ili null.
export async function login(username, password) {
  const role = String(username || '').trim().toLowerCase();
  const users = read(USERS);
  const u = users?.[role];
  if (!u || !(role in ROLES)) return null;
  if ((await derive(String(password || ''), u.salt)) !== u.hash) return null;
  write(SESSION, { role, until: Date.now() + SESSION_HOURS * 3600 * 1000 });
  return role;
}

export function current() {
  const s = read(SESSION);
  if (!s || !(s.role in ROLES) || s.until < Date.now()) return null;
  return s.role;
}

export function logout() {
  localStorage.removeItem(SESSION);
}
