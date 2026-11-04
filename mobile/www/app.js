// Početni ekran Android aplikacije: spaja se na ugrađenu adresu poslužitelja (config.js)
// i otvara prijavu / skeniranje. Korisnik ne upisuje adresu.
(function () {
  var $ = function (id) { return document.getElementById(id); };

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

  var base = normalize(window.ZK_SERVER_URL);

  function fail(message) {
    $('checking').hidden = true;
    $('failed').hidden = false;
    $('error').textContent = message;
  }

  function connect() {
    $('failed').hidden = true;
    $('checking').hidden = false;
    if (!base) return fail('Aplikacija još nije povezana s poslužiteljem. Javite se administratoru.');

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    // Besplatni hosting se može "buditi" i do minute.
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 70000);
    fetch(base + '/api/event', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error('Poslužitelj trenutno nije dostupan (' + res.status + ').');
        window.location.replace(base + '/staff');
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return fail('Poslužitelj ne odgovara. Provjerite internetsku vezu i pokušajte ponovno.');
        if (err instanceof TypeError) return fail('Nema veze s poslužiteljem. Provjerite internetsku vezu i pokušajte ponovno.');
        fail(err.message);
      })
      .finally(function () { clearTimeout(timer); });
  }

  $('retry').addEventListener('click', connect);
  connect();
})();
