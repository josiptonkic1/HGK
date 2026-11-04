// Service worker web aplikacije: omogućuje instalaciju i otvaranje sučelja bez mreže.
// Podaci (/api) se NIKAD ne spremaju u predmemoriju - uvijek idu na poslužitelj.
const CACHE = 'zk31-v2';
const SHELL = [
  '/staff', '/prijava', '/pozivnica',
  '/css/style.css', '/js/common.js', '/js/staff.js', '/js/login.js', '/js/invite.js',
  '/vendor/html5-qrcode.min.js',
  '/vendor/fontsource/montserrat/600.css', '/vendor/fontsource/montserrat/700.css',
  '/vendor/fontsource/raleway/300.css', '/vendor/fontsource/raleway/400.css', '/vendor/fontsource/raleway/600.css',
  '/img/hgk.svg', '/img/icon-192.png', '/img/icon-512.png', '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Mreža prva (uvijek svježa verzija), predmemorija samo kad nema veze.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Osobne pozivnice (/p/...) se ne spremaju - stranica je ista, podaci dolaze s /api.
  const key = url.pathname.startsWith('/p/') ? '/pozivnica' : req;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic' && !url.pathname.startsWith('/p/')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || caches.match('/staff'))),
  );
});
