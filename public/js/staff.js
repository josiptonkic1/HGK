import { $, $$, api, esc, logoHtml, fmtDateTime, fmtTime, normalize, toast, copyText, companionEditor, companionLabel, setupInstallButton, inMobileApp } from './common.js';

if (!inMobileApp) setupInstallButton(document.getElementById('btn-install')); // u Android aplikaciji je već "instalirano"

let user;
let invitations = [];
let stats = {};
const isAdmin = () => user?.role === 'admin';

const STATUS = {
  confirmed: { label: 'Dolazi', cls: 'badge-confirmed' },
  declined: { label: 'Ne dolazi', cls: 'badge-declined' },
  pending: { label: 'Nije odgovorio', cls: 'badge-pending' },
};
const badge = (status) => `<span class="badge ${STATUS[status].cls}">${STATUS[status].label}</span>`;
// Hrvatska množina: 1 pozivnica, 2-4 pozivnice, 5+ pozivnica (11-14 kao 5+).
const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const inviteLink = (inv) => `${location.origin}/p/${inv.token}`;

// ---------- učitavanje ----------

async function loadList({ silent = false } = {}) {
  try {
    const data = await api('/api/staff/invitations');
    invitations = data.invitations;
    stats = data.stats;
    renderStats();
    renderList();
    renderScanResults();
    renderCheckinLog();
  } catch (err) {
    if (err.status === 401) return location.replace('/prijava');
    if (!silent) toast(err.message, { error: true });
  }
}

function replaceInvitation(inv) {
  const i = invitations.findIndex((x) => x.id === inv.id);
  if (i >= 0) invitations[i] = inv;
  else invitations.push(inv);
  loadList({ silent: true }); // osvježi statistiku
}

// ---------- tabovi ----------

function selectTab(name) {
  for (const b of $$('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== name;
  if (name !== 'scan') stopCamera();
  if (name === 'settings') loadSettings();
  if (name === 'mail') loadMail();
  try { sessionStorage.setItem('zk_tab', name); } catch { /* */ }
}

// ---------- pretraga ----------

function searchText(inv) {
  return normalize([inv.fullName, inv.email, ...inv.guests.map((g) => g.fullName)].join(' '));
}

function matches(inv, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = searchText(inv);
  return words.every((w) => hay.includes(w));
}

// ---------- statistika i popis ----------

function renderStats() {
  const s = stats;
  const cards = [
    // Pozivnice u bazi: admin ih dodaje ili ih stvara prijava preko općeg linka.
    ['all', s.invitations, 'Pozivnica u bazi', `${invitations.filter((i) => i.source !== 'open').length} dodao admin · ${invitations.filter((i) => i.source === 'open').length} preko općeg linka`],
    ['confirmed', s.confirmedPersons, 'Dolazi osoba', `${s.confirmedInvitations} pozivnica, ${s.companions} pratnje`],
    ['declined', s.declinedInvitations, 'Ne dolazi', 'pozivnica'],
    ['pending', s.pendingInvitations, 'Nisu odgovorili', 'pozivnica'],
    ['checked_in', s.checkedInPersons, 'Došlo osoba', `od ${s.confirmedPersons} potvrđenih`],
  ];
  const current = $('#list-filter').value;
  $('#stats').innerHTML = cards
    .map(([f, v, l, sub]) => `<button type="button" class="stat" data-filter="${f}" aria-pressed="${f === current}"><div class="v">${v ?? 0}</div><div class="l">${l}</div><div class="s">${esc(sub)}</div></button>`)
    .join('');
}

function filtered() {
  const f = $('#list-filter').value;
  const q = $('#list-search').value;
  return invitations.filter((inv) => {
    if (f === 'checked_in' && !inv.checkedInCount) return false;
    if (f === 'not_arrived' && !(inv.status === 'confirmed' && inv.checkedInCount < inv.personCount)) return false;
    if (['confirmed', 'declined', 'pending'].includes(f) && inv.status !== f) return false;
    return matches(inv, q);
  });
}

function renderList() {
  const rows = filtered();
  const persons = rows.reduce((a, i) => a + i.personCount, 0);
  $('#list-count').textContent = `Prikazano: ${rows.length} ${plural(rows.length, 'pozivnica', 'pozivnice', 'pozivnica')} · ${persons} ${plural(persons, 'osoba', 'osobe', 'osoba')}`;
  if (!rows.length) {
    $('#list-body').innerHTML = `<tr><td colspan="4" class="empty">Nema uzvanika za odabrani prikaz.</td></tr>`;
    return;
  }
  $('#list-body').innerHTML = rows
    .map((inv) => {
      const primary = inv.guests.find((g) => !g.isCompanion);
      const comps = inv.guests.filter((g) => g.isCompanion);
      const dot = (g) => (g?.checkedInAt ? ` <span class="checked-dot" title="Došao ${fmtTime(g.checkedInAt)}">✓</span>` : '');
      return `<tr data-id="${inv.id}">
        <td><div class="main-name">${esc(inv.fullName)}${dot(primary)}</div>
          ${comps.map((c) => `<div class="comp-name">${esc(companionLabel(c.fullName))}${dot(c)}</div>`).join('')}
          ${isAdmin() ? mailLine(inv) : ''}</td>
        <td>${badge(inv.status)}</td>
        <td>${inv.status === 'confirmed' ? `${inv.checkedInCount}/${inv.personCount}` : '—'}</td>
        <td><div class="row-actions">
          <button class="btn btn-outline btn-sm" data-act="open">${inv.status === 'confirmed' && inv.checkedInCount < inv.personCount ? 'Preuzimanje' : 'Otvori'}</button>
          ${isAdmin() ? `<button class="btn btn-outline btn-sm" data-act="edit">Uredi</button>
            <button class="btn btn-ghost btn-sm" data-act="link" title="Kopiraj osobni link pozivnice">Link</button>
            ${inv.email && inv.status !== 'declined' ? `<button class="btn btn-ghost btn-sm" data-act="mail" title="${inv.status === 'confirmed' ? 'Pošalji QR kod e-mailom' : 'Pošalji pozivnicu e-mailom'}">${inv.status === 'confirmed' ? 'Pošalji QR' : 'Pošalji'}</button>` : ''}
            <button class="btn btn-danger btn-sm" data-act="delete">Obriši</button>` : ''}
        </div></td>
      </tr>`;
    })
    .join('');
}

// ---------- modal ----------

function closeModal() {
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
  resumeCamera();
}

function openModal(html) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.style.overflow = 'hidden';
  const backdrop = $('.modal-backdrop');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', closeModal));
  return $('.modal', backdrop);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('.modal-backdrop')) closeModal();
});

// "Odustani" vraća moderatora na ručni pregled popisa uzvanika.
function goToManualList() {
  closeModal();
  selectTab('list');
  const s = $('#list-search');
  s.focus();
  s.select();
}

// Kartica uzvanika: provjera i potvrda preuzimanja pozivnice.
// fromScan = otvoreno nakon skeniranja QR koda.
function openParty(inv, { fromScan = false } = {}) {
  const pending = inv.guests.filter((g) => !g.checkedInAt);
  const allIn = inv.status === 'confirmed' && inv.guests.length > 0 && pending.length === 0;
  let banner;
  if (inv.status === 'declined') banner = `<div class="alert alert-err"><strong>Uzvanik je otkazao dolazak.</strong> Provjerite osobu prije predaje ulaznica.</div>`;
  else if (inv.status === 'pending') banner = `<div class="alert alert-warn"><strong>Uzvanik nije potvrdio dolazak.</strong> Možete ga svejedno evidentirati.</div>`;
  else if (allIn) {
    const last = inv.guests.map((g) => g.checkedInAt).sort().pop();
    banner = `<div class="alert alert-info"><strong>Pozivnica je već preuzeta</strong> (${fmtDateTime(last)}). Ulaznice su već predane.</div>`;
  } else banner = `<div class="alert alert-ok"><strong>Dolazak potvrđen.</strong> Provjerite osobe i predajte ulaznice.</div>`;

  const people = inv.guests.length ? inv.guests : [{ id: null, fullName: inv.fullName, isCompanion: false }];
  const comps = people.filter((g) => g.isCompanion);
  const scanHead = fromScan
    ? `<div class="scan-ok" role="status">
        <div class="scan-ok-icon" aria-hidden="true">✓</div>
        <div><div class="scan-ok-title">QR kod uspješno skeniran</div>
          <div class="scan-ok-name">${esc(inv.fullName)}</div>
          <div class="scan-ok-comp">${comps.length ? comps.map((c) => esc(companionLabel(c.fullName))).join('<br>') : 'bez pratnje'}</div></div>
      </div>`
    : '';
  const modal = openModal(`
    ${scanHead}
    <div class="modal-head"><h2>${esc(inv.fullName)}</h2><button class="btn btn-outline btn-icon" data-close aria-label="Zatvori">✕</button></div>
    <div class="meta">${badge(inv.status)}</div>
    ${banner}
    <ul class="guest-checks">
      ${people.map((g) => `<li class="${g.checkedInAt ? 'done' : ''}">
        <label class="check">${g.checkedInAt || !g.id ? '' : `<input type="checkbox" data-guest="${g.id}" checked>`}
          <span>${g.isCompanion ? esc(companionLabel(g.fullName)) : `<strong>${esc(g.fullName)}</strong>`}
          ${g.checkedInAt ? `<br><span class="when">✓ Došao ${fmtTime(g.checkedInAt)}${g.checkedInBy ? ` · ${esc(g.checkedInBy)}` : ''}</span>` : ''}</span></label>
        ${g.checkedInAt ? `<button class="btn btn-ghost btn-sm" data-undo="${g.id}">Poništi</button>` : ''}
      </li>`).join('')}
    </ul>
    <div class="actions">
      ${allIn ? '' : inv.status === 'confirmed'
        ? `<button class="btn btn-ok btn-lg btn-block" id="do-checkin">Preuzeo pozivnicu</button>`
        : `<button class="btn btn-gold btn-lg btn-block" id="do-checkin" data-force="1">Svejedno potvrdi – preuzeo pozivnicu</button>`}
      <button class="btn btn-outline btn-block" id="do-cancel">${allIn ? 'Zatvori' : 'Odustani'}</button>
    </div>`);

  $('#do-cancel', modal).addEventListener('click', () => (allIn ? closeModal() : goToManualList()));

  const btn = $('#do-checkin', modal);
  const updateCount = () => {
    if (!btn || inv.status !== 'confirmed') return;
    const n = $$('[data-guest]:checked', modal).length;
    btn.disabled = n === 0;
    btn.textContent = n === people.length ? 'Preuzeo pozivnicu' : `Preuzeo pozivnicu (${n} od ${people.length})`;
  };
  $$('[data-guest]', modal).forEach((c) => c.addEventListener('change', updateCount));
  updateCount();

  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const guestIds = $$('[data-guest]:checked', modal).map((c) => Number(c.dataset.guest));
      const force = Boolean(btn.dataset.force);
      if (force && !confirm(`${inv.fullName} nije potvrdio/la dolazak. Svejedno evidentirati dolazak?`)) {
        btn.disabled = false;
        return;
      }
      const res = await api('/api/staff/checkin', { method: 'POST', body: { invitationId: inv.id, guestIds: force ? [] : guestIds, force } });
      replaceInvitation(res.invitation);
      showCheckinResult(res);
    } catch (err) {
      toast(err.message, { error: true });
      btn.disabled = false;
    }
  });

  $$('[data-undo]', modal).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Poništiti evidentirani dolazak za ovu osobu?')) return;
      try {
        const res = await api('/api/staff/checkin/undo', { method: 'POST', body: { guestId: Number(b.dataset.undo) } });
        replaceInvitation(res.invitation);
        openParty(res.invitation);
      } catch (err) {
        toast(err.message, { error: true });
      }
    }),
  );
}

function showCheckinResult({ invitation: inv, newlyCheckedIn }) {
  const names = inv.guests.filter((g) => newlyCheckedIn.includes(g.id));
  const n = names.length;
  openModal(`
    <div class="big-result">
      <div class="icon" style="color:var(--ok)">✓</div>
      <h3>Pozivnica preuzeta – spremljeno</h3>
      <p>Predajte <strong>${n} ${plural(n, 'ulaznicu', 'ulaznice', 'ulaznica')}</strong>:</p>
      <ul class="person-list">${names.map((g) => `<li>${g.isCompanion ? esc(companionLabel(g.fullName)) : `<strong>${esc(g.fullName)}</strong>`}</li>`).join('')}</ul>
    </div>
    <div class="actions"><button class="btn btn-gold btn-lg btn-block" data-close>Gotovo – sljedeći gost</button></div>`);
}

// Tablica preuzetih pozivnica (najnovije gore).
function renderCheckinLog() {
  const rows = [];
  for (const inv of invitations) {
    for (const g of inv.guests) {
      if (g.checkedInAt) rows.push({ inv, g });
    }
  }
  rows.sort((a, b) => b.g.checkedInAt.localeCompare(a.g.checkedInAt) || a.g.isCompanion - b.g.isCompanion);
  const total = invitations.filter((i) => i.status === 'confirmed').reduce((a, i) => a + i.personCount, 0);
  $('#log-count').textContent = `Preuzelo: ${rows.length} od ${total} ${plural(total, 'potvrđene osobe', 'potvrđene osobe', 'potvrđenih osoba')}`;
  $('#log-body').innerHTML = rows.length
    ? rows
        .slice(0, 200)
        .map(({ inv, g }) => `<tr>
          <td>${fmtTime(g.checkedInAt)}</td>
          <td>${g.isCompanion ? esc(companionLabel(g.fullName)) : `<strong>${esc(g.fullName)}</strong>`}</td>
          <td>${g.isCompanion ? esc(inv.fullName) : '<span class="hint">—</span>'}</td>
          <td>${esc(g.checkedInBy || '')}</td>
        </tr>`)
        .join('')
    : `<tr><td colspan="4" class="empty">Još nitko nije preuzeo pozivnicu.</td></tr>`;
}

// ---------- skeniranje ----------

let scanner = null;
let scanning = false;
let lastCode = '';
let lastAt = 0;

async function handleCode(code) {
  const now = Date.now();
  if (code === lastCode && now - lastAt < 3000) return;
  lastCode = code;
  lastAt = now;
  pauseCamera();
  try {
    const { invitation } = await api('/api/staff/scan', { method: 'POST', body: { code } });
    navigator.vibrate?.(80);
    openParty(invitation, { fromScan: true });
  } catch (err) {
    navigator.vibrate?.([60, 60, 60]);
    openModal(`
      <div class="big-result"><div class="icon" style="color:var(--err)">✕</div><h3>QR kod nije prepoznat</h3>
      <p class="hint">${esc(err.message)}</p></div>
      <div class="actions"><button class="btn btn-gold btn-block" data-close>U redu</button></div>`);
  }
}

async function startCamera() {
  const err = $('#camera-error');
  err.hidden = true;
  if (!window.Html5Qrcode) {
    err.textContent = 'Skener se nije učitao. Osvježite stranicu.';
    err.hidden = false;
    return;
  }
  try {
    scanner ??= new window.Html5Qrcode('reader', { verbose: false, formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE] });
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; } },
      (text) => handleCode(text),
      () => {},
    );
    scanning = true;
    $('#scanner-placeholder').hidden = true;
    $('#btn-camera').textContent = 'Zaustavi kameru';
  } catch (e) {
    err.innerHTML = `Kamera nije dostupna (${esc(e?.message || e)}). Dopustite pristup kameri u pregledniku – stranica mora biti otvorena preko HTTPS-a. U međuvremenu koristite pretragu po imenu.`;
    err.hidden = false;
  }
}

async function stopCamera() {
  if (scanner && scanning) {
    try { await scanner.stop(); } catch { /* */ }
  }
  scanning = false;
  $('#scanner-placeholder').hidden = false;
  $('#btn-camera').textContent = 'Pokreni kameru';
}

function pauseCamera() {
  if (scanner && scanning) { try { scanner.pause(true); } catch { /* */ } }
}
function resumeCamera() {
  if (scanner && scanning) { try { scanner.resume(); } catch { /* */ } }
}

function renderScanResults() {
  const q = $('#scan-search').value.trim();
  const box = $('#scan-results');
  if (q.length < 2) {
    box.innerHTML = '';
    $('#scan-search-hint').hidden = false;
    return;
  }
  $('#scan-search-hint').hidden = true;
  const found = invitations.filter((inv) => matches(inv, q)).slice(0, 12);
  box.innerHTML = found.length
    ? found
        .map((inv) => {
          const comp = inv.guests.filter((g) => g.isCompanion);
          const match = comp.find((c) => normalize(c.fullName).includes(normalize(q)));
          return `<li><button type="button" data-id="${inv.id}">
            <span><strong>${esc(inv.fullName)}</strong>
              <span class="sub">${match ? `<br>${esc(companionLabel(match.fullName))}` : comp.length ? `<br>+ ${comp.length} pratnja` : ''}</span></span>
            <span>${badge(inv.status)}${inv.checkedInCount ? `<br><span class="sub">došlo ${inv.checkedInCount}/${inv.personCount}</span>` : ''}</span>
          </button></li>`;
        })
        .join('')
    : `<li class="empty">Nitko nije pronađen.${isAdmin() ? ' Uzvanika možete dodati u kartici „Dodaj uzvanike”.' : ''}</li>`;
}

// ---------- admin: uređivanje ----------

function openEdit(inv) {
  const modal = openModal(`
    <div class="modal-head"><h2>Uredi uzvanika</h2><button class="btn btn-outline btn-icon" data-close aria-label="Zatvori">✕</button></div>
    <form id="edit-form" novalidate>
      <div id="edit-error" class="alert alert-err" hidden></div>
      <div class="row">
        <div class="field"><label for="e-first">Ime</label><input type="text" id="e-first" value="${esc(inv.firstName)}" maxlength="80"></div>
        <div class="field"><label for="e-last">Prezime</label><input type="text" id="e-last" value="${esc(inv.lastName)}" maxlength="80"></div>
      </div>
      <div class="row">
        <div class="field"><label for="e-email">E-mail</label><input type="email" id="e-email" value="${esc(inv.email)}" maxlength="160"></div>
        <div class="field"><label for="e-max">Najviše pratnje</label><input type="number" id="e-max" min="0" max="20" value="${inv.maxCompanions}"></div>
      </div>
      <div class="field"><label for="e-status">Status</label>
        <select id="e-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === inv.status ? ' selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="companions" id="e-comp-block">
        <div class="companions-head"><span class="label">Pratnja</span></div>
        <div id="e-companions"></div>
      </div>
      <div class="field" style="margin-top:14px"><label for="e-note">Napomena</label><input type="text" id="e-note" value="${esc(inv.note)}" maxlength="500"></div>
      <div class="field"><span class="label">Osobni link pozivnice</span>
        <div class="link-box"><span>${esc(inviteLink(inv))}</span><button type="button" class="btn btn-ghost btn-sm" id="e-copy">Kopiraj</button></div></div>
      ${inv.email ? `<div class="field"><span class="label">E-mail</span>
        <div class="hint">${mailHistory(inv)}</div>
        <div class="actions" style="margin-top:6px">
          ${inv.status === 'pending' ? `<button type="button" class="btn btn-outline btn-sm" data-send="invite">Pošalji pozivnicu</button>
            <button type="button" class="btn btn-outline btn-sm" data-send="reminder">Pošalji podsjetnik</button>` : ''}
          ${inv.status === 'confirmed' ? '<button type="button" class="btn btn-outline btn-sm" data-send="qr">Pošalji QR kod</button>' : ''}
        </div></div>` : '<p class="hint">Za slanje e-mailom upišite e-mail adresu i spremite.</p>'}
      ${inv.status === 'confirmed' ? `<p class="hint">QR kod: <a href="/api/admin/qr/${inv.id}.png" target="_blank" rel="noopener">otvori sliku</a> · ${esc(inv.qrCode)}</p>` : ''}
      <div class="actions"><button class="btn btn-gold" type="submit">Spremi</button><button class="btn btn-outline" type="button" data-close>Odustani</button></div>
    </form>`);
  const editor = companionEditor($('#e-companions', modal), {
    initial: inv.guests.filter((g) => g.isCompanion).map((g) => ({ id: g.id, firstName: g.firstName, lastName: g.lastName })),
  });
  const toggle = () => ($('#e-comp-block', modal).hidden = $('#e-status', modal).value !== 'confirmed');
  $('#e-status', modal).addEventListener('change', toggle);
  toggle();
  $('#e-copy', modal).addEventListener('click', () => copyText(inviteLink(inv)));
  $$('[data-send]', modal).forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      const updated = await sendOne(inv, b.dataset.send);
      b.disabled = false;
      if (updated) openEdit(updated); // osvježi prikaz povijesti slanja
    }),
  );
  $('#edit-form', modal).addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#edit-error', modal);
    errBox.hidden = true;
    try {
      const res = await api(`/api/admin/invitations/${inv.id}`, {
        method: 'PUT',
        body: {
          firstName: $('#e-first', modal).value,
          lastName: $('#e-last', modal).value,
          email: $('#e-email', modal).value,
          maxCompanions: $('#e-max', modal).value,
          status: $('#e-status', modal).value,
          note: $('#e-note', modal).value,
          companions: editor.values().filter((c) => c.firstName || c.lastName),
        },
      });
      replaceInvitation(res.invitation);
      closeModal();
      toast('Promjene su spremljene.');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    }
  });
}

async function deleteInv(inv) {
  if (!confirm(`Obrisati ${inv.fullName} s popisa uzvanika? Ova radnja se ne može poništiti.`)) return;
  try {
    await api(`/api/admin/invitations/${inv.id}`, { method: 'DELETE' });
    invitations = invitations.filter((i) => i.id !== inv.id);
    loadList({ silent: true });
    toast('Uzvanik je obrisan.');
  } catch (err) {
    toast(err.message, { error: true });
  }
}

// ---------- admin: dodavanje ----------

let addEditor;

function setupAdd() {
  addEditor = companionEditor($('#a-companions'));
  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#add-error');
    errBox.hidden = true;
    try {
      const res = await api('/api/admin/invitations', {
        method: 'POST',
        body: {
          firstName: $('#a-first').value,
          lastName: $('#a-last').value,
          email: $('#a-email').value,
          maxCompanions: $('#a-max').value,
          companions: addEditor.values().filter((c) => c.firstName || c.lastName),
          confirm: $('#a-confirm').checked,
        },
      });
      const inv = res.invitation;
      replaceInvitation(inv);
      $('#add-result').innerHTML = `<div class="alert alert-ok">Uzvanik <strong>${esc(inv.fullName)}</strong> dodan je na popis${inv.status === 'confirmed' ? ' s potvrđenim dolaskom' : ''}.
        <div class="link-box" style="margin-top:8px"><span>${esc(inviteLink(inv))}</span><button type="button" class="btn btn-ghost btn-sm" data-copy>Kopiraj link</button></div>
        ${inv.status === 'confirmed' ? `<div style="margin-top:8px"><a href="/api/admin/qr/${inv.id}.png" target="_blank" rel="noopener">Prikaži QR kod</a></div>` : ''}</div>`;
      $('#add-result [data-copy]').addEventListener('click', () => copyText(inviteLink(inv)));
      for (const id of ['a-first', 'a-last', 'a-email']) $(`#${id}`).value = '';
      addEditor.reset();
      $('#a-first').focus();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    }
  });

  $('#bulk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#bulk-result');
    try {
      const res = await api('/api/admin/invitations/bulk', {
        method: 'POST',
        body: { text: $('#b-text').value, maxCompanions: $('#b-max').value || undefined, confirm: $('#b-confirm').checked },
      });
      out.innerHTML = renderBulk(res);
      if (res.created.length) $('#b-text').value = res.errors.map((x) => x.text).join('\n');
      loadList({ silent: true });
    } catch (err) {
      out.innerHTML = err.status === 400 && err.message ? `<div class="alert alert-err">${esc(err.message)}</div>` : '';
      if (err.status !== 400) toast(err.message, { error: true });
    }
  });
}

const renderBulk = (res) =>
  `<div class="alert ${res.errors.length ? 'alert-warn' : 'alert-ok'}">Dodano: <strong>${res.created.length}</strong>${
    res.errors.length ? `<br>Neuspješno (ostavljeno u polju za ispravak):<ul>${res.errors.map((x) => `<li>${x.line}. redak – ${esc(x.message)}</li>`).join('')}</ul>` : ''
  }</div>`;

// ---------- admin: e-mail ----------

const MAIL_LABEL = { invite: 'Pozivnica', reminder: 'Podsjetnik', qr: 'QR kod' };

function mailHistory(inv) {
  const parts = [];
  if (inv.inviteSentAt) parts.push(`pozivnica ${fmtDateTime(inv.inviteSentAt)}`);
  if (inv.reminderSentAt) parts.push(`podsjetnik ${fmtDateTime(inv.reminderSentAt)}`);
  if (inv.qrSentAt) parts.push(`QR kod ${fmtDateTime(inv.qrSentAt)}`);
  return `${esc(inv.email)}${parts.length ? ` · poslano: ${parts.join(', ')}` : ' · ništa još nije poslano'}`;
}

function mailLine(inv) {
  if (!inv.email) return '<div class="hint">bez e-maila</div>';
  const sent = inv.qrSentAt ? '✉ QR poslan' : inv.reminderSentAt ? '✉ podsjetnik poslan' : inv.inviteSentAt ? '✉ pozivnica poslana' : '';
  return `<div class="hint">${esc(inv.email)}${sent ? ` · ${sent}` : ''}</div>`;
}

async function sendOne(inv, kind) {
  try {
    const res = await api(`/api/admin/invitations/${inv.id}/send`, { method: 'POST', body: { kind } });
    replaceInvitation(res.invitation);
    toast(`${MAIL_LABEL[kind]} poslan(a) na ${inv.email}.`);
    return res.invitation;
  } catch (err) {
    toast(err.message, { error: true, timeout: 6000 });
    return null;
  }
}

async function loadMail() {
  try {
    const [status, preview] = await Promise.all([api('/api/admin/mail'), api('/api/admin/mail/preview')]);
    $('#mail-actions').hidden = !status.enabled;
    $('#mail-state').innerHTML = status.enabled
      ? `<div class="alert alert-ok">Slanje e-maila je uključeno. Pošiljatelj: <strong>${esc(status.from)}</strong></div>`
      : `<div class="alert alert-warn"><strong>Slanje e-maila još nije podešeno.</strong> Na poslužitelju treba upisati SMTP postavke
          (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM) – npr. besplatni Brevo. Dok to nije podešeno, pozivnice se šalju kopiranjem linka.</div>`;
    const line = (p) => `Za slanje: <strong>${p.withEmail}</strong>${p.withoutEmail ? ` · bez e-maila: ${p.withoutEmail}` : ''}`;
    for (const kind of ['invite', 'reminder', 'qr']) {
      $(`#mail-count-${kind}`).innerHTML = line(preview[kind]);
      $(`[data-bulk="${kind}"]`).disabled = preview[kind].withEmail === 0;
    }
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function setupMail() {
  $$('[data-bulk]').forEach((b) =>
    b.addEventListener('click', async () => {
      const kind = b.dataset.bulk;
      const what = { invite: 'pozivnice', reminder: 'podsjetnike', qr: 'QR kodove' }[kind];
      if (!confirm(`Poslati ${what} e-mailom? To može potrajati nekoliko minuta.`)) return;
      $$('[data-bulk]').forEach((x) => (x.disabled = true));
      $('#mail-result').innerHTML = '<div class="alert alert-info">Slanje u tijeku… ne zatvarajte stranicu.</div>';
      try {
        const r = await api('/api/admin/mail/bulk', { method: 'POST', body: { kind } });
        $('#mail-result').innerHTML = `<div class="alert ${r.failed.length ? 'alert-warn' : 'alert-ok'}">
          Poslano: <strong>${r.sent}</strong>
          ${r.failed.length ? `<br>Nije poslano (${r.failed.length}):<ul>${r.failed.map((x) => `<li>${esc(x.name)} (${esc(x.email)}) – ${esc(x.message)}</li>`).join('')}</ul>` : ''}
          ${r.withoutEmail.length ? `<br>Bez e-maila (${r.withoutEmail.length}): ${r.withoutEmail.map(esc).join(', ')}` : ''}
          ${r.remaining ? `<br>Preostalo za sutra (dnevni limit): ${r.remaining}` : ''}</div>`;
        loadList({ silent: true });
      } catch (err) {
        $('#mail-result').innerHTML = `<div class="alert alert-err">${esc(err.message)}</div>`;
      }
      loadMail();
    }),
  );
  $('#mail-test-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/mail/test', { method: 'POST', body: { to: $('#mail-test-to').value } });
      toast('Probni e-mail je poslan. Provjerite pretinac (i neželjenu poštu).');
    } catch (err) {
      toast(err.message, { error: true, timeout: 8000 });
    }
  });
}

// ---------- admin: izvoz ----------

function setupExport() {
  const update = () => {
    const f = encodeURIComponent($('#export-filter').value);
    $('#export-pdf').href = `/api/admin/export.pdf?filter=${f}`;
    $('#export-xlsx').href = `/api/admin/export.xlsx?filter=${f}`;
  };
  $('#export-filter').addEventListener('change', update);
  update();
}

// ---------- admin: postavke i korisnici ----------

async function loadSettings() {
  if (!isAdmin()) return;
  try {
    const [{ settings }, { users }] = await Promise.all([api('/api/admin/settings'), api('/api/admin/users')]);
    $('#s-open').checked = settings.openRegistration;
    $('#s-max').value = settings.defaultMaxCompanions;
    $('#s-link').textContent = `${location.origin}/pozivnica`;
    $('#a-max').placeholder = settings.defaultMaxCompanions;
    $('#b-max').placeholder = settings.defaultMaxCompanions;
    $('#users-body').innerHTML = users
      .map((u) => `<tr><td><strong>${esc(u.name || u.username)}</strong><div class="hint">${esc(u.username)}</div></td>
        <td><span class="badge badge-role">${u.role === 'admin' ? 'Administrator' : 'Moderator'}</span></td>
        <td><div class="row-actions">${u.id === user.id ? '<span class="hint">vi</span>' : `<button class="btn btn-danger btn-sm" data-del-user="${u.id}">Obriši</button>`}</div></td></tr>`)
      .join('');
    $$('[data-del-user]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Obrisati ovog korisnika?')) return;
        try {
          await api(`/api/admin/users/${b.dataset.delUser}`, { method: 'DELETE' });
          loadSettings();
        } catch (err) {
          toast(err.message, { error: true });
        }
      }),
    );
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function setupSettings() {
  $('#s-copy').addEventListener('click', () => copyText($('#s-link').textContent));
  $('#s-save').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { openRegistration: $('#s-open').checked, defaultMaxCompanions: $('#s-max').value } });
      toast('Postavke su spremljene.');
      loadSettings();
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#user-error');
    errBox.hidden = true;
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: { name: $('#u-name').value, username: $('#u-username').value, password: $('#u-password').value, role: $('#u-role').value },
      });
      e.target.reset();
      toast('Korisnik je dodan.');
      loadSettings();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    }
  });
}

// ---------- pokretanje ----------

async function init() {
  try {
    ({ user } = await api('/api/auth/me'));
  } catch {
    return location.replace('/prijava');
  }
  $('#top-logo').innerHTML = logoHtml({ small: true });
  $('#role-badge').textContent = isAdmin() ? 'Administrator' : 'Moderator';
  $('#user-name').textContent = user.name || user.username;
  if (isAdmin()) $$('[data-admin]').forEach((el) => (el.hidden = false));

  $('#btn-logout').addEventListener('click', async () => {
    await stopCamera();
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.replace('/prijava');
  });
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) selectTab(b.dataset.tab);
  });

  $('#btn-camera').addEventListener('click', () => (scanning ? stopCamera() : startCamera()));
  $('#scan-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !window.Html5Qrcode) return;
    try {
      await stopCamera();
      scanner ??= new window.Html5Qrcode('reader', { verbose: false });
      const text = await scanner.scanFile(file, false);
      lastCode = '';
      handleCode(text);
    } catch {
      toast('Na slici nije pronađen QR kod.', { error: true });
    }
  });
  $('#manual-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#manual-code').value.trim();
    if (code) {
      lastCode = '';
      handleCode(code);
    }
  });
  $('#scan-search').addEventListener('input', renderScanResults);
  $('#scan-results').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) openParty(invitations.find((i) => i.id === Number(b.dataset.id)));
  });

  for (const id of ['#list-search', '#list-filter']) $(id).addEventListener('input', () => { renderList(); renderStats(); });
  $('#btn-refresh').addEventListener('click', () => loadList());
  $('#stats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    $('#list-filter').value = b.dataset.filter;
    renderList();
    renderStats();
  });
  $('#list-body').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const inv = invitations.find((i) => i.id === Number(b.closest('tr').dataset.id));
    if (!inv) return;
    ({ open: openParty, edit: openEdit, delete: deleteInv, link: (x) => copyText(inviteLink(x)), mail: (x) => sendOne(x, x.status === 'confirmed' ? 'qr' : x.inviteSentAt ? 'reminder' : 'invite') })[b.dataset.act](inv);
  });

  if (isAdmin()) {
    setupAdd();
    setupExport();
    setupMail();
    setupSettings();
    loadSettings();
  }

  let initial = 'scan';
  try { initial = sessionStorage.getItem('zk_tab') || 'scan'; } catch { /* */ }
  if (!isAdmin() && !['scan', 'list'].includes(initial)) initial = 'scan';
  selectTab(initial);

  await loadList();
  // Više moderatora radi istovremeno - popis se osvježava svakih 15 s.
  setInterval(() => {
    if (!document.hidden && !$('.modal-backdrop')) loadList({ silent: true });
  }, 15000);
}

init();
