// Početni ekran Android aplikacije: pamti adresu poslužitelja i otvara panel za skeniranje.
(function () {
  var KEY = 'zk_server';
  var $ = function (id) { return document.getElementById(id); };

  function load() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* */ } }

  // "zlatnakuna.hgk.hr/staff" -> "https://zlatnakuna.hgk.hr"
  function normalize(input) {
    var v = String(input || '').trim();
    if (!v) return null;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      var u = new URL(v);
      return u.protocol + '//' + u.host;
    } catch (e) {
      return null;
    }
  }

  // Provjera da na adresi stvarno radi aplikacija Zlatna kuna.
  function check(base) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 10000);
    return fetch(base + '/api/event', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error('Poslužitelj je odgovorio greškom (' + res.status + ').');
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.event || !/zlatna kuna/i.test(data.event.title || '')) {
          throw new Error('Na ovoj adresi ne radi aplikacija Zlatna kuna.');
        }
        return data;
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') throw new Error('Poslužitelj ne odgovara. Provjerite adresu i internetsku vezu.');
        if (err instanceof TypeError) throw new Error('Nije moguće spojiti se na poslužitelj. Provjerite adresu (mora počinjati s https://) i internetsku vezu.');
        throw err;
      })
      .finally(function () { clearTimeout(timer); });
  }

  function go(base) {
    window.location.replace(base + '/staff');
  }

  function showForm(prefill, message) {
    $('checking').hidden = true;
    $('setup').hidden = false;
    $('url').value = prefill || '';
    $('error').textContent = message || '';
    $('error').hidden = !message;
    if (!prefill) $('url').focus();
  }

  function connect(base, fromForm) {
    $('checking').hidden = false;
    $('setup').hidden = true;
    $('checking-url').textContent = base;
    check(base)
      .then(function () {
        save(base);
        go(base);
      })
      .catch(function (err) {
        showForm(base, err.message);
        if (fromForm) $('url').focus();
      });
  }

  $('setup').addEventListener('submit', function (e) {
    e.preventDefault();
    var base = normalize($('url').value);
    if (!base) return showForm($('url').value, 'Upišite ispravnu adresu, npr. https://zlatnakuna.hgk.hr');
    connect(base, true);
  });

  var saved = load();
  var change = /[?&]promijeni\b/.test(window.location.search);
  if (saved && !change) connect(saved, false);
  else showForm(saved, '');
})();
