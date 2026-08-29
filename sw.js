/* ============================================================
   FOCYL — SERVICE WORKER v2
   The v1 worker was cache-first with no cleanup: once a visitor
   loaded the site they would keep getting the old HTML forever,
   because a cached index.html always won over the network.
   This version is network-first for pages, cache-first for
   static assets, and deletes old caches on activate.
   Bump CACHE on every deploy.
   ============================================================ */
const CACHE = 'focyl-v2';
const SHELL = [
  '/', '/index.html', '/auth.html', '/board.html',
  '/manifest.json',
  '/lib/focyl-config.js', '/lib/focyl-brand.js', '/lib/focyl-libraries.js', '/lib/focyl-picker.js',
  '/assets/focyl-mark.svg', '/assets/icon-192.png', '/assets/icon-512.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;      // never cache Supabase or CDN calls
  if (url.pathname.startsWith('/functions/')) return;   // never cache Edge Functions

  const isPage = request.mode === 'navigate' || url.pathname.endsWith('.html');

  if (isPage) {
    // Network first: a deploy is visible immediately, offline still works.
    e.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Static assets and library manifests: cache first, refresh in background.
  e.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(request, copy));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
