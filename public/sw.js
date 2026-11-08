// Service worker: guscio dell'app stale-while-revalidate, dati API network-first con copia offline.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const SHELL_FILES = [
  '/', '/index.html', '/css/app.css', '/js/app.js',
  '/js/lib/geo.js', '/js/lib/navigation.js', '/js/lib/filters.js', '/js/lib/areas.js',
  '/manifest.webmanifest', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname === '/api/stations') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok) { const copy = r.clone(); caches.open(DATA).then((c) => c.put(e.request, copy)); }
          return r;
        })
        .catch(async () => {
          const cached = await caches.match(e.request);
          if (!cached) throw new Error('offline');
          const h = new Headers(cached.headers);
          h.set('X-From-SW-Cache', '1');
          return new Response(await cached.blob(), { status: 200, headers: h });
        }),
    );
    return;
  }

  // Guscio: stale-while-revalidate (risposta immediata dalla cache, aggiornamento in background).
  e.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
