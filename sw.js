/* ============================================================
   FOCYL — SERVICE WORKER v6

   A blank launch screen almost always means the worker answered a
   navigation with nothing. This version can never do that: every
   navigation resolves to a real Response, and if all else fails it
   serves an inline recovery page instead of a black rectangle.

   Bump CACHE on every deploy.
   ============================================================ */
const CACHE = 'focyl-v16';

const SHELL = [
  './', './index.html', './auth.html', './board.html', './manifest.json',
  './lib/focyl-config.js', './lib/focyl-brand.js',
  './lib/focyl-libraries.js', './lib/focyl-picker.js',
  './lib/focyl-media.js', './lib/focyl-images.js', './lib/focyl-ai.js',
  './assets/focyl-mark.svg', './assets/icon-192.png', './assets/icon-512.png'
];

const RECOVERY = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Focyl</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0d1224;color:#EDEFF7;font-family:system-ui,sans-serif;text-align:center;padding:24px}
a{color:#8B7CF6}button{margin-top:18px;background:#8B7CF6;color:#070914;border:0;
border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600}
</style></head><body><div>
<h2>Focyl couldn't load</h2>
<p>You may be offline, or a stale cache is in the way.</p>
<button onclick="reset()">Clear cache and retry</button>
<script>
async function reset(){
  if('caches' in window){for(const k of await caches.keys())await caches.delete(k);}
  if(navigator.serviceWorker){
    for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();
  }
  location.replace('index.html');
}
</script></div></body></html>`;

function recoveryResponse() {
  return new Response(RECOVERY, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('install', e => {
  self.skipWaiting();
  // Cache each item on its own. addAll() rejects the whole batch if a
  // single entry 404s, which silently left the cache empty.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(SHELL.map(u => c.add(u).catch(() => null)))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'reset') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister());
  }
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // Supabase, CDNs
  if (url.pathname.includes('/functions/')) return;  // Edge Functions

  const isPage = request.mode === 'navigate' || url.pathname.endsWith('.html');

  if (isPage) {
    e.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
          return res;
        }
        if (res) return res;                       // real 404, show it
      } catch (_) { /* offline */ }

      return (await caches.match(request))
          || (await caches.match('./index.html'))
          || (await caches.match('./'))
          || recoveryResponse();                   // never resolve empty
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const res = await fetch(request);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
      }
      return res;
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
