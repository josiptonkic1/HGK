// Stranica /raspored: pregled konačnog rasporeda (samo za čitanje) za admina i moderatore.
// Prelazak mišem preko mjesta prikaže tko sjedi, klik/dodir otvori karticu s podacima osobe.
// Podaci se osvježavaju svakih 20 s pa se vidi i tko je već došao.
import { $, api, esc, logoHtml, fmtDateTime, fmtTime, normalize } from './common.js';
import { allSeats, seatLabel, svgMarkup } from './seatplan.js';

let user = null;
let bySeat = new Map(); // oznaka mjesta -> { inv, person, index }
let invitations = [];
let pinned = null; // odabrano mjesto (oznaka)
let zoom = 1;
let stopped = false;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
// /raspored/<token> = link za dijeljenje: bez prijave, bez e-mailova i napomena
const shareToken = location.pathname.match(/^\/raspored\/([\w-]+)/)?.[1] || null;

const people = (inv) => (inv.guests.length ? inv.guests : [{ fullName: inv.fullName, isCompanion: false, checkedInAt: null }]);

function index() {
  bySeat = new Map();
  for (const inv of invitations) {
    if (inv.status !== 'confirmed') continue;
    people(inv).forEach((person, i) => { if (inv.seats[i]) bySeat.set(inv.seats[i], { inv, person, index: i }); });
  }
}

// ---------- crtež ----------

function paint() {
  const party = pinned && bySeat.get(pinned) ? new Set(bySeat.get(pinned).inv.seats) : new Set();
  const q = $('#rv-search').value.trim();
  const matches = q.length >= 2 ? new Set(search(q).map((m) => m.seat)) : null;
  for (const c of document.querySelectorAll('#rv-plan circle.seat')) {
    const hit = bySeat.get(c.dataset.seat);
    let cls = 'seat';
    if (hit) cls += hit.person.checkedInAt ? ' arrived' : ' booked';
    if (party.has(c.dataset.seat)) cls += ' mine';
    if (c.dataset.seat === pinned) cls += ' pinned';
    if (matches?.has(c.dataset.seat)) cls += ' match';
    c.setAttribute('class', cls);
  }
  const seated = bySeat.size;
  const arrived = [...bySeat.values()].filter((x) => x.person.checkedInAt).length;
  const confirmedPersons = invitations.filter((i) => i.status === 'confirmed').reduce((a, i) => a + i.personCount, 0);
  $('#rv-summary').innerHTML = `Zauzeto <strong>${seated}</strong> od ${allSeats().length} mjesta · došlo <strong>${arrived}</strong> · potvrđeno ${confirmedPersons} osoba${confirmedPersons > seated ? `, od toga ${confirmedPersons - seated} bez mjesta` : ''}`;
}

// ---------- podaci o osobi ----------

function personBlock(hit, { brief = false } = {}) {
  const { inv, person } = hit;
  const arrived = person.checkedInAt ? `<span class="badge badge-confirmed">Došao ${fmtTime(person.checkedInAt)}</span>` : '<span class="badge badge-pending">Još nije došao</span>';
  const head = `<div class="rv-seat">${esc(seatLabel(inv.seats[hit.index]))}</div>
    <div class="rv-name">${esc(person.fullName)}</div>
    ${person.isCompanion ? `<div class="rv-sub">pratnja – dolazi s osobom <strong>${esc(inv.fullName)}</strong></div>` : ''}
    <div class="rv-badges">${arrived}</div>`;
  if (brief) return head;
  const party = people(inv);
  const rows = party.map((p, i) => {
    const seat = inv.seats[i];
    return `<li><button type="button" class="rv-party" ${seat ? `data-seat="${seat}"` : 'disabled'} aria-pressed="${seat === pinned}">
      <span>${p.isCompanion ? `${esc(p.fullName)} <span class="rv-dim">– pratnja</span>` : `<strong>${esc(p.fullName)}</strong>`}</span>
      <span class="rv-dim">${seat ? esc(seatLabel(seat)) : 'bez mjesta'}${p.checkedInAt ? ` · ✓ ${fmtTime(p.checkedInAt)}` : ''}</span>
    </button></li>`;
  }).join('');
  if (shareToken) return `${head}
    <h3 class="rv-h">${party.length > 1 ? `Dolaze zajedno (${party.length})` : 'Dolazi sam/a'}</h3>
    <ul class="rv-partylist">${rows}</ul>`;
  const info = [
    inv.email ? ['E-mail', `<a href="mailto:${esc(inv.email)}">${esc(inv.email)}</a>`] : null,
    ['Dolazak potvrđen', esc(fmtDateTime(inv.respondedAt)) || '—'],
    ['Potvrda poslana', inv.confirmSentAt ? esc(fmtDateTime(inv.confirmSentAt)) : 'ne'],
    ['E-karta poslana', inv.seatSentAt ? esc(fmtDateTime(inv.seatSentAt)) : 'ne'],
    inv.note ? ['Napomena', esc(inv.note)] : null,
  ].filter(Boolean);
  return `${head}
    <h3 class="rv-h">${party.length > 1 ? `Dolaze zajedno (${party.length})` : 'Dolazi sam/a'}</h3>
    <ul class="rv-partylist">${rows}</ul>
    <dl class="rv-info">${info.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function renderCard() {
  const card = $('#rv-card');
  if (!pinned) {
    card.classList.remove('open');
    card.innerHTML = '<p class="hint mt0">Odaberite mjesto na tlocrtu ili potražite osobu.</p>';
    return;
  }
  const hit = bySeat.get(pinned);
  card.classList.add('open');
  card.innerHTML = `<button type="button" class="btn btn-outline btn-icon rv-close" id="rv-close" aria-label="Zatvori">✕</button>
    ${hit ? personBlock(hit) : `<div class="rv-seat">${esc(seatLabel(pinned))}</div><div class="rv-name rv-free">Slobodno mjesto</div>`}`;
}

function pin(seat, { scroll = false } = {}) {
  pinned = seat;
  renderCard();
  paint();
  if (scroll && seat) {
    const c = document.querySelector(`#rv-plan circle[data-seat="${seat}"]`);
    const plan = $('#rv-plan');
    if (c) {
      const pr = plan.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      plan.scrollBy({ left: cr.left - pr.left - pr.width / 2, top: cr.top - pr.top - pr.height / 2, behavior: 'smooth' });
    }
  }
}

// ---------- pretraga ----------

function search(q) {
  const words = normalize(q).split(/\s+/).filter(Boolean);
  const out = [];
  for (const [seat, hit] of bySeat) {
    const hay = normalize(`${hit.person.fullName} ${hit.inv.fullName} ${hit.inv.email || ''}`);
    if (words.every((w) => hay.includes(w))) out.push({ seat, hit });
  }
  return out.sort((a, b) => a.hit.person.fullName.localeCompare(b.hit.person.fullName, 'hr'));
}

function renderResults() {
  const q = $('#rv-search').value.trim();
  const box = $('#rv-results');
  if (q.length < 2) { box.hidden = true; paint(); return; }
  const res = search(q).slice(0, 12);
  box.hidden = false;
  box.innerHTML = res.length
    ? res.map(({ seat, hit }) => `<li><button type="button" data-seat="${seat}"><strong>${esc(hit.person.fullName)}</strong>${hit.person.isCompanion ? ' <span class="rv-dim">– pratnja</span>' : ''}<span class="rv-dim">${esc(seatLabel(seat))}</span></button></li>`).join('')
    : '<li class="empty">Nitko s tim imenom nema mjesto.</li>';
  paint();
}

// ---------- tooltip (miš) ----------

function showTip(e, seat) {
  const tip = $('#rv-tip');
  const hit = bySeat.get(seat);
  tip.innerHTML = hit ? personBlock(hit, { brief: true }) : `<div class="rv-seat">${esc(seatLabel(seat))}</div><div class="rv-free">slobodno</div>`;
  tip.hidden = false;
  const pad = 14;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.transform = `translate(${x}px, ${y}px)`;
}

function setZoom(z) {
  const plan = $('#rv-plan');
  const cx = (plan.scrollLeft + plan.clientWidth / 2) / plan.scrollWidth;
  const cy = (plan.scrollTop + plan.clientHeight / 2) / plan.scrollHeight;
  zoom = Math.min(4, Math.max(1, z));
  $('#rv-plan svg').style.width = `${zoom * 100}%`;
  $('#rv-zoom-val').textContent = `${Math.round(zoom * 100)} %`;
  plan.scrollLeft = cx * plan.scrollWidth - plan.clientWidth / 2;
  plan.scrollTop = cy * plan.scrollHeight - plan.clientHeight / 2;
}

async function load() {
  try {
    ({ invitations } = await api(shareToken ? `/api/seatmap/${shareToken}` : '/api/staff/invitations'));
    index();
    paint();
    renderCard();
    if (!$('#rv-results').hidden) renderResults();
  } catch (err) {
    if (err.status === 401 && !shareToken) return location.replace('/prijava');
    if (err.status === 404 && shareToken) {
      $('.rv').innerHTML = `<div class="panel rv-gone"><h2>Link nije aktivan</h2><p class="hint mt0">${esc(err.message)} Zatražite novi link od organizatora.</p></div>`;
      stopped = true;
    }
  }
}

async function init() {
  if (shareToken) {
    document.querySelector('.topbar .who').innerHTML = '<span class="badge badge-role">Pregled rasporeda</span>';
  } else {
    try {
      ({ user } = await api('/api/auth/me'));
    } catch {
      return location.replace('/prijava');
    }
  }
  $('#top-logo').innerHTML = logoHtml({ small: true });
  const plan = $('#rv-plan');
  plan.innerHTML = svgMarkup();
  if (!fine) $('#rv-help').textContent = 'Dodirnite mjesto da vidite tko tamo sjedi. Tlocrt pomičete prstom, a + i − ga uvećavaju.';

  plan.addEventListener('click', (e) => {
    const c = e.target.closest('circle.seat');
    if (c) pin(c.dataset.seat === pinned ? null : c.dataset.seat);
  });
  if (fine) {
    plan.addEventListener('mousemove', (e) => {
      const c = e.target.closest('circle.seat');
      if (c) showTip(e, c.dataset.seat); else $('#rv-tip').hidden = true;
    });
    plan.addEventListener('mouseleave', () => { $('#rv-tip').hidden = true; });
  }
  $('#rv-card').addEventListener('click', (e) => {
    if (e.target.closest('#rv-close')) return pin(null);
    const b = e.target.closest('button[data-seat]');
    if (b) pin(b.dataset.seat, { scroll: true });
  });
  $('#rv-search').addEventListener('input', renderResults);
  $('#rv-results').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-seat]');
    if (!b) return;
    $('#rv-results').hidden = true;
    if (zoom < 2) setZoom(2);
    pin(b.dataset.seat, { scroll: true });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pin(null); });
  $('#rv-zoom-in').addEventListener('click', () => setZoom(zoom + 0.5));
  $('#rv-zoom-out').addEventListener('click', () => setZoom(zoom - 0.5));

  await load();
  if (stopped) return;
  plan.scrollLeft = (plan.scrollWidth - plan.clientWidth) / 2;
  setInterval(() => { if (!document.hidden && !stopped) load(); }, 20000);
}

init();
