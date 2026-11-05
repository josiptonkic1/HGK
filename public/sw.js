// Service worker web aplikacije: omoguÄ‡uje instalaciju i otvaranje suÄelja bez mreÅ¾e.
// Podaci (/api) se NIKAD ne spremaju u predmemoriju - uvijek idu na posluÅ¾itelj.
const CACHE = 'zk31-v12';
const SHELL = [
  '/staff', '/prijava', '/pozivnica',
  '/css/style.css', '/js/common.js', '/js/staff.js', '/js/login.js', '/js/invite.js', '/js/seating.js', '/js/seatplan.js',
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

// MreÅ¾a prva (uvijek svjeÅ¾a verzija), predmemorija samo kad nema veze.
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
