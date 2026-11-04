// Stranica pozivnice (statična, bez poslužitelja): gost upiše ime i pratnju i dobije QR kod.
(function () {
  var E = window.ZK_EVENT;
  var STORE = 'zk31_pozivnica';
  var $ = function (s) { return document.querySelector(s); };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var rich = function (t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); };

  function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) { /* privatni način */ } }

  // ---------- statični dio ----------
  $('#logo').innerHTML =
    '<div class="zk-logo" role="img" aria-label="' + esc(E.title) + '">' +
    '<span class="num" aria-hidden="true">' + esc(E.edition) + '</span>' +
    '<span class="word" aria-hidden="true">ZLATNA<br>KUNA</span></div>';
  // Zlatna kuna od čestica (kuna.js); pričeka fontove da logo ima konačnu veličinu.
  var startMarten = function () { if (window.startGoldenMarten) window.startGoldenMarten($('.zk-logo')); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(startMarten);
  else startMarten();
  $('#letter').innerHTML =
    '<p>' + esc(E.greeting) + '<br>' + rich(E.intro) + '</p><p>' + esc(E.closing) + '</p>' +
    '<p class="sign">' + esc(E.signatureName) + '<br>' + esc(E.signatureTitle) + '</p>';
  $('#notes').innerHTML = E.notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('');
  $('#contact').innerHTML = 'Za sva pitanja obratite nam se na e-mail <a href="mailto:' + esc(E.contactEmail) + '">' + esc(E.contactEmail) + '</a>.';
  $('#regards').innerHTML = esc(E.regards) + '<br>' + esc(E.organizer);

  // ---------- pratnja ----------
  var max = E.maxCompanions;
  var list = $('#companions');
  $('#companions-block').hidden = max === 0;
  $('#companions-hint').textContent = max === 1 ? 'najviše 1 osoba' : 'najviše ' + max + ' osobe';
  $('#rsvp-lead').textContent = max
    ? 'Upišite svoje ime i prezime. Ako dolazite u pratnji, dodajte ime i prezime svake osobe koja Vas prati.'
    : 'Upišite svoje ime i prezime.';

  function refresh() {
    var n = list.children.length;
    $('#add-companion').disabled = n >= max;
    Array.prototype.forEach.call(list.children, function (row, i) { row.querySelector('.tag').textContent = (i + 1) + '.'; });
  }
  function addRow(c) {
    if (list.children.length >= max) return null;
    c = c || {};
    var row = document.createElement('div');
    row.className = 'companion-row';
    row.innerHTML = '<span class="tag"></span>' +
      '<input type="text" class="c-first" placeholder="Ime" aria-label="Ime osobe u pratnji" maxlength="80" value="' + esc(c.firstName) + '">' +
      '<input type="text" class="c-last" placeholder="Prezime" aria-label="Prezime osobe u pratnji" maxlength="80" value="' + esc(c.lastName) + '">' +
      '<button type="button" class="btn btn-outline btn-icon" aria-label="Ukloni osobu iz pratnje">✕</button>';
    row.querySelector('button').addEventListener('click', function () { row.remove(); refresh(); });
    list.appendChild(row);
    refresh();
    return row;
  }
  $('#add-companion').addEventListener('click', function () {
    var r = addRow();
    if (r) r.querySelector('input').focus();
  });

  // ---------- prikazi ----------
  function show(id) {
    $('#view-invite').hidden = id !== 'invite';
    $('#view-success').hidden = id !== 'success';
    $('#footer').hidden = false;
    window.scrollTo(0, 0);
  }

  function showForm(guest) {
    $('#firstName').value = guest ? guest.firstName : '';
    $('#lastName').value = guest ? guest.lastName : '';
    list.innerHTML = '';
    (guest ? guest.companions : []).forEach(addRow);
    refresh();
    $('#form-error').hidden = true;
    show('invite');
  }

  function qrImage(text) {
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    // velika slika s bijelim rubom - lakše skeniranje i s ekrana
    var count = qr.getModuleCount();
    var cell = Math.max(6, Math.ceil(600 / count));
    var margin = cell * 4;
    var size = count * cell + margin * 2;
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect(margin + c * cell, margin + r * cell, cell, cell);
    }
    return canvas.toDataURL('image/png');
  }

  function showSuccess(guest) {
    var img = qrImage(guest.code);
    $('#qr-img').src = img;
    $('#btn-download').href = img;
    $('#btn-download').download = ('ZK31-' + guest.firstName + '-' + guest.lastName)
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').replace(/[^A-Za-z0-9-]+/g, '_') + '.png';
    $('#success-lead').innerHTML = 'Hvala, ' + esc(guest.firstName) + '! Vaš dolazak na ' + esc(E.titleAccusative) + ' je potvrđen.';
    $('#success-persons').innerHTML = '<li><strong>' + esc(guest.firstName + ' ' + guest.lastName) + '</strong></li>' +
      guest.companions.map(function (c) { return '<li class="comp">' + esc(c.firstName + ' ' + c.lastName) + ' – pratnja</li>'; }).join('');
    var n = guest.companions.length + 1;
    $('#notice-party').textContent = n > 1 ? ' QR kod vrijedi za sve navedene osobe (' + n + ').' : '';
    show('success');
  }

  $('#rsvp-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#form-error');
    err.hidden = true;
    var guest = {
      firstName: $('#firstName').value.trim(),
      lastName: $('#lastName').value.trim(),
      companions: Array.prototype.map.call(list.children, function (row) {
        return { firstName: row.querySelector('.c-first').value.trim(), lastName: row.querySelector('.c-last').value.trim() };
      }).filter(function (c) { return c.firstName || c.lastName; }),
    };
    try {
      if (!guest.firstName || !guest.lastName) throw new Error('Molimo upišite ime i prezime.');
      guest.code = ZKQR.encode(guest);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      return;
    }
    save(guest);
    showSuccess(guest);
  });

  $('#btn-edit').addEventListener('click', function () { showForm(load()); });

  var saved = load();
  if (saved && saved.code) showSuccess(saved);
  else showForm(null);
})();
