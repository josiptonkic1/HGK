// Android aplikacija "31. Zlatna kuna" - radi potpuno na mobitelu, bez poslužitelja.
// QR kod pozivnice sam nosi ime, prezime i pratnju; dolasci se spremaju u lokalnu bazu.
import * as db from './db.js';
import * as auth from './auth.js';
import { buildXlsx, buildPdf, shareFile, shareText, fmtDate } from './export.js';

const TITLE = '31. Zlatna kuna';
export const INVITE_URL = 'https://josiptonkic1.github.io/HGK/';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tf = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' });
const fmtTime = (iso) => (iso ? tf.format(new Date(iso)) : '');
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const persons = (r) => 1 + (r.companions?.length || 0);

let records = [];
let admin = false;

function toast(msg, error = false) {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = Object.assign(document.createElement('div'), { className: 'toast-wrap' });
    document.body.append(wrap);
  }
  const el = Object.assign(document.createElement('div'), { className: `toast${error ? ' err' : ''}`, textContent: msg });
  wrap.append(el);
  setTimeout(() => el.remove(), 3500);
}

async function reload() {
  records = await db.all();
  renderLog();
  renderStats();
  renderList();
}

// ---------- tabovi ----------
function selectTab(name) {
  $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  if (name !== 'scan') stopCamera();
}

// ---------- modal ----------
function closeModal() {
  $('#modal-root').innerHTML = '';
  resumeCamera();
}
function openModal(html) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const m = $('.modal');
  $$('[data-close]', m).forEach((b) => b.addEventListener('click', closeModal));
  return m;
}

const peopleHtml = (r) =>
  `<ul class="person-list"><li><strong>${esc(r.fullName)}</strong></li>${(r.companions || []).map((c) => `<li class="comp">${esc(c.fullName)} – pratnja</li>`).join('')}</ul>`;

function banner(kind, title, r) {
  const icon = { ok: '✓', warn: '!', err: '✕' }[kind];
  const comps = r?.companions?.length ? r.companions.map((c) => `${esc(c.fullName)} – pratnja`).join('<br>') : r ? 'bez pratnje' : '';
  return `<div class="scan-ok ${kind === 'ok' ? '' : `scan-${kind}`}" role="status">
    <div class="scan-ok-icon" aria-hidden="true">${icon}</div>
    <div><div class="scan-ok-title">${esc(title)}</div>
      ${r ? `<div class="scan-ok-name">${esc(r.fullName)}</div><div class="scan-ok-comp">${comps}</div>` : ''}</div></div>`;
}

// "Odustani" -> ručni pregled popisa
function goToList(prefill = '') {
  closeModal();
  selectTab('list');
  $('#search').value = prefill;
  renderList();
  $('#search').focus();
}

// ---------- skeniranje ----------
async function handleCode(text) {
  pauseCamera();
  let guest;
  try {
    guest = ZKQR.decode(text);
  } catch (err) {
    navigator.vibrate?.([60, 60, 60]);
    openModal(`${banner('err', 'QR kod nije prepoznat')}<p>${esc(err.message)}</p>
      <div class="actions"><button class="btn btn-gold btn-block" data-close>U redu</button>
      <button class="btn btn-outline btn-block" id="m-list">Ručni pregled popisa</button></div>`);
    $('#m-list').addEventListener('click', () => goToList());
    return;
  }
  navigator.vibrate?.(80);
  const matches = await db.findByName(guest.fullName);
  const done = matches.find((m) => m.arrivedAt);
  if (done) {
    const m = openModal(`${banner('warn', `Pozivnica je već preuzeta u ${fmtTime(done.arrivedAt)}`, done)}
      <p class="hint">Ulaznice su već predane ovoj osobi.</p>
      <div class="actions"><button class="btn btn-gold btn-block" data-close>Zatvori</button>
      <button class="btn btn-outline btn-block" id="m-again">Ipak spremi kao novi dolazak</button></div>`);
    $('#m-again', m).addEventListener('click', () => confirmArrival(guest, null));
    return;
  }
  confirmArrival(guest, matches[0] || null);
}

function confirmArrival(guest, existing) {
  const hasList = records.some((r) => r.invited);
  const onList = existing?.invited;
  const m = openModal(`${banner('ok', 'QR kod uspješno skeniran', guest)}
    ${hasList ? (onList ? '<div class="alert alert-ok">Osoba je na popisu pozvanih.</div>' : '<div class="alert alert-warn"><strong>Osoba nije na popisu pozvanih.</strong> Provjerite prije predaje ulaznica.</div>') : ''}
    <div class="actions">
      <button class="btn btn-ok btn-lg btn-block" id="m-ok">Preuzeo pozivnicu</button>
      <button class="btn btn-outline btn-block" id="m-cancel">Odustani</button>
    </div>`);
  $('#m-cancel', m).addEventListener('click', () => goToList(guest.lastName));
  $('#m-ok', m).addEventListener('click', async () => {
    $('#m-ok', m).disabled = true;
    const rec = await db.save({
      ...(existing || {}),
      firstName: guest.firstName,
      lastName: guest.lastName,
      companions: guest.companions,
      invited: Boolean(existing?.invited),
      source: 'qr',
      qrIssuedAt: guest.issuedAt,
      arrivedAt: new Date().toISOString(),
    });
    await reload();
    showSaved(rec);
  });
}

function showSaved(rec) {
  const n = persons(rec);
  openModal(`<div class="big-result"><div class="icon" style="color:var(--ok)">✓</div>
      <h3>Spremljeno</h3><p>Predajte <strong>${n} ${plural(n, 'ulaznicu', 'ulaznice', 'ulaznica')}</strong>:</p>${peopleHtml(rec)}</div>
    <div class="actions"><button class="btn btn-gold btn-lg btn-block" data-close>Gotovo – sljedeći gost</button></div>`);
}

let scanner = null;
let scanning = false;
let last = { code: '', at: 0 };

async function startCamera() {
  const err = $('#camera-error');
  err.hidden = true;
  try {
    scanner ??= new Html5Qrcode('reader', { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
      (text) => {
        if ($('.modal-backdrop')) return;
        const now = Date.now();
        if (text === last.code && now - last.at < 3000) return;
        last = { code: text, at: now };
        handleCode(text);
      },
      () => {},
    );
    scanning = true;
    $('#scanner-placeholder').hidden = true;
    $('#btn-camera').textContent = 'Zaustavi kameru';
  } catch (e) {
    err.textContent = `Kamera nije dostupna (${e?.message || e}). Dopustite aplikaciji pristup kameri u postavkama mobitela.`;
    err.hidden = false;
  }
}
async function stopCamera() {
  if (scanner && scanning) { try { await scanner.stop(); } catch { /* */ } }
  scanning = false;
  $('#scanner-placeholder').hidden = false;
  $('#btn-camera').textContent = 'Pokreni kameru';
}
function pauseCamera() { if (scanner && scanning) { try { scanner.pause(true); } catch { /* */ } } }
function resumeCamera() { if (scanner && scanning) { try { scanner.resume(); } catch { /* */ } } }

// ---------- prikaz ----------
function renderLog() {
  const arrived = records.filter((r) => r.arrivedAt).sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
  const n = arrived.reduce((a, r) => a + persons(r), 0);
  $('#log-count').textContent = `Preuzeto ${arrived.length} ${plural(arrived.length, 'pozivnica', 'pozivnice', 'pozivnica')} · ${n} ${plural(n, 'osoba', 'osobe', 'osoba')}`;
  $('#log').innerHTML = arrived.length
    ? arrived.slice(0, 15).map((r) => `<li><span><strong>${esc(r.fullName)}</strong>${r.companions.length ? `<br><span class="c">${r.companions.map((c) => esc(c.fullName) + ' – pratnja').join('<br>')}</span>` : ''}</span><span class="t">${fmtTime(r.arrivedAt)}</span></li>`).join('')
    : '<li class="empty">Još nitko nije preuzeo pozivnicu.</li>';
}

function renderStats() {
  const arrived = records.filter((r) => r.arrivedAt);
  const invited = records.filter((r) => r.invited);
  const cards = [
    [arrived.reduce((a, r) => a + persons(r), 0), 'Došlo osoba'],
    [arrived.length, 'Preuzetih pozivnica'],
    [invited.length, 'Na popisu pozvanih'],
    [invited.filter((r) => !r.arrivedAt).length, 'Pozvani, nisu došli'],
  ];
  $('#stats').innerHTML = cards.map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
}

function renderList() {
  const words = db.nameKey($('#search').value).split(' ').filter(Boolean);
  const f = $('#filter').value;
  const rows = records
    .filter((r) => (f === 'arrived' ? r.arrivedAt : f === 'missing' ? r.invited && !r.arrivedAt : true))
    .filter((r) => {
      const hay = db.nameKey([r.fullName, ...r.companions.map((c) => c.fullName)].join(' '));
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => a.lastName.localeCompare(b.lastName, 'hr') || a.firstName.localeCompare(b.firstName, 'hr'));
  $('#list-count').textContent = `Prikazano: ${rows.length}`;
  $('#list').innerHTML = rows.length
    ? rows.map((r) => `<li><button type="button" data-id="${r.id}">
        <span><strong>${esc(r.fullName)}</strong>${r.companions.length ? `<span class="sub"><br>${r.companions.map((c) => esc(c.fullName) + ' – pratnja').join('<br>')}</span>` : ''}</span>
        <span>${r.arrivedAt ? `<span class="badge badge-confirmed">Došao ${fmtTime(r.arrivedAt)}</span>` : '<span class="badge badge-pending">Nije došao</span>'}</span>
      </button></li>`).join('')
    : `<li class="empty">${records.length ? 'Nitko nije pronađen.' : 'Popis je prazan.'} Za osobu bez QR koda koristite „Ručni unos dolaska”.</li>`;
}

function openRecord(r) {
  const m = openModal(`<div class="modal-head"><h2>${esc(r.fullName)}</h2><button class="btn btn-outline btn-icon" data-close aria-label="Zatvori">✕</button></div>
    ${r.arrivedAt ? `<div class="alert alert-info">Pozivnica preuzeta: <strong>${fmtDate(r.arrivedAt)}</strong></div>` : r.invited ? '<div class="alert alert-ok">Na popisu pozvanih.</div>' : ''}
    ${peopleHtml(r)}
    <div class="actions">
      ${r.arrivedAt ? '' : '<button class="btn btn-ok btn-lg btn-block" id="m-arrive">Preuzeo pozivnicu</button>'}
      ${admin && r.arrivedAt ? '<button class="btn btn-outline btn-block" id="m-undo">Poništi dolazak</button>' : ''}
      ${admin ? '<button class="btn btn-danger btn-block" id="m-del">Obriši</button>' : ''}
      <button class="btn btn-outline btn-block" data-close>${r.arrivedAt ? 'Zatvori' : 'Odustani'}</button>
    </div>`);
  $('#m-arrive', m)?.addEventListener('click', async () => {
    const rec = await db.save({ ...r, arrivedAt: new Date().toISOString(), source: r.source || 'rucno' });
    await reload();
    showSaved(rec);
  });
  $('#m-undo', m)?.addEventListener('click', async () => {
    if (!confirm('Poništiti preuzimanje pozivnice?')) return;
    await db.save({ ...r, arrivedAt: null });
    await reload();
    closeModal();
  });
  $('#m-del', m)?.addEventListener('click', async () => {
    if (!confirm(`Obrisati ${r.fullName}?`)) return;
    await db.remove(r.id);
    await reload();
    closeModal();
  });
}

function manualEntry() {
  const m = openModal(`<div class="modal-head"><h2>Ručni unos dolaska</h2><button class="btn btn-outline btn-icon" data-close aria-label="Zatvori">✕</button></div>
    <form id="manual" novalidate>
      <div id="m-err" class="alert alert-err" hidden></div>
      <div class="row">
        <div class="field"><label for="m-first">Ime</label><input type="text" id="m-first" maxlength="80"></div>
        <div class="field"><label for="m-last">Prezime</label><input type="text" id="m-last" maxlength="80"></div>
      </div>
      <div class="companions"><div class="companions-head"><span class="label">Pratnja</span></div><div id="m-comps"></div>
        <button type="button" class="btn btn-outline btn-sm" id="m-add">+ Dodaj pratnju</button></div>
      <div class="actions"><button class="btn btn-ok btn-lg btn-block" type="submit">Spremi i potvrdi dolazak</button>
        <button class="btn btn-outline btn-block" type="button" data-close>Odustani</button></div>
    </form>`);
  const comps = $('#m-comps', m);
  $('#m-add', m).addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'companion-row';
    row.innerHTML = `<input type="text" class="c-first" placeholder="Ime" maxlength="80"><input type="text" class="c-last" placeholder="Prezime" maxlength="80">
      <button type="button" class="btn btn-outline btn-icon" aria-label="Ukloni">✕</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    comps.append(row);
    row.querySelector('input').focus();
  });
  $('#manual', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#m-err', m);
    const firstName = $('#m-first', m).value.replace(/\s+/g, ' ').trim();
    const lastName = $('#m-last', m).value.replace(/\s+/g, ' ').trim();
    const companions = $$('.companion-row', comps).map((row) => ({
      firstName: row.querySelector('.c-first').value.replace(/\s+/g, ' ').trim(),
      lastName: row.querySelector('.c-last').value.replace(/\s+/g, ' ').trim(),
    })).filter((c) => c.firstName || c.lastName);
    if (!firstName || !lastName) { err.textContent = 'Upišite ime i prezime.'; err.hidden = false; return; }
    if (companions.some((c) => !c.firstName || !c.lastName)) { err.textContent = 'Upišite ime i prezime za svaku osobu u pratnji.'; err.hidden = false; return; }
    const existing = (await db.findByName(`${firstName} ${lastName}`)).find((x) => !x.arrivedAt);
    const rec = await db.save({ ...(existing || {}), firstName, lastName, companions, invited: Boolean(existing?.invited), source: 'rucno', arrivedAt: new Date().toISOString() });
    await reload();
    showSaved(rec);
  });
  $('#m-first', m).focus();
}

// ---------- prijava ----------
const showError = (el, msg) => { el.textContent = msg; el.hidden = !msg; };

function showAuth() {
  stopCamera();
  closeModal();
  $('#app').hidden = true;
  $('#auth').hidden = false;
  const setup = !auth.isSetUp();
  $('#setup-form').hidden = !setup;
  $('#login-form').hidden = setup;
  showError($('#setup-error'), '');
  showError($('#login-error'), '');
  (setup ? $('#s-admin') : $('#l-user')).focus();
}

function startApp(role) {
  admin = role === 'admin';
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#role-badge').textContent = auth.ROLES[role];
  $('#tab-admin').hidden = !admin;
  $('#invite-link').textContent = INVITE_URL;
  selectTab('scan');
  reload();
}

async function submitSetup(e) {
  e.preventDefault();
  const err = $('#setup-error');
  const a = $('#s-admin').value;
  const m = $('#s-mod').value;
  if (a !== $('#s-admin2').value) return showError(err, 'Lozinke za admina se ne podudaraju.');
  if (m !== $('#s-mod2').value) return showError(err, 'Lozinke za moderatora se ne podudaraju.');
  try {
    await auth.setup(a, m);
  } catch (ex) {
    return showError(err, ex.message);
  }
  $$('#setup-form input').forEach((i) => (i.value = ''));
  toast('Lozinke su spremljene. Prijavite se.');
  showAuth();
  $('#l-user').value = 'admin';
  $('#l-pass').focus();
}

async function submitLogin(e) {
  e.preventDefault();
  const role = await auth.login($('#l-user').value, $('#l-pass').value);
  if (!role) return showError($('#login-error'), 'Pogrešno korisničko ime ili lozinka.');
  $('#l-pass').value = '';
  startApp(role);
}

async function submitPassword(e) {
  e.preventDefault();
  const err = $('#pw-error');
  const pw = $('#pw-new').value;
  if (pw !== $('#pw-new2').value) return showError(err, 'Lozinke se ne podudaraju.');
  try {
    await auth.changePassword($('#pw-role').value, pw);
  } catch (ex) {
    return showError(err, ex.message);
  }
  showError(err, '');
  $('#pw-new').value = '';
  $('#pw-new2').value = '';
  toast(`Lozinka za ${$('#pw-role').value} je promijenjena.`);
}

// ---------- admin ----------

async function addInvited(e) {
  e.preventDefault();
  const lines = $('#invited-text').value.split(/\r?\n/).map((l) => l.split(/[;\t]/)[0].replace(/\s+/g, ' ').trim()).filter(Boolean);
  let added = 0;
  let skipped = 0;
  const bad = [];
  for (const line of lines) {
    const parts = line.split(' ');
    if (parts.length < 2) { bad.push(line); continue; }
    const firstName = parts.slice(0, -1).join(' ');
    const lastName = parts[parts.length - 1];
    const existing = await db.findByName(line);
    if (existing.length) {
      if (!existing[0].invited) await db.save({ ...existing[0], invited: true });
      skipped++;
      continue;
    }
    await db.save({ firstName, lastName, companions: [], invited: true, source: 'popis', arrivedAt: null });
    added++;
  }
  await reload();
  $('#invited-text').value = bad.join('\n');
  $('#invited-result').innerHTML = `<div class="alert ${bad.length ? 'alert-warn' : 'alert-ok'}">Dodano: <strong>${added}</strong>${skipped ? `, već na popisu: ${skipped}` : ''}${bad.length ? `<br>Nedostaje prezime (ostavljeno u polju): ${bad.map(esc).join(', ')}` : ''}</div>`;
}

async function doExport(kind) {
  if (!records.length) return toast('Popis je prazan.', true);
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    if (kind === 'xlsx') {
      await shareFile(await buildXlsx(records, TITLE), `zlatna-kuna-31-${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      await shareFile(await buildPdf(records, TITLE), `zlatna-kuna-31-${stamp}.pdf`, 'application/pdf');
    }
  } catch (err) {
    if (!/cancel/i.test(err?.message || '')) toast(`Izvoz nije uspio: ${err?.message || err}`, true);
  }
}

// ---------- pokretanje ----------
function init() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) selectTab(b.dataset.tab);
  });
  $('#btn-camera').addEventListener('click', () => (scanning ? stopCamera() : startCamera()));
  $('#scan-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      await stopCamera();
      scanner ??= new Html5Qrcode('reader', { verbose: false });
      handleCode(await scanner.scanFile(file, false));
    } catch {
      toast('Na slici nije pronađen QR kod.', true);
    }
  });
  $('#search').addEventListener('input', renderList);
  $('#filter').addEventListener('change', renderList);
  $('#list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    const r = b && records.find((x) => x.id === Number(b.dataset.id));
    if (r) openRecord(r);
  });
  $('#btn-manual').addEventListener('click', manualEntry);

  $('#setup-form').addEventListener('submit', submitSetup);
  $('#login-form').addEventListener('submit', submitLogin);
  $('#password-form').addEventListener('submit', submitPassword);
  $('#btn-logout').addEventListener('click', () => { auth.logout(); admin = false; showAuth(); });
  $('#invited-form').addEventListener('submit', addInvited);
  $('#btn-share-link').addEventListener('click', () => shareText(`Pozivnica za ${TITLE}: ${INVITE_URL}`, 'Link pozivnice').catch(() => {}));
  $('#btn-xlsx').addEventListener('click', () => doExport('xlsx'));
  $('#btn-pdf').addEventListener('click', () => doExport('pdf'));
  $('#btn-wipe').addEventListener('click', async () => {
    if (!confirm('Obrisati SVE podatke (dolaske i popis pozvanih)? Prije toga napravite izvoz u Excel.')) return;
    if (!confirm('Jeste li sigurni? Ovo se ne može poništiti.')) return;
    await db.clear();
    await reload();
    toast('Svi podaci su obrisani.');
  });

  // Androidova tipka "natrag" zatvara prozor umjesto izlaska iz aplikacije.
  document.addEventListener('backbutton', () => { if ($('.modal-backdrop')) closeModal(); });

  window.zk = { handleCode, reload }; // za testiranje

  // Web verzija: offline rad i instalacija na početni zaslon (u Android aplikaciji nije potrebno).
  if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.()) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const role = auth.current();
  if (role) startApp(role);
  else showAuth();
}

init();
