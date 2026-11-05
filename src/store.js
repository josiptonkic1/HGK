import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { tx } from './db.js';
import { EVENT } from './event.js';

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_COMPANIONS_LIMIT = 20;
const now = () => new Date().toISOString();
export const newToken = (bytes = 16) => randomBytes(bytes).toString('base64url');

// ---------- validacija ----------

export function cleanText(value, max = 120) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function requireName(value, label) {
  const v = cleanText(value, 80);
  if (!v) throw new AppError(400, 'validation', `${label} je obavezno polje.`);
  return v;
}

function cleanEmail(value) {
  const v = cleanText(value, 160).toLowerCase();
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new AppError(400, 'validation', 'E-mail adresa nije ispravna.');
  return v;
}

function guestEmail(value, required) {
  const email = cleanEmail(value);
  if (required && !email) throw new AppError(400, 'validation', 'Upišite e-mail adresu – na nju šaljemo QR kod.');
  return email;
}

function cleanMaxCompanions(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_COMPANIONS_LIMIT) {
    throw new AppError(400, 'validation', `Broj pratnje mora biti između 0 i ${MAX_COMPANIONS_LIMIT}.`);
  }
  return n;
}

function cleanCompanions(list, max) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new AppError(400, 'validation', 'Pratnja nije ispravno poslana.');
  const out = [];
  list.forEach((c, i) => {
    const firstName = cleanText(c?.firstName, 80);
    const lastName = cleanText(c?.lastName, 80);
    if (!firstName && !lastName) return; // prazan red se ignorira
    if (!firstName || !lastName) {
      throw new AppError(400, 'validation', `Upišite ime i prezime za ${i + 1}. osobu u pratnji.`);
    }
    out.push({ id: c?.id ? Number(c.id) : null, firstName, lastName });
  });
  if (max !== undefined && out.length > max) {
    throw new AppError(400, 'too_many_companions', `Pozivnica vrijedi za najviše ${max} ${max === 1 ? 'osobu' : 'osobe'} u pratnji.`);
  }
  return out;
}

// ---------- postavke ----------

const DEFAULT_SETTINGS = { openRegistration: true, defaultMaxCompanions: 1 };

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in s) s[r.key] = JSON.parse(r.value);
  }
  return s;
}

export function updateSettings(db, patch) {
  const s = getSettings(db);
  if ('openRegistration' in patch) s.openRegistration = Boolean(patch.openRegistration);
  if ('defaultMaxCompanions' in patch) s.defaultMaxCompanions = cleanMaxCompanions(patch.defaultMaxCompanions, s.defaultMaxCompanions);
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(s)) stmt.run(k, JSON.stringify(v));
  return s;
}

// ---------- pozivnice ----------

function loadGuests(db, invitationIds) {
  const map = new Map(invitationIds.map((id) => [id, []]));
  if (!invitationIds.length) return map;
  const rows = db
    .prepare(`SELECT * FROM guests WHERE invitation_id IN (${invitationIds.map(() => '?').join(',')}) ORDER BY is_companion, position, id`)
    .all(...invitationIds);
  for (const r of rows) map.get(r.invitation_id)?.push(r);
  return map;
}

function serialize(inv, guests) {
  const g = guests.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    fullName: `${r.first_name} ${r.last_name}`.trim(),
    isCompanion: Boolean(r.is_companion),
    checkedInAt: r.checked_in_at,
    checkedInBy: r.checked_in_by,
  }));
  return {
    id: inv.id,
    token: inv.token,
    qrCode: `${EVENT.qrPrefix}:${inv.qr_token}`,
    firstName: inv.first_name,
    lastName: inv.last_name,
    fullName: `${inv.first_name} ${inv.last_name}`.trim(),
    email: inv.email,
    maxCompanions: inv.max_companions,
    status: inv.status,
    source: inv.source,
    note: inv.note,
    respondedAt: inv.responded_at,
    inviteSentAt: inv.invite_sent_at,
    reminderSentAt: inv.reminder_sent_at,
    qrSentAt: inv.qr_sent_at,
    createdAt: inv.created_at,
    guests: g,
    personCount: g.length || 1,
    checkedInCount: g.filter((x) => x.checkedInAt).length,
  };
}

function fetchOne(db, where, value) {
  const inv = db.prepare(`SELECT * FROM invitations WHERE ${where} = ?`).get(value);
  if (!inv) return null;
  return serialize(inv, loadGuests(db, [inv.id]).get(inv.id));
}

export const getInvitationById = (db, id) => fetchOne(db, 'id', Number(id));
export const getInvitationByToken = (db, token) => fetchOne(db, 'token', String(token));

export function getInvitationByQr(db, scanned) {
  const text = String(scanned || '').trim();
  // Prihvaća "ZK31:abc..." ili samo token.
  const m = text.match(/([A-Za-z0-9_-]{12,})\s*$/);
  if (!m) return null;
  return fetchOne(db, 'qr_token', m[1]);
}

export function listInvitations(db) {
  const invs = db.prepare('SELECT * FROM invitations ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE, id').all();
  const guests = loadGuests(db, invs.map((i) => i.id));
  return invs.map((i) => serialize(i, guests.get(i.id)));
}

// Uskladi popis osoba (nositelj + pratnja) s bazom, čuvajući evidenciju dolaska za osobe koje ostaju.
function syncGuests(db, invitationId, primary, companions) {
  const existing = db.prepare('SELECT * FROM guests WHERE invitation_id = ?').all(invitationId);
  const keep = new Set();

  if (primary) {
    const p = existing.find((g) => !g.is_companion);
    if (p) {
      db.prepare('UPDATE guests SET first_name = ?, last_name = ?, position = 0 WHERE id = ?').run(primary.firstName, primary.lastName, p.id);
      keep.add(p.id);
    } else {
      db.prepare('INSERT INTO guests(invitation_id, first_name, last_name, is_companion, position) VALUES (?, ?, ?, 0, 0)').run(
        invitationId, primary.firstName, primary.lastName,
      );
    }
    companions.forEach((c, i) => {
      const match = c.id && existing.find((g) => g.id === c.id && g.is_companion);
      if (match) {
        db.prepare('UPDATE guests SET first_name = ?, last_name = ?, position = ? WHERE id = ?').run(c.firstName, c.lastName, i + 1, match.id);
        keep.add(match.id);
      } else {
        db.prepare('INSERT INTO guests(invitation_id, first_name, last_name, is_companion, position) VALUES (?, ?, ?, 1, ?)').run(
          invitationId, c.firstName, c.lastName, i + 1,
        );
      }
    });
  }

  const removed = existing.filter((g) => !keep.has(g.id));
  if (removed.some((g) => g.checked_in_at)) {
    throw new AppError(409, 'already_checked_in', 'Ne možete ukloniti osobu kojoj je već evidentiran dolazak.');
  }
  for (const g of removed) db.prepare('DELETE FROM guests WHERE id = ?').run(g.id);
}

export function createInvitation(db, input, { source = 'invite', requireEmail = false } = {}) {
  const settings = getSettings(db);
  const confirm = Boolean(input.confirm) || source === 'open';
  const firstName = requireName(input.firstName, 'Ime');
  const lastName = requireName(input.lastName, 'Prezime');
  const maxCompanions = cleanMaxCompanions(input.maxCompanions, settings.defaultMaxCompanions);
  // Administrator smije dodati više pratnje od zadanog broja; tada se limit podiže.
  const companions = cleanCompanions(input.companions, source === 'admin' ? undefined : maxCompanions);
  const effectiveMax = Math.max(maxCompanions, companions.length);
  // Gost s općeg linka mora upisati e-mail za QR kod (kad je slanje podešeno)
  const email = guestEmail(input.email, requireEmail && source === 'open');

  return tx(db, () => {
    const ts = now();
    const res = db
      .prepare(
        `INSERT INTO invitations(token, qr_token, first_name, last_name, email, organization, group_name, max_companions, status, source, note, responded_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newToken(16), newToken(12), firstName, lastName,
        email, '', '', // organizacija i grupa se više ne koriste
        effectiveMax, confirm ? 'confirmed' : 'pending', source, cleanText(input.note, 500),
        confirm ? ts : null, ts,
      );
    const id = Number(res.lastInsertRowid);
    if (confirm) syncGuests(db, id, { firstName, lastName }, companions);
    return getInvitationById(db, id);
  });
}

// Odgovor gosta preko linka pozivnice.
export function respondToInvitation(db, token, input, { requireEmail = false } = {}) {
  const inv = getInvitationByToken(db, token);
  if (!inv) throw new AppError(404, 'not_found', 'Pozivnica nije pronađena.');
  if (inv.checkedInCount > 0) {
    throw new AppError(409, 'already_checked_in', 'Dolazak je već evidentiran pa se podaci više ne mogu mijenjati.');
  }
  const attending = input.attending !== false;
  return tx(db, () => {
    if (!attending) {
      db.prepare("UPDATE invitations SET status = 'declined', responded_at = ? WHERE id = ?").run(now(), inv.id);
      syncGuests(db, inv.id, null, []);
      return getInvitationById(db, inv.id);
    }
    const firstName = requireName(input.firstName, 'Ime');
    const lastName = requireName(input.lastName, 'Prezime');
    const companions = cleanCompanions(input.companions, inv.maxCompanions).map((c) => ({ ...c, id: null }));
    const email = guestEmail('email' in input ? input.email : inv.email, requireEmail);
    db.prepare("UPDATE invitations SET first_name = ?, last_name = ?, email = ?, status = 'confirmed', responded_at = ? WHERE id = ?").run(
      firstName, lastName, email, now(), inv.id,
    );
    db.prepare('DELETE FROM guests WHERE invitation_id = ?').run(inv.id);
    syncGuests(db, inv.id, { firstName, lastName }, companions);
    return getInvitationById(db, inv.id);
  });
}

export function updateInvitation(db, id, input) {
  const inv = getInvitationById(db, id);
  if (!inv) throw new AppError(404, 'not_found', 'Uzvanik nije pronađen.');
  const firstName = 'firstName' in input ? requireName(input.firstName, 'Ime') : inv.firstName;
  const lastName = 'lastName' in input ? requireName(input.lastName, 'Prezime') : inv.lastName;
  const status = input.status ?? inv.status;
  if (!['pending', 'confirmed', 'declined'].includes(status)) throw new AppError(400, 'validation', 'Nepoznat status.');
  const companions =
    'companions' in input
      ? cleanCompanions(input.companions)
      : inv.guests.filter((g) => g.isCompanion).map((g) => ({ id: g.id, firstName: g.firstName, lastName: g.lastName }));
  const maxCompanions = Math.max(cleanMaxCompanions(input.maxCompanions, inv.maxCompanions), companions.length);

  return tx(db, () => {
    db.prepare(
      `UPDATE invitations SET first_name = ?, last_name = ?, email = ?, max_companions = ?,
         status = ?, note = ?, responded_at = ? WHERE id = ?`,
    ).run(
      firstName, lastName,
      'email' in input ? cleanEmail(input.email) : inv.email,
      maxCompanions, status,
      'note' in input ? cleanText(input.note, 500) : inv.note,
      status !== inv.status ? (status === 'pending' ? null : now()) : inv.respondedAt,
      inv.id,
    );
    if (status === 'confirmed') syncGuests(db, inv.id, { firstName, lastName }, companions);
    else syncGuests(db, inv.id, null, []);
    return getInvitationById(db, inv.id);
  });
}

const SENT_COLUMN = { invite: 'invite_sent_at', reminder: 'reminder_sent_at', qr: 'qr_sent_at' };
export function markSent(db, id, kind) {
  const col = SENT_COLUMN[kind];
  if (!col) throw new Error('nepoznata vrsta e-maila');
  db.prepare(`UPDATE invitations SET ${col} = ? WHERE id = ?`).run(now(), Number(id));
  return getInvitationById(db, id);
}

export function deleteInvitation(db, id) {
  const res = db.prepare('DELETE FROM invitations WHERE id = ?').run(Number(id));
  if (!res.changes) throw new AppError(404, 'not_found', 'Uzvanik nije pronađen.');
}

// Evidencija dolaska (moderator / admin). guestIds prazno = svi koji još nisu evidentirani.
export function checkIn(db, invitationId, { guestIds = [], force = false, by = '' } = {}) {
  const inv = getInvitationById(db, invitationId);
  if (!inv) throw new AppError(404, 'not_found', 'Uzvanik nije pronađen.');
  if (inv.status !== 'confirmed' && !force) {
    const msg = inv.status === 'declined' ? 'Uzvanik je otkazao dolazak.' : 'Uzvanik nije potvrdio dolazak.';
    throw new AppError(409, 'not_confirmed', msg);
  }
  return tx(db, () => {
    if (inv.status !== 'confirmed') {
      db.prepare("UPDATE invitations SET status = 'confirmed', responded_at = ? WHERE id = ?").run(now(), inv.id);
      syncGuests(db, inv.id, { firstName: inv.firstName, lastName: inv.lastName }, []);
    }
    const current = getInvitationById(db, inv.id);
    const wanted = guestIds.length ? current.guests.filter((g) => guestIds.map(Number).includes(g.id)) : current.guests;
    if (guestIds.length && wanted.length !== new Set(guestIds.map(Number)).size) {
      throw new AppError(400, 'validation', 'Odabrana osoba ne pripada ovoj pozivnici.');
    }
    const ts = now();
    const newly = [];
    const already = [];
    for (const g of wanted) {
      if (g.checkedInAt) already.push(g.id);
      else {
        db.prepare('UPDATE guests SET checked_in_at = ?, checked_in_by = ? WHERE id = ?').run(ts, cleanText(by, 80), g.id);
        newly.push(g.id);
      }
    }
    return { invitation: getInvitationById(db, inv.id), newlyCheckedIn: newly, alreadyCheckedIn: already };
  });
}

export function undoCheckIn(db, guestId) {
  const g = db.prepare('SELECT * FROM guests WHERE id = ?').get(Number(guestId));
  if (!g) throw new AppError(404, 'not_found', 'Osoba nije pronađena.');
  db.prepare('UPDATE guests SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ?').run(g.id);
  return getInvitationById(db, g.invitation_id);
}

export function computeStats(invitations) {
  const s = {
    invitations: invitations.length,
    confirmedInvitations: 0, declinedInvitations: 0, pendingInvitations: 0,
    confirmedPersons: 0, declinedPersons: 0, pendingPersons: 0,
    companions: 0, checkedInPersons: 0, checkedInInvitations: 0,
  };
  for (const inv of invitations) {
    s[`${inv.status}Invitations`]++;
    s[`${inv.status}Persons`] += inv.personCount;
    s.companions += inv.guests.filter((g) => g.isCompanion).length;
    s.checkedInPersons += inv.checkedInCount;
    if (inv.checkedInCount) s.checkedInInvitations++;
  }
  return s;
}

// ---------- korisnici ----------

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

const publicUser = (u) => u && { id: u.id, username: u.username, name: u.name, role: u.role, createdAt: u.created_at };

export function createUser(db, { username, name, password, role }) {
  const u = cleanText(username, 60).toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(u)) {
    throw new AppError(400, 'validation', 'Korisničko ime mora imati barem 3 znaka (slova, brojke, točka, crtica).');
  }
  if (!['admin', 'moderator'].includes(role)) throw new AppError(400, 'validation', 'Uloga mora biti admin ili moderator.');
  if (String(password || '').length < 8) throw new AppError(400, 'validation', 'Lozinka mora imati barem 8 znakova.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u)) {
    throw new AppError(409, 'exists', 'Korisničko ime je već zauzeto.');
  }
  const res = db
    .prepare('INSERT INTO users(username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(u, cleanText(name, 80), hashPassword(password), role, now());
  return getUser(db, Number(res.lastInsertRowid));
}

export const getUser = (db, id) => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id)));
export const listUsers = (db) => db.prepare('SELECT * FROM users ORDER BY role, username').all().map(publicUser);

export function authenticate(db, username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanText(username, 60).toLowerCase());
  if (!u || !verifyPassword(password, u.password_hash)) return null;
  return publicUser(u);
}

export function deleteUser(db, id, currentUserId) {
  const u = getUser(db, id);
  if (!u) throw new AppError(404, 'not_found', 'Korisnik nije pronađen.');
  if (u.id === currentUserId) throw new AppError(400, 'validation', 'Ne možete obrisati vlastiti račun.');
  if (u.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n <= 1) {
    throw new AppError(400, 'validation', 'Mora postojati barem jedan administrator.');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
}

// Početni korisnici iz .env / Render Environment. Varijable su "izvor istine":
// korisnik se kreira ako ne postoji, a ako postoji, lozinka i uloga se usklade s varijablama.
// Neispravne vrijednosti (npr. prekratka lozinka) ne ruše pokretanje - vraćaju se kao greške.
export function ensureSeedUsers(db, seeds) {
  const created = [];
  const updated = [];
  const errors = [];
  for (const { username, password, name, role } of seeds) {
    if (!username || !password) continue;
    const u = cleanText(username, 60).toLowerCase();
    try {
      const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(u);
      if (!existing) {
        created.push(createUser(db, { username: u, password, name, role }));
        continue;
      }
      if (String(password).length < 8) throw new AppError(400, 'validation', 'Lozinka mora imati barem 8 znakova.');
      if (!verifyPassword(password, existing.password_hash) || existing.role !== role) {
        db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(hashPassword(password), role, existing.id);
        updated.push(getUser(db, existing.id));
      }
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      errors.push({ username: u, role, message: err.message });
    }
  }
  return { created, updated, errors };
}
