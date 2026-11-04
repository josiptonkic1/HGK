// Web verzija aplikacije za ulaz: rad bez interneta nakon prvog otvaranja.
// Podaci o dolascima su u bazi preglednika (IndexedDB), ne ovdje.
const CACHE = 'zk31-ulaz-v1';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/auth.js', 'js/db.js', 'js/export.js',
  'vendor/style.css', 'vendor/fonts.css', 'vendor/zk-qr.js', 'vendor/html5-qrcode.min.js',
  'vendor/exceljs.min.js', 'vendor/pdfkit.standalone.js',
  'vendor/fonts/DejaVuSans.ttf', 'vendor/fonts/DejaVuSans-Bold.ttf',
  'vendor/icon-192.png', 'vendor/icon-512.png', 'vendor/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Mreža prva (uvijek najnovija verzija), predmemorija kad nema interneta.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
