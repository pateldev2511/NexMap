/* NexMap service worker (Phase 7) — offline support via runtime caching.
 * Strategy: same-origin GET → stale-while-revalidate (serve cache fast, refresh in
 * background). Navigations fall back to the cached app shell when offline. NexMap
 * never makes network requests for project data, so caching the app is enough to
 * run fully offline after the first load. */
const CACHE = 'nexmap-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop old caches from previous versions.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      // Stale-while-revalidate: serve cache immediately, else wait for network.
      const fresh = cached || (await network);
      if (fresh) return fresh;

      // Offline navigation fallback → cached app shell.
      if (req.mode === 'navigate') {
        const shell = (await cache.match('/index.html')) || (await cache.match('/'));
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })(),
  );
});
