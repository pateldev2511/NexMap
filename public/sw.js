/* NexMap service worker (Phase 7) — offline support via runtime caching.
 * NexMap never makes network requests for project data, so caching the app is
 * enough to run fully offline after the first load. Strategy per request:
 *  - Page navigations → network-first, so every deploy reaches returning visitors on
 *    their next load. The last good page is kept as the offline app shell.
 *  - Hashed build assets (/assets/*) → cache-first. Their names change with their
 *    content, so a cached copy is never stale.
 *  - Everything else (icons, manifest) → stale-while-revalidate.
 * An HTML response is only ever cached for a navigation: the host answers a missing
 * asset with the SPA's index.html (status 200), and caching that as a script or
 * stylesheet would break the app on every later load. */
const CACHE = 'nexmap-v2'; // bump to drop every entry cached by an older worker
const SHELL = '/';

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

const isHtml = (res) => (res.headers.get('content-type') || '').includes('text/html');

/** A response worth keeping: a success, and HTML only for a page. */
const cacheable = (req, res) => !!res && res.ok && (req.mode === 'navigate') === isHtml(res);

const offline = () => new Response('Offline', { status: 503, statusText: 'Offline' });

async function page(req, cache) {
  try {
    const res = await fetch(req);
    if (cacheable(req, res)) {
      await cache.put(SHELL, res.clone());
      return res;
    }
    // A server error is no better than the last good shell.
    if (!res.ok) return (await cache.match(SHELL)) || res;
    return res;
  } catch {
    return (await cache.match(SHELL)) || offline();
  }
}

async function asset(req, cache) {
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (cacheable(req, res)) await cache.put(req, res.clone());
    return res;
  } catch {
    return offline();
  }
}

async function staleWhileRevalidate(event, req, cache) {
  const cached = await cache.match(req);
  const network = fetch(req)
    .then(async (res) => {
      if (cacheable(req, res)) await cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) || offline();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') return page(req, cache);
      if (url.pathname.startsWith('/assets/')) return asset(req, cache);
      return staleWhileRevalidate(event, req, cache);
    })(),
  );
});
