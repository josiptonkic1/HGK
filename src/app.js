import express from 'express';
import cookieSession from 'cookie-session';
import QRCode from 'qrcode';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT } from './event.js';
import * as store from './store.js';
import { AppError } from './store.js';
import { buildPdf, buildXlsx, FILTERS } from './export.js';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

export async function qrDataUrl(code) {
  return QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 2, width: 560, color: { dark: '#000000', light: '#ffffff' } });
}

// Javni prikaz pozivnice (bez internih podataka).
async function publicInvitation(inv) {
  return {
    token: inv.token,
    firstName: inv.firstName,
    lastName: inv.lastName,
    maxCompanions: inv.maxCompanions,
    status: inv.status,
    editable: inv.checkedInCount === 0,
    guests: inv.guests.map((g) => ({ firstName: g.firstName, lastName: g.lastName, fullName: g.fullName, isCompanion: g.isCompanion, checkedIn: Boolean(g.checkedInAt) })),
    qrCode: inv.status === 'confirmed' ? inv.qrCode : null,
    qrImage: inv.status === 'confirmed' ? await qrDataUrl(inv.qrCode) : null,
  };
}

function loginLimiter() {
  const attempts = new Map();
  const WINDOW = 15 * 60 * 1000;
  const MAX = 10;
  return {
    blocked(key) {
      const a = attempts.get(key);
      if (!a || Date.now() - a.first > WINDOW) return false;
      return a.count >= MAX;
    },
    fail(key) {
      const a = attempts.get(key);
      if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { first: Date.now(), count: 1 });
      else a.count++;
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}

export function createApp({ db, sessionSecret, secureCookies = false, trustProxy = false }) {
  if (!sessionSecret || sessionSecret.length < 16) throw new Error('SESSION_SECRET mora imati barem 16 znakova.');
  const app = express();
  const limiter = loginLimiter();
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(
    cookieSession({
      name: 'zk_session',
      keys: [sessionSecret],
      maxAge: 12 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookies,
    }),
  );

  // ---------- pomoćne funkcije ----------
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  const currentUser = (req) => (req.session?.userId ? store.getUser(db, req.session.userId) : null);

  const requireRole = (...roles) => (req, res, next) => {
    const user = currentUser(req);
    if (!user) return next(new AppError(401, 'unauthorized', 'Prijavite se.'));
    if (!roles.includes(user.role)) return next(new AppError(403, 'forbidden', 'Nemate ovlasti za ovu radnju.'));
    req.user = user;
    next();
  };
  const staff = requireRole('admin', 'moderator');
  const admin = requireRole('admin');

  // ---------- stranice ----------
  const page = (file) => (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(join(PUBLIC, file));
  };
  app.get('/', (req, res) => res.redirect('/pozivnica'));
  app.get('/pozivnica', page('invite.html'));
  app.get('/p/:token', page('invite.html'));
  app.get('/prijava', page('login.html'));
  app.get('/staff', page('staff.html'));

  app.use('/vendor/html5-qrcode.min.js', (req, res) => res.sendFile(require.resolve('html5-qrcode/html5-qrcode.min.js')));
  app.use('/vendor/fontsource', express.static(join(dirname(require.resolve('@fontsource/montserrat/package.json')), '..'), { maxAge: '7d' }));
  app.use(express.static(PUBLIC, { index: false, extensions: ['html'] }));

  // ---------- javni API ----------
  app.get('/api/event', (req, res) => {
    // Javni podaci; Android aplikacija ovim provjerava upisanu adresu poslužitelja.
    res.set('Access-Control-Allow-Origin', '*');
    const s = store.getSettings(db);
    res.json({ event: EVENT, openRegistration: s.openRegistration, defaultMaxCompanions: s.defaultMaxCompanions });
  });

  app.get('/api/invite/:token', wrap(async (req, res) => {
    const inv = store.getInvitationByToken(db, req.params.token);
    if (!inv) throw new AppError(404, 'not_found', 'Pozivnica nije pronađena. Provjerite link koji ste dobili.');
    res.json(await publicInvitation(inv));
  }));

  app.post('/api/invite/:token/respond', wrap(async (req, res) => {
    const inv = store.respondToInvitation(db, req.params.token, req.body || {});
    res.json(await publicInvitation(inv));
  }));

  // Opći link: gost sam upisuje podatke, pozivnica se odmah potvrđuje.
  app.post('/api/register', wrap(async (req, res) => {
    const s = store.getSettings(db);
    if (!s.openRegistration) throw new AppError(403, 'registration_closed', 'Prijave putem općeg linka su zatvorene.');
    const body = req.body || {};
    const inv = store.createInvitation(
      db,
      { firstName: body.firstName, lastName: body.lastName, companions: body.companions, maxCompanions: s.defaultMaxCompanions },
      { source: 'open' },
    );
    res.status(201).json(await publicInvitation(inv));
  }));

  app.get('/api/invite/:token/qr.png', wrap(async (req, res) => {
    const inv = store.getInvitationByToken(db, req.params.token);
    if (!inv || inv.status !== 'confirmed') throw new AppError(404, 'not_found', 'QR kod nije dostupan.');
    const png = await QRCode.toBuffer(inv.qrCode, { errorCorrectionLevel: 'M', margin: 3, width: 800 });
    const name = `${EVENT.qrPrefix}-${inv.firstName}-${inv.lastName}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9-]+/g, '_');
    res.set({ 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${name}.png"` }).send(png);
  }));

  // ---------- prijava osoblja ----------
  app.post('/api/auth/login', (req, res, next) => {
    const key = req.ip;
    if (limiter.blocked(key)) return next(new AppError(429, 'too_many_attempts', 'Previše neuspjelih pokušaja. Pokušajte za 15 minuta.'));
    const user = store.authenticate(db, req.body?.username, req.body?.password);
    if (!user) {
      limiter.fail(key);
      return next(new AppError(401, 'invalid_login', 'Pogrešno korisničko ime ili lozinka.'));
    }
    limiter.reset(key);
    req.session.userId = user.id;
    res.json({ user });
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized', message: 'Prijavite se.' });
    res.json({ user });
  });

  // ---------- moderator + admin ----------
  app.get('/api/staff/invitations', staff, (req, res) => {
    const list = store.listInvitations(db);
    res.json({ invitations: list, stats: store.computeStats(list) });
  });

  app.post('/api/staff/scan', staff, (req, res, next) => {
    const inv = store.getInvitationByQr(db, req.body?.code);
    if (!inv) return next(new AppError(404, 'not_found', 'QR kod nije prepoznat. Potražite uzvanika po imenu.'));
    res.json({ invitation: inv });
  });

  app.post('/api/staff/checkin', staff, (req, res) => {
    const { invitationId, guestIds, force } = req.body || {};
    const result = store.checkIn(db, invitationId, {
      guestIds: Array.isArray(guestIds) ? guestIds : [],
      force: Boolean(force),
      by: req.user.name || req.user.username,
    });
    res.json(result);
  });

  app.post('/api/staff/checkin/undo', staff, (req, res) => {
    res.json({ invitation: store.undoCheckIn(db, req.body?.guestId) });
  });

  // ---------- admin ----------
  app.post('/api/admin/invitations', admin, (req, res) => {
    const inv = store.createInvitation(db, req.body || {}, { source: req.body?.confirm ? 'admin' : 'invite' });
    res.status(201).json({ invitation: inv });
  });

  // Skupni unos: jedan uzvanik po retku "Ime Prezime; Organizacija; Grupa; e-mail".
  app.post('/api/admin/invitations/bulk', admin, (req, res) => {
    const lines = String(req.body?.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new AppError(400, 'validation', 'Upišite barem jednog uzvanika.');
    if (lines.length > 2000) throw new AppError(400, 'validation', 'Najviše 2000 redaka odjednom.');
    const created = [];
    const errors = [];
    lines.forEach((line, i) => {
      const [name = '', organization = '', groupName = '', email = ''] = line.split(/[;\t]/).map((p) => p.trim());
      const parts = name.split(/\s+/).filter(Boolean);
      const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
      const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
      try {
        created.push(
          store.createInvitation(
            db,
            { firstName, lastName, organization, groupName: groupName || req.body?.groupName, email, maxCompanions: req.body?.maxCompanions, confirm: Boolean(req.body?.confirm) },
            { source: req.body?.confirm ? 'admin' : 'invite' },
          ),
        );
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        errors.push({ line: i + 1, text: line, message: err.message });
      }
    });
    res.status(created.length ? 201 : 400).json({ created, errors });
  });

  app.put('/api/admin/invitations/:id', admin, (req, res) => {
    res.json({ invitation: store.updateInvitation(db, req.params.id, req.body || {}) });
  });

  app.delete('/api/admin/invitations/:id', admin, (req, res) => {
    store.deleteInvitation(db, req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/admin/qr/:id.png', admin, wrap(async (req, res) => {
    const inv = store.getInvitationById(db, req.params.id);
    if (!inv) throw new AppError(404, 'not_found', 'Uzvanik nije pronađen.');
    res.set('Content-Type', 'image/png').send(await QRCode.toBuffer(inv.qrCode, { errorCorrectionLevel: 'M', margin: 3, width: 800 }));
  }));

  app.get('/api/admin/export.:format', admin, wrap(async (req, res) => {
    const filter = String(req.query.filter || 'all');
    if (!(filter in FILTERS)) throw new AppError(400, 'validation', 'Nepoznat filter.');
    const list = store.listInvitations(db);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `zlatna-kuna-31-${filter.replace('_', '-')}-${stamp}`;
    if (req.params.format === 'xlsx') {
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${base}.xlsx"`,
      }).send(await buildXlsx(list, filter));
    } else if (req.params.format === 'pdf') {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${base}.pdf"` }).send(await buildPdf(list, filter));
    } else {
      throw new AppError(400, 'validation', 'Podržani formati su pdf i xlsx.');
    }
  }));

  app.get('/api/admin/users', admin, (req, res) => res.json({ users: store.listUsers(db) }));
  app.post('/api/admin/users', admin, (req, res) => res.status(201).json({ user: store.createUser(db, req.body || {}) }));
  app.delete('/api/admin/users/:id', admin, (req, res) => {
    store.deleteUser(db, req.params.id, req.user.id);
    res.json({ ok: true });
  });

  app.get('/api/admin/settings', admin, (req, res) => res.json({ settings: store.getSettings(db) }));
  app.put('/api/admin/settings', admin, (req, res) => res.json({ settings: store.updateSettings(db, req.body || {}) }));

  // ---------- greške ----------
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'Nepostojeća ruta.' }));
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Neispravan zahtjev.' });
    console.error(err);
    res.status(500).json({ error: 'server_error', message: 'Došlo je do greške na poslužitelju.' });
  });

  return app;
}
