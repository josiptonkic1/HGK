import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'moderator')),
  created_at TEXT NOT NULL
);

-- Jedna pozivnica = jedan pozvani gost (nositelj) i njegova pratnja.
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,          -- dio osobnog linka /p/<token>
  qr_token TEXT NOT NULL UNIQUE,       -- sadržaj QR koda
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  max_companions INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined')),
  source TEXT NOT NULL DEFAULT 'invite' CHECK (source IN ('invite', 'open', 'admin')),
  note TEXT NOT NULL DEFAULT '',
  responded_at TEXT,
  created_at TEXT NOT NULL
);

-- Osobe koje dolaze (nositelj + pratnja). Popunjava se kod potvrde dolaska.
CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY,
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  is_companion INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  checked_in_at TEXT,
  checked_in_by TEXT
);
CREATE INDEX IF NOT EXISTS guests_invitation ON guests(invitation_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // Nadogradnja postojeće baze: evidencija poslanih e-mailova
  const cols = db.prepare('PRAGMA table_info(invitations)').all().map((c) => c.name);
  for (const col of ['invite_sent_at', 'reminder_sent_at', 'qr_sent_at', 'seat_sent_at']) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE invitations ADD COLUMN ${col} TEXT`);
  }
  // Sjedeća mjesta (JSON popis oznaka iz public/js/seatplan.js, redom: nositelj, pratnja)
  if (!cols.includes('seats')) db.exec("ALTER TABLE invitations ADD COLUMN seats TEXT NOT NULL DEFAULT '[]'");
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
