// Kartica "Tlocrt": admin odabere uzvanika koji je potvrdio dolazak i klikne mjesta na tlocrtu.
// Spremanje može odmah poslati e-mail s mjestom. Nacrt (još nespremljena mjesta) preživi
// osvježavanje popisa svakih 15 s jer se crtež samo ažurira, ne gradi ispočetka.
import { $, api, esc, normalize, toast, companionLabel, fmtDateTime, copyText } from './common.js';
import { allSeats, seatLabel, svgMarkup } from './seatplan.js';

let getList = () => [];
let onSaved = () => {};
let selectedId = null;
let draft = [];
let dirty = false;
let zoom = 1;
const checked = new Set(); // uzvanici označeni za skupno slanje mjesta

const confirmed = () => getList().filter((i) => i.status === 'confirmed');
const selected = () => getList().find((i) => i.id === selectedId) || null;
const people = (inv) => (inv.guests.length ? inv.guests : [{ fullName: inv.fullName, isCompanion: false }]);

function occupancy() {
  const map = new Map();
  for (const inv of confirmed()) if (inv.id !== selectedId) for (const s of inv.seats) map.set(s, inv);
  return map;
}

// ---------- crtež ----------

function buildSvg() {
  const holder = document.createElement('div');
  holder.innerHTML = svgMarkup({ titles: true });
  return holder.firstElementChild;
}

function paintSeats() {
  const svg = $('#seat-plan svg');
  if (!svg) return;
  const taken = occupancy();
  const mine = new Map(draft.map((s, i) => [s, i]));
  const inv = selected();
  const ppl = inv ? people(inv) : [];
  for (const c of svg.querySelectorAll('circle.seat')) {
    const id = c.dataset.seat;
    const other = taken.get(id);
    const idx = mine.get(id);
    c.setAttribute('class', `seat${other ? ' taken' : ''}${idx !== undefined ? ' mine' : ''}`);
    const who = idx !== undefined ? ppl[idx]?.fullName || inv?.fullName : other?.fullName;
    c.firstChild.textContent = `${seatLabel(id)}${who ? ` – ${who}` : ' – slobodno'}`;
  }
}

// ---------- popis uzvanika ----------

const canSend = (inv) => inv.seats.length > 0 && Boolean(inv.email);

function visibleRows() {
  const f = $('#seat-filter').value;
  const q = normalize($('#seat-search').value).split(/\s+/).filter(Boolean);
  return confirmed().filter((inv) => {
    const full = inv.seats.length >= inv.personCount;
    if (f === 'missing' && full && inv.id !== selectedId) return false;
    if (f === 'done' && !inv.seats.length) return false;
    if (f === 'unsent' && !(inv.seats.length && !inv.seatSentAt)) return false;
    if (f === 'sent' && !(inv.seats.length && inv.seatSentAt)) return false;
    const hay = normalize([inv.fullName, inv.email, ...inv.guests.map((g) => g.fullName)].join(' '));
    return q.every((w) => hay.includes(w));
  });
}

function renderSendBar(rows) {
  const n = checked.size;
  const bulk = $('#seat-bulk');
  bulk.disabled = !n;
  bulk.textContent = n ? `Pošalji e-mail odabranima (${n})` : 'Pošalji e-mail odabranima';
  const resend = confirmed().filter((i) => checked.has(i.id) && i.seatSentAt).length;
  $('#seat-send-hint').textContent = n
    ? `${resend ? `${resend} od njih već je dobilo e-mail i dobit će ga ponovno. ` : ''}Dnevno se može poslati najviše 250.`
    : 'Označite uzvanike kvačicom (ili „Označi sve prikazane”) pa pošaljite svima odjednom.';
  const eligible = rows.filter(canSend);
  const all = $('#seat-check-all');
  all.disabled = !eligible.length;
  all.checked = eligible.length > 0 && eligible.every((i) => checked.has(i.id));
  all.indeterminate = !all.checked && eligible.some((i) => checked.has(i.id));
}

function renderSide() {
  const all = confirmed();
  for (const id of [...checked]) { const inv = all.find((i) => i.id === id); if (!inv || !canSend(inv)) checked.delete(id); }
  const rows = visibleRows();
  const persons = all.reduce((a, i) => a + i.personCount, 0);
  const seated = all.reduce((a, i) => a + i.seats.length, 0);
  $('#seat-summary').innerHTML = `<strong>${seated}</strong> od <strong>${persons}</strong> osoba koje dolaze ima mjesto · slobodno ${allSeats().length - seated} mjesta`;
  $('#seat-list').innerHTML = rows.length
    ? rows.map((inv) => {
        const n = inv.seats.length;
        const state = n >= inv.personCount ? 'ok' : n ? 'part' : 'none';
        const mail = !n ? '' : inv.seatSentAt ? `<span class="sl-mail sent">✉ poslano ${fmtDateTime(inv.seatSentAt)}</span>`
          : inv.email ? '<span class="sl-mail">e-mail nije poslan</span>' : '<span class="sl-mail none">nema e-mail adrese</span>';
        return `<li class="sl-item">
          ${canSend(inv) ? `<input type="checkbox" class="sl-check" data-check="${inv.id}" aria-label="Označi ${esc(inv.fullName)}" ${checked.has(inv.id) ? 'checked' : ''}>` : '<span class="sl-check"></span>'}
          <button type="button" data-id="${inv.id}" aria-pressed="${inv.id === selectedId}">
          <span class="sl-name">${esc(inv.fullName)}${inv.personCount > 1 ? ` <span class="sl-plus">+${inv.personCount - 1}</span>` : ''}</span>
          <span class="sl-seat sl-${state}">${n ? esc(inv.seatLabels.join(' · ')) : 'bez mjesta'}</span>${mail}
        </button></li>`;
      }).join('')
    : `<li class="empty">${all.length ? 'Nema uzvanika za ovaj prikaz.' : 'Još nitko nije potvrdio dolazak.'}</li>`;
  renderSendBar(rows);
}

// ---------- odabrani uzvanik ----------

function renderBar() {
  const inv = selected();
  const bar = $('#seat-bar');
  if (!inv) {
    bar.innerHTML = `<p class="hint mt0">Odaberite uzvanika s popisa, zatim kliknite slobodna mjesta na tlocrtu.</p>`;
    return;
  }
  const ppl = people(inv);
  const rows = ppl.map((g, i) => `<li><span>${g.isCompanion ? esc(companionLabel(g.fullName)) : `<strong>${esc(g.fullName)}</strong>`}</span>
      <span class="${draft[i] ? 'sb-seat' : 'sb-none'}">${draft[i] ? esc(seatLabel(draft[i])) : 'kliknite mjesto'}</span></li>`).join('');
  const sent = inv.seatSentAt ? `E-mail s mjestom poslan ${fmtDateTime(inv.seatSentAt)}.` : inv.seats.length ? 'E-mail s mjestom još nije poslan.' : '';
  bar.innerHTML = `
    <div class="sb-head"><div><div class="sb-name">${esc(inv.fullName)}</div>
      <div class="hint mt0">${inv.email ? esc(inv.email) : 'nema e-mail adrese'}${sent ? ` · ${sent}` : ''}</div></div>
      <button type="button" class="btn btn-outline btn-icon" id="sb-close" aria-label="Zatvori">✕</button></div>
    <ul class="sb-people">${rows}</ul>
    <div class="actions">
      <button type="button" class="btn btn-gold" id="sb-save" ${dirty ? '' : 'disabled'}>Spremi i dalje</button>
      ${inv.email ? `<button type="button" class="btn btn-outline" id="sb-save-mail" ${draft.length ? '' : 'disabled'}>Spremi i odmah pošalji e-mail</button>` : ''}
      <button type="button" class="btn btn-ghost" id="sb-clear" ${draft.length ? '' : 'disabled'}>Ukloni mjesta</button>
    </div>`;
}

let centered = false;
function render() {
  const plan = $('#seat-plan');
  // na uskom zaslonu tlocrt se prvi put prikaže centriran na pozornicu
  if (!centered && plan.clientWidth) { plan.scrollLeft = (plan.scrollWidth - plan.clientWidth) / 2; centered = true; }
  if (selectedId && !selected()) { selectedId = null; draft = []; dirty = false; }
  renderSide();
  renderBar();
  paintSeats();
}

function select(id) {
  if (dirty && id !== selectedId && !confirm('Promjene mjesta nisu spremljene. Odbaciti ih?')) return;
  selectedId = id;
  draft = [...(selected()?.seats || [])];
  dirty = false;
  render();
}

function clickSeat(id) {
  const inv = selected();
  const other = occupancy().get(id);
  if (other) {
    if (!inv || !dirty) return select(other.id);
    return toast(`${seatLabel(id)} – zauzeto: ${other.fullName}`, { error: true });
  }
  if (!inv) return toast('Prvo odaberite uzvanika s popisa lijevo.');
  const i = draft.indexOf(id);
  if (i >= 0) draft.splice(i, 1);
  else if (draft.length < inv.personCount) draft.push(id);
  else if (inv.personCount === 1) draft = [id];
  else return toast(`${inv.fullName} dolazi s ${inv.personCount} osobe – uklonite neko mjesto prije odabira novog.`, { error: true });
  dirty = true;
  renderBar();
  paintSeats();
}

async function save(notify) {
  const inv = selected();
  if (!inv) return;
  try {
    const res = await api(`/api/admin/invitations/${inv.id}/seats`, { method: 'PUT', body: { seats: draft, notify } });
    dirty = false;
    draft = [...res.invitation.seats];
    const msg = {
      sent: `Spremljeno i poslano na ${inv.email}.`,
      disabled: 'Spremljeno. Slanje e-maila nije podešeno.',
      no_email: 'Spremljeno. Uzvanik nema e-mail adresu.',
      failed: `Spremljeno, ali e-mail nije poslan: ${res.message || ''}`,
      skipped: draft.length ? 'Mjesta su spremljena.' : 'Mjesta su uklonjena.',
    }[res.mail];
    const rows = visibleRows();
    const at = rows.findIndex((i) => i.id === inv.id);
    onSaved(res.invitation);
    // nakon spremanja odmah sljedeći uzvanik bez mjesta
    const full = res.invitation.seats.length >= res.invitation.personCount;
    const next = full ? [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0))].find((i) => i.id !== inv.id && i.seats.length < i.personCount) : null;
    toast(next ? `${msg} Sljedeći: ${next.fullName}` : msg, { error: res.mail === 'failed' });
    if (next) select(next.id);
  } catch (err) {
    toast(err.message, { error: true });
  }
}

async function sendBulk() {
  const ids = [...checked];
  if (!ids.length || !confirm(`Poslati e-mail sa sjedećim mjestom odabranim uzvanicima (${ids.length})?`)) return;
  const btn = $('#seat-bulk');
  btn.disabled = true;
  btn.textContent = `Šaljem ${ids.length}…`;
  try {
    const r = await api('/api/admin/mail/bulk', { method: 'POST', body: { kind: 'seat', ids } });
    const failed = new Set(r.failed.map((x) => x.email));
    for (const inv of confirmed()) if (checked.has(inv.id) && !failed.has(inv.email)) checked.delete(inv.id);
    toast(`Poslano: ${r.sent}${r.failed.length ? ` · nije uspjelo: ${r.failed.length} (ostali su označeni)` : ''}${r.remaining ? ` · preko dnevnog limita: ${r.remaining}` : ''}`, { error: r.failed.length > 0, timeout: 6000 });
  } catch (err) {
    toast(err.message, { error: true });
  }
  onSaved(null);
}

// ---------- link za dijeljenje ----------
let shareToken = null;
const shareUrl = () => `${location.origin}/raspored/${shareToken}`;

function renderShare() {
  const body = $('#share-body');
  if (!shareToken) {
    body.innerHTML = '<button type="button" class="btn btn-outline btn-sm btn-block" data-share="new">Napravi link za dijeljenje</button>';
    return;
  }
  body.innerHTML = `<div class="link-box"><span>${esc(shareUrl())}</span></div>
    <div class="actions">
      <button type="button" class="btn btn-gold btn-sm" data-share="copy">Kopiraj link</button>
      <a class="btn btn-outline btn-sm" href="${esc(shareUrl())}" target="_blank" rel="noopener">Otvori ↗</a>
      <button type="button" class="btn btn-ghost btn-sm" data-share="renew">Novi link</button>
      <button type="button" class="btn btn-danger btn-sm" data-share="off">Isključi</button>
    </div>`;
}

async function shareAction(kind) {
  try {
    if (kind === 'copy') return copyText(shareUrl());
    if (kind === 'renew' && !confirm('Napraviti novi link? Stari link odmah prestaje raditi.')) return;
    if (kind === 'off' && !confirm('Isključiti link? Tko ga ima više neće moći vidjeti raspored.')) return;
    const res = await api('/api/admin/seatmap-share', { method: kind === 'off' ? 'DELETE' : 'POST' });
    shareToken = res.token;
    renderShare();
    if (shareToken) toast('Link je napravljen – kliknite „Kopiraj link” i pošaljite ga.');
    else toast('Link za dijeljenje je isključen.');
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function setZoom(z) {
  zoom = Math.min(3, Math.max(1, z));
  $('#seat-plan svg').style.width = `${zoom * 100}%`;
  $('#seat-zoom-val').textContent = `${Math.round(zoom * 100)} %`;
}

export function setupSeating({ list, saved }) {
  getList = list;
  onSaved = saved;
  $('#seat-plan').append(buildSvg());
  $('#seat-plan').addEventListener('click', (e) => {
    const c = e.target.closest('circle.seat');
    if (c) clickSeat(c.dataset.seat);
  });
  $('#seat-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) select(Number(b.dataset.id) === selectedId && !dirty ? null : Number(b.dataset.id));
  });
  $('#seat-bar').addEventListener('click', (e) => {
    const id = e.target.closest('button')?.id;
    if (id === 'sb-close') select(null);
    if (id === 'sb-save') save(false);
    if (id === 'sb-save-mail') save(true);
    if (id === 'sb-clear') { draft = []; dirty = true; renderBar(); paintSeats(); }
  });
  for (const id of ['#seat-search', '#seat-filter']) $(id).addEventListener('input', renderSide);
  $('#seat-list').addEventListener('change', (e) => {
    const c = e.target.closest('input[data-check]');
    if (!c) return;
    if (c.checked) checked.add(Number(c.dataset.check)); else checked.delete(Number(c.dataset.check));
    renderSendBar(visibleRows());
  });
  $('#seat-check-all').addEventListener('change', (e) => {
    for (const inv of visibleRows().filter(canSend)) if (e.target.checked) checked.add(inv.id); else checked.delete(inv.id);
    renderSide();
  });
  $('#seat-bulk').addEventListener('click', sendBulk);
  $('#share-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-share]');
    if (b) shareAction(b.dataset.share);
  });
  api('/api/admin/seatmap-share').then((r) => { shareToken = r.token; renderShare(); }).catch(() => {});
  $('#seat-zoom-in').addEventListener('click', () => setZoom(zoom + 0.5));
  $('#seat-zoom-out').addEventListener('click', () => setZoom(zoom - 0.5));
  render();
}

export const renderSeating = () => { if ($('#seat-plan svg')) render(); };
export const seatingDirty = () => dirty;
