import { $, api, esc, richText, logoHtml, companionEditor, companionLabel, copyText } from './common.js';

const personalToken = location.pathname.startsWith('/p/') ? decodeURIComponent(location.pathname.slice(3)) : null;
const STORAGE_KEY = 'zk31_token';

let event;
let settings;
let invitation = null; // trenutna pozivnica (javni prikaz)
let editor;
let cameFromOpen = false;

const views = ['view-invite', 'view-success', 'view-declined', 'view-message'];
function show(id) {
  $('#loading').hidden = true;
  for (const v of views) $(`#${v}`).hidden = v !== id;
  $('#footer').hidden = false;
  window.scrollTo({ top: 0 });
}

function remember(token) {
  try { localStorage.setItem(STORAGE_KEY, token); } catch { /* privatni način */ }
}
function remembered() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function renderStatic() {
  $('#logo').innerHTML = logoHtml({ edition: event.edition, dust: false });
  // Zlatna kuna od čestica (kuna.js) - pričeka fontove da logo ima konačnu veličinu
  const marten = () => window.startGoldenMarten?.($('.zk-logo'));
  // animacija kune kreće tek nakon uvodnog videa (intro.js), kad su fontovi učitani
  Promise.all([document.fonts?.ready, window.zkIntroDone]).then(marten);
  $('#letter').innerHTML = `
    <p>${esc(event.greeting)}<br>${richText(event.intro)}</p>
    <p>${esc(event.closing)}</p>
    <p class="sign">${esc(event.signatureName)}<br>${esc(event.signatureTitle)}</p>`;
  $('#notes').innerHTML = event.notes.map((n) => `<p>${esc(n)}</p>`).join('');
  $('#contact').innerHTML = `Za sva pitanja obratite nam se na e-mail <a href="mailto:${esc(event.contactEmail)}">${esc(event.contactEmail)}</a>.`;
  $('#regards').innerHTML = `${esc(event.regards)}<br>${esc(event.organizer)}`;
}

function setFormError(msg) {
  $('#form-error').textContent = msg || '';
  $('#form-error').hidden = !msg;
}

function showForm() {
  const max = invitation ? invitation.maxCompanions : settings.defaultMaxCompanions;
  $('#firstName').value = invitation?.firstName || '';
  $('#lastName').value = invitation?.lastName || '';
  $('#email').value = invitation?.email || '';
  // E-mail je obavezan kad aplikacija šalje QR kod e-mailom
  $('#email').required = Boolean(settings.emailEnabled);
  $('#email-hint').textContent = settings.emailEnabled ? '(na njega šaljemo QR kod)' : '(neobavezno)';
  // Osobni link s već poznatim e-mailom: gost ga ne mora upisivati, samo ga vidi (i može promijeniti).
  const known = Boolean(personalToken && invitation?.email);
  $('#email-field').hidden = known;
  $('#email-known').hidden = !known;
  if (known) {
    $('#email-known').innerHTML = `${settings.emailEnabled ? 'QR kod poslat ćemo na' : 'Vaš e-mail:'} <strong>${esc(invitation.email)}</strong> · <a href="#" id="email-change">promijeni</a>`;
    $('#email-change').addEventListener('click', (e) => {
      e.preventDefault();
      $('#email-known').hidden = true;
      $('#email-field').hidden = false;
      $('#email').focus();
    });
  }
  const comps = (invitation?.guests || []).filter((g) => g.isCompanion).map((g) => ({ firstName: g.firstName, lastName: g.lastName }));
  editor.setMax(max);
  editor.reset(comps);
  $('#companions-block').hidden = max === 0;
  $('#companions-hint').textContent = max === 1 ? 'najviše 1 osoba' : `najviše ${max} osobe`;
  $('#btn-decline').hidden = !personalToken;
  $('#rsvp-lead').textContent = max
    ? 'Molimo upišite svoje ime i prezime. Ako dolazite u pratnji, dodajte i ime i prezime osobe koja Vas prati.'
    : 'Molimo upišite svoje ime i prezime.';
  setFormError('');
  show('view-invite');
}

function showSuccess() {
  const inv = invitation;
  $('#success-lead').innerHTML = `Hvala, ${esc(inv.firstName)}! Vaš dolazak na ${esc(event.titleAccusative)} je potvrđen.`;
  $('#qr-img').src = inv.qrImage;
  $('#qr-text').textContent = inv.qrCode;
  $('#success-persons').innerHTML = inv.guests
    .map((g) => (g.isCompanion ? `<li class="comp">${esc(companionLabel(g.fullName))}</li>` : `<li><strong>${esc(g.fullName)}</strong></li>`))
    .join('');
  const n = inv.guests.length;
  $('#notice-party').textContent = n > 1 ? ` QR kod vrijedi za sve navedene osobe (${n}).` : '';
  $('#btn-download').href = `/api/invite/${encodeURIComponent(inv.token)}/qr.png`;
  $('#btn-edit').hidden = !inv.editable;
  const link = `${location.origin}/p/${inv.token}`;
  // Gost s općeg linka nema osobni link u e-mailu pa mu ga prikazujemo.
  $('#own-link').hidden = !cameFromOpen;
  $('#own-link-text').textContent = link;
  // Poruka o e-mailu s QR kodom
  const ms = $('#mail-status');
  const mail = inv.mail;
  ms.hidden = !mail || mail === 'disabled';
  if (mail === 'sent') {
    ms.className = 'alert alert-ok';
    ms.textContent = `QR kod smo poslali i na e-mail ${inv.email}.`;
  } else if (mail === 'failed') {
    ms.className = 'alert alert-warn';
    ms.textContent = 'E-mail s QR kodom trenutno nije poslan. Preuzmite QR kod ili napravite snimku zaslona.';
  } else if (mail === 'no_email') {
    ms.className = 'alert alert-warn';
    ms.textContent = 'Bez e-mail adrese QR kod ne možemo poslati – preuzmite ga ili napravite snimku zaslona.';
  }
  show('view-success');
}

function render() {
  if (!invitation) return showForm();
  if (invitation.status === 'confirmed') return showSuccess();
  if (invitation.status === 'declined') return show('view-declined');
  return showForm();
}

function message(title, text) {
  $('#message-title').textContent = title;
  $('#message-text').innerHTML = text;
  show('view-message');
}

async function submit(attending) {
  setFormError('');
  const body = { attending };
  if (attending) {
    body.firstName = $('#firstName').value.trim();
    body.lastName = $('#lastName').value.trim();
    body.email = $('#email').value.trim();
    body.companions = editor.values();
    $('#firstName').setAttribute('aria-invalid', String(!body.firstName));
    $('#lastName').setAttribute('aria-invalid', String(!body.lastName));
    if (!body.firstName || !body.lastName) return setFormError('Molimo upišite ime i prezime.');
    $('#email').setAttribute('aria-invalid', 'false');
    if (settings.emailEnabled && !body.email) {
      $('#email').setAttribute('aria-invalid', 'true');
      return setFormError('Upišite e-mail adresu – na nju šaljemo QR kod.');
    }
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      $('#email').setAttribute('aria-invalid', 'true');
      return setFormError('E-mail adresa nije ispravna.');
    }
    const bad = body.companions.findIndex((c) => (c.firstName && !c.lastName) || (!c.firstName && c.lastName));
    if (bad >= 0) return setFormError(`Upišite ime i prezime za ${bad + 1}. osobu u pratnji.`);
    body.companions = body.companions.filter((c) => c.firstName || c.lastName);
  }

  const buttons = [$('#btn-confirm'), $('#btn-decline')];
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (personalToken) {
      invitation = await api(`/api/invite/${encodeURIComponent(personalToken)}/respond`, { method: 'POST', body });
    } else {
      invitation = await api('/api/register', { method: 'POST', body });
      remember(invitation.token);
      cameFromOpen = true;
      history.replaceState(null, '', `/p/${invitation.token}`);
    }
    render();
  } catch (err) {
    setFormError(err.message);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function init() {
  try {
    const data = await api('/api/event');
    event = data.event;
    settings = data;
    document.title = `Pozivnica – ${event.title}`;
    renderStatic();
    editor = companionEditor($('#companions'), { max: settings.defaultMaxCompanions });

    $('#rsvp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submit(true);
    });
    $('#btn-decline').addEventListener('click', () => {
      if (confirm('Želite li potvrditi da ne možete doći?')) submit(false);
    });
    $('#btn-edit').addEventListener('click', showForm);
    $('#btn-undecline').addEventListener('click', showForm);
    $('#btn-copy-link').addEventListener('click', () => copyText($('#own-link-text').textContent));

    if (personalToken) {
      invitation = await api(`/api/invite/${encodeURIComponent(personalToken)}`);
      return render();
    }
    if (!settings.openRegistration) {
      return message('Prijave su zatvorene', `Za sva pitanja obratite nam se na <a href="mailto:${esc(event.contactEmail)}">${esc(event.contactEmail)}</a>.`);
    }
    const saved = remembered();
    if (saved) {
      try {
        const prev = await api(`/api/invite/${encodeURIComponent(saved)}`);
        if (prev.status === 'confirmed') {
          invitation = prev;
          cameFromOpen = true;
          history.replaceState(null, '', `/p/${prev.token}`);
          return render();
        }
      } catch { /* pozivnica obrisana - prikaži novi obrazac */ }
    }
    showForm();
  } catch (err) {
    if (!event) {
      $('#loading').textContent = 'Pozivnicu trenutno nije moguće učitati. Pokušajte ponovno za nekoliko trenutaka.';
      return;
    }
    message('Pozivnica nije pronađena', esc(err.message));
  }
}

init();
