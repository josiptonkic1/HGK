// Sadržaj QR koda pozivnice: ime, prezime i pratnja zapisani u samom kodu (nema poslužitelja).
// Format: "ZK31:" + base64url(JSON) + "." + kontrolni zbroj
// Base64 drži kod čisto ASCII pa skener ispravno čita i č, ć, š, ž, đ.
// Kontrolni zbroj otkriva oštećen ili ručno izmijenjen kod (nije kriptografska zaštita).
// Koriste ga stranica pozivnice i Android aplikacija; radi i u Node.js (testovi).
(function (root) {
  var PREFIX = 'ZK31';

  function toB64url(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // FNV-1a 32-bit
  function checksum(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function person(first, last) {
    return { firstName: first, lastName: last, fullName: (first + ' ' + last).trim() };
  }

  // guest = { firstName, lastName, companions: [{ firstName, lastName }] }
  function encode(guest) {
    var f = clean(guest.firstName);
    var l = clean(guest.lastName);
    if (!f || !l) throw new Error('Ime i prezime su obavezni.');
    var p = (guest.companions || [])
      .map(function (c) { return [clean(c.firstName), clean(c.lastName)]; })
      .filter(function (c) { return c[0] || c[1]; });
    p.forEach(function (c, i) {
      if (!c[0] || !c[1]) throw new Error('Upišite ime i prezime za ' + (i + 1) + '. osobu u pratnji.');
    });
    var body = toB64url(JSON.stringify({ v: 1, f: f, l: l, p: p, t: Math.floor(Date.now() / 1000) }));
    return PREFIX + ':' + body + '.' + checksum(body);
  }

  function decode(text) {
    var m = String(text || '').trim().match(/^ZK31:([A-Za-z0-9_-]+)\.([0-9a-z]+)$/);
    if (!m) throw new Error('Ovo nije QR kod pozivnice za 31. Zlatnu kunu.');
    if (checksum(m[1]) !== m[2]) throw new Error('QR kod je oštećen ili izmijenjen.');
    var d;
    try {
      d = JSON.parse(fromB64url(m[1]));
    } catch (e) {
      throw new Error('QR kod je oštećen.');
    }
    if (d.v !== 1 || !d.f || !d.l) throw new Error('Nepoznata verzija pozivnice.');
    var main = person(clean(d.f), clean(d.l));
    return {
      firstName: main.firstName,
      lastName: main.lastName,
      fullName: main.fullName,
      companions: (d.p || []).map(function (c) { return person(clean(c[0]), clean(c[1])); }),
      issuedAt: d.t ? new Date(d.t * 1000).toISOString() : null,
    };
  }

  var api = { PREFIX: PREFIX, encode: encode, decode: decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ZKQR = api;
})(typeof self !== 'undefined' ? self : globalThis);
