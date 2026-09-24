/*
 * Offline shell. The app's own files come from the network when there is one (so an
 * update shows on the next open) and from the cache when there isn't. Rate and history requests go straight to the
 * network — the page keeps its own last-known rates, and old history isn't worth
 * serving as if it were current.
 *
 * Bump CACHE on every release so old shells are dropped.
 */
const CACHE = 'cc-v1.0.1';
const SHELL = [
  './', 'index.html', 'styles.css', 'core.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network first, cache as the fallback. Was stale-while-revalidate, which meant every
  // update took two launches to appear — fine for a finished app, wrong for one still
  // being tuned. The 3 s timeout keeps a bad signal from stalling the launch.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(e.request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (_) {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});
