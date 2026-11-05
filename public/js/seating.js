// Kartica "Tlocrt": admin odabere uzvanika koji je potvrdio dolazak i klikne mjesta na tlocrtu.
// Spremanje može odmah poslati e-mail s mjestom. Nacrt (još nespremljena mjesta) preživi
// osvježavanje popisa svakih 15 s jer se crtež samo ažurira, ne gradi ispočetka.
import { $, api, esc, normalize, toast, companionLabel, fmtDateTime } from './common.js';
import { VIEW, allSeats, boxShapes, rowLabels, seatLabel } from './seatplan.js';

let getList = () => [];
let onSaved = () => {};
let selectedId = null;
let draft = [];
let dirty = false;
let zoom = 1;

const SVGNS = 'http://www.w3.org/2000/svg';
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
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `-30 0 ${VIEW.width + 60} ${VIEW.height - 40}`);
  svg.setAttribute('class', 'seat-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Tlocrt dvorane HNK Zagreb');
  const parts = [
    `<path class="sp-stage" d="M350,26 L650,26 L640,92 Q500,108 360,92 Z"/>`,
    `<text class="sp-stage-t" x="500" y="66">POZORNICA</text>`,
    ...boxShapes().map((b) => `<path class="sp-box" d="${b.path}"/><text class="sp-boxno" x="${b.label.x}" y="${b.label.y + 3}">${b.box}</text>`),
    ...rowLabels().map((r) => `<text class="sp-row" x="${r.x}" y="${r.y + 3}">${r.text}</text>`),
    `<text class="sp-sec" x="500" y="428">PARTER</text>`,
    `<text class="sp-sec" x="500" y="573">BALKON</text>`,
    `<text class="sp-sec" x="500" y="664">GALERIJA</text>`,
    ...allSeats().map((s) => `<circle class="seat" data-seat="${s.id}" cx="${s.x}" cy="${s.y}" r="5.6"><title></title></circle>`),
  ];
  svg.innerHTML = parts.join('');
  return svg;
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

function renderSide() {
  const all = confirmed();
  const f = $('#seat-filter').value;
  const q = normalize($('#seat-search').value).split(/\s+/).filter(Boolean);
  const rows = all.filter((inv) => {
    const full = inv.seats.length >= inv.personCount;
    if (f === 'missing' && full && inv.id !== selectedId) return false;
    if (f === 'done' && !full) return false;
    const hay = normalize([inv.fullName, inv.email, ...inv.guests.map((g) => g.fullName)].join(' '));
    return q.every((w) => hay.includes(w));
  });
  const persons = all.reduce((a, i) => a + i.personCount, 0);
  const seated = all.reduce((a, i) => a + i.seats.length, 0);
  $('#seat-summary').innerHTML = `<strong>${seated}</strong> od <strong>${persons}</strong> osoba koje dolaze ima mjesto · slobodno ${allSeats().length - seated} mjesta`;
  $('#seat-list').innerHTML = rows.length
    ? rows.map((inv) => {
        const n = inv.seats.length;
        const state = n >= inv.personCount ? 'ok' : n ? 'part' : 'none';
        return `<li><button type="button" data-id="${inv.id}" aria-pressed="${inv.id === selectedId}">
          <span class="sl-name">${esc(inv.fullName)}${inv.personCount > 1 ? ` <span class="sl-plus">+${inv.personCount - 1}</span>` : ''}</span>
          <span class="sl-seat sl-${state}">${n ? esc(inv.seatLabels.join(' · ')) : 'bez mjesta'}</span>
        </button></li>`;
      }).join('')
    : `<li class="empty">${all.length ? 'Nema uzvanika za ovaj prikaz.' : 'Još nitko nije potvrdio dolazak.'}</li>`;
  const pendingMail = all.filter((i) => i.seats.length && !i.seatSentAt && i.email).length;
  const bulk = $('#seat-bulk');
  bulk.disabled = !pendingMail;
  bulk.textContent = pendingMail ? `Pošalji mjesta e-mailom svima kojima nisu poslana (${pendingMail})` : 'Sva dodijeljena mjesta su poslana';
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
      ${inv.email ? `<button type="button" class="btn btn-gold" id="sb-save-mail" ${draft.length ? '' : 'disabled'}>Spremi i pošalji e-mail</button>` : ''}
      <button type="button" class="btn ${inv.email ? 'btn-outline' : 'btn-gold'}" id="sb-save" ${dirty ? '' : 'disabled'}>Spremi</button>
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
    toast(msg, { error: res.mail === 'failed' });
    onSaved(res.invitation);
  } catch (err) {
    toast(err.message, { error: true });
  }
}

async function sendBulk() {
  const n = confirmed().filter((i) => i.seats.length && !i.seatSentAt && i.email).length;
  if (!n || !confirm(`Poslati e-mail s dodijeljenim mjestom ${n} uzvanika?`)) return;
  const btn = $('#seat-bulk');
  btn.disabled = true;
  btn.textContent = 'Šaljem…';
  try {
    const r = await api('/api/admin/mail/bulk', { method: 'POST', body: { kind: 'seat' } });
    toast(`Poslano: ${r.sent}${r.failed.length ? ` · nije uspjelo: ${r.failed.length}` : ''}`, { error: r.failed.length > 0 });
  } catch (err) {
    toast(err.message, { error: true });
  }
  onSaved(null);
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
  $('#seat-bulk').addEventListener('click', sendBulk);
  $('#seat-zoom-in').addEventListener('click', () => setZoom(zoom + 0.5));
  $('#seat-zoom-out').addEventListener('click', () => setZoom(zoom - 0.5));
  render();
}

export const renderSeating = () => { if ($('#seat-plan svg')) render(); };
export const seatingDirty = () => dirty;
