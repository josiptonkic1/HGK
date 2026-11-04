// Zajedničke pomoćne funkcije za sve stranice.

// Web aplikacija (PWA): service worker omogućuje instalaciju na mobitel / računalo.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// Otvoreno u Android aplikaciji (Capacitor dodaje oznaku u User-Agent)?
export const inMobileApp = /ZlatnaKunaApp/.test(navigator.userAgent);

// Gumb "Instaliraj aplikaciju" - preglednik javlja kad je instalacija moguća.
let installEvent = null;
export function setupInstallButton(button) {
  if (!button) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => (button.hidden = true));
  button.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    button.hidden = true;
  });
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* prazan odgovor */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'error', data?.message || 'Došlo je do greške. Pokušajte ponovno.');
  return data;
}

// Tekst s **podebljanim** dijelovima -> sigurni HTML.
export const richText = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

export function logoHtml({ small = false, edition = '31.', dust = true } = {}) {
  const num = esc(edition.replace('.', ''));
  return `<div class="zk-logo${small ? ' small' : ''}" role="img" aria-label="${esc(edition)} Zlatna kuna">
    <span class="num" aria-hidden="true">${num}.</span>
    <span class="word" aria-hidden="true">ZLATNA<br>KUNA</span>
    ${small || !dust ? '' : '<span class="dust" aria-hidden="true"></span>'}
  </div>`;
}

// Zlatna "prašina" preko broja, kao na originalnoj pozivnici.
export function sprinkleDust(root = document) {
  for (const dust of $$('.zk-logo .dust', root)) {
    let html = '';
    for (let i = 0; i < 70; i++) {
      // pojas po dijagonali, gušći oko broja
      const t = Math.random();
      const x = -8 + t * 116 + (Math.random() - 0.5) * 18;
      const y = 4 + (1 - t) * 30 + Math.random() * 22;
      const size = (Math.random() * 2.6 + 0.8).toFixed(1);
      html += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--s:${size}px;--d:${(2 + Math.random() * 3).toFixed(1)}s;--delay:${(Math.random() * 3).toFixed(1)}s;--o:${(0.4 + Math.random() * 0.6).toFixed(2)}"></i>`;
    }
    dust.innerHTML = html;
  }
}

const dtf = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const tf = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (iso) => (iso ? dtf.format(new Date(iso)) : '');
export const fmtTime = (iso) => (iso ? tf.format(new Date(iso)) : '');

// Pretraga bez obzira na velika slova i dijakritike (č, ć, đ, š, ž).
export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function toast(message, { error = false, timeout = 3500 } = {}) {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status');
    document.body.append(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.textContent = message;
  wrap.append(el);
  setTimeout(() => el.remove(), timeout);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Kopirano u međuspremnik.');
  } catch {
    window.prompt('Kopirajte link:', text);
  }
}

export const companionLabel = (fullName) => `${fullName} – pratnja`;

// Uređivač popisa pratnje (koriste ga pozivnica i administracija).
export function companionEditor(container, { max = Infinity, initial = [], onChange } = {}) {
  const list = document.createElement('div');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-outline btn-sm';
  addBtn.textContent = '+ Dodaj pratnju';
  container.append(list, addBtn);

  const refresh = () => {
    const n = list.children.length;
    addBtn.disabled = n >= max;
    addBtn.hidden = max === 0;
    [...list.children].forEach((row, i) => {
      row.querySelector('.tag').textContent = `${i + 1}.`;
    });
    onChange?.(n);
  };

  const addRow = (c = {}) => {
    if (list.children.length >= max) return;
    const row = document.createElement('div');
    row.className = 'companion-row';
    if (c.id) row.dataset.id = c.id;
    row.innerHTML = `<span class="tag"></span>
      <input type="text" name="cFirst" placeholder="Ime" autocomplete="off" aria-label="Ime osobe u pratnji" maxlength="80" value="${esc(c.firstName)}">
      <input type="text" name="cLast" placeholder="Prezime" autocomplete="off" aria-label="Prezime osobe u pratnji" maxlength="80" value="${esc(c.lastName)}">
      <button type="button" class="btn btn-outline btn-icon" aria-label="Ukloni osobu iz pratnje" title="Ukloni">✕</button>`;
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      refresh();
    });
    list.append(row);
    refresh();
    return row;
  };

  addBtn.addEventListener('click', () => addRow()?.querySelector('input').focus());
  initial.forEach(addRow);
  refresh();

  return {
    values: () =>
      [...list.children].map((row) => ({
        id: row.dataset.id ? Number(row.dataset.id) : undefined,
        firstName: row.querySelector('[name=cFirst]').value.trim(),
        lastName: row.querySelector('[name=cLast]').value.trim(),
      })),
    setMax(m) {
      max = m;
      while (list.children.length > max) list.lastElementChild.remove();
      refresh();
    },
    reset(items = []) {
      list.innerHTML = '';
      items.forEach(addRow);
      refresh();
    },
  };
}
