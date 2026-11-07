// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Runs public/sw.js against an in-memory Cache Storage and a scripted network, so
 *  the caching strategy is tested exactly as it ships (the e2e suite runs on the dev
 *  server, where the worker is never registered). */
const SOURCE = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://nexmap.test';

type Net = (url: string) => Response | Promise<Response>;

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const js = (body: string) =>
  new Response(body, { headers: { 'content-type': 'text/javascript' } });
const offline: Net = () => Promise.reject(new TypeError('Failed to fetch'));

// The build replaces this line with the emitted file list (swPrecachePlugin in
// vite.config.ts), and fails if it is missing.
const PRECACHE_MARKER = 'const PRECACHE = [];';

/** Loads the worker. `precache` stands in for the list the build writes into it. */
function worker(net: Net, precache: string[] = []) {
  const listeners: Partial<Record<string, (e: unknown) => void>> = {};
  const store = new Map<string, Map<string, Response>>();
  const keyOf = (r: string | { url: string }) =>
    typeof r === 'string' ? new URL(r, ORIGIN).href : r.url;
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const entries = store.get(name)!;
      return {
        match: async (r: string | { url: string }) => entries.get(keyOf(r))?.clone(),
        put: async (r: string | { url: string }, res: Response) => void entries.set(keyOf(r), res),
        keys: async () => [...entries.keys()].map((url) => ({ url })),
        delete: async (r: string | { url: string }) => entries.delete(keyOf(r)),
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  const messages: unknown[] = [];
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: async () => undefined,
    clients: {
      claim: async () => undefined,
      matchAll: async () => [{ postMessage: (m: unknown) => messages.push(m) }],
    },
    location: { origin: ORIGIN },
  };
  const calls: string[] = [];
  const fetch = async (req: string | { url: string }) => {
    const url = keyOf(req);
    calls.push(new URL(url).pathname);
    return net(url);
  };
  const source = SOURCE.replace(PRECACHE_MARKER, `const PRECACHE = ${JSON.stringify(precache)};`);
  new Function('self', 'caches', 'fetch', source)(self, caches, fetch);

  /** Dispatches a fetch event; resolves to the response, or null if not intercepted. */
  async function request(
    path: string,
    mode = 'cors',
    method = 'GET',
    origin = ORIGIN,
  ): Promise<Response | null> {
    let responded = null as Promise<Response> | null;
    const pending: Promise<unknown>[] = [];
    listeners.fetch!({
      request: { url: origin + path, method, mode },
      respondWith: (p: Promise<Response>) => (responded = p),
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    if (!responded) return null;
    const res = await responded;
    await Promise.all(pending);
    return res;
  }
  async function activate() {
    let done: Promise<unknown> = Promise.resolve();
    listeners.activate!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }
  /** Runs the install step; resolves true if it succeeded. */
  async function install() {
    let done: Promise<unknown> = Promise.resolve();
    listeners.install!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    return done.then(
      () => true,
      () => false,
    );
  }
  const cached = (path: string) => {
    for (const entries of store.values()) {
      const hit = entries.get(new URL(path, ORIGIN).href);
      if (hit) return hit;
    }
  };
  return {
    request,
    install,
    activate,
    calls,
    store,
    cached,
    messages,
    setNet: (n: Net) => (net = n),
  };
}

/** A host serving one build: the page plus its files, and the SPA fallback for the rest. */
const host =
  (files: Record<string, string>): Net =>
  (url) => {
    const body = files[new URL(url).pathname];
    return body !== undefined ? js(body) : html('<!doctype html><title>NexMap</title>');
  };

describe('service worker — install makes the first visit work offline', () => {
  const BUILD = ['/assets/index-a1.js', '/assets/jspdf-b2.js', '/icon.svg'];

  it('precaches the page and every build file, lazy chunks included', async () => {
    const sw = worker(host({ '/assets/index-a1.js': 'app', '/assets/jspdf-b2.js': 'pdf', '/icon.svg': 'i' }), BUILD);
    expect(await sw.install()).toBe(true);
    for (const path of ['/', ...BUILD]) expect(sw.cached(path)).toBeDefined();

    // A cold offline launch: the page and a never-loaded lazy chunk both answer.
    sw.setNet(offline);
    expect(await (await sw.request('/', 'navigate'))!.text()).toContain('NexMap');
    expect(await (await sw.request('/assets/jspdf-b2.js'))!.text()).toBe('pdf');
  });

  it('fails install, rather than claim offline readiness, when a file is missing', async () => {
    // jspdf-b2.js is absent, so the host answers with its SPA fallback page.
    const sw = worker(host({ '/assets/index-a1.js': 'app', '/icon.svg': 'i' }), BUILD);
    expect(await sw.install()).toBe(false);
  });

  it('fails install when the network drops mid-fill', async () => {
    let served = 0;
    const sw = worker((url) => (++served > 2 ? offline(url) : host({})(url)), BUILD);
    expect(await sw.install()).toBe(false);
  });

  it('drops build files the new build no longer ships, keeping the page', async () => {
    const sw = worker(host({ '/assets/index-a1.js': 'old' }), ['/assets/index-a1.js']);
    await sw.install();
    await sw.activate();
    // The next deploy renamed the bundle.
    const next = worker(host({ '/assets/index-c3.js': 'new' }), ['/assets/index-c3.js']);
    for (const [name, entries] of sw.store) next.store.set(name, new Map(entries));
    await next.install();
    await next.activate();
    expect(next.cached('/assets/index-a1.js')).toBeUndefined();
    expect(next.cached('/assets/index-c3.js')).toBeDefined();
    expect(next.cached('/')).toBeDefined();
  });

  it('tells open pages that offline use is ready once it activates', async () => {
    const sw = worker(host({}), []);
    await sw.install();
    await sw.activate();
    expect(sw.messages).toEqual([{ type: 'nexmap:offline-ready' }]);
  });
});

describe('service worker — page navigations are network-first', () => {
  it('serves a new deploy on the next load even when an older page is cached', async () => {
    const sw = worker(() => html('deploy 1'));
    await sw.request('/', 'navigate');
    sw.setNet(() => html('deploy 2'));
    const res = await sw.request('/', 'navigate');
    expect(await res!.text()).toBe('deploy 2');
    expect(await sw.cached('/')!.clone().text()).toBe('deploy 2');
  });

  it('falls back to the last good page offline, for any route', async () => {
    const sw = worker(() => html('shell'));
    await sw.request('/', 'navigate');
    sw.setNet(offline);
    expect(await (await sw.request('/?v=1', 'navigate'))!.text()).toBe('shell');
  });

  it('answers 503 offline when nothing was ever cached', async () => {
    const sw = worker(offline);
    expect((await sw.request('/', 'navigate'))!.status).toBe(503);
  });

  it('prefers the last good page over a server error', async () => {
    const sw = worker(() => html('shell'));
    await sw.request('/', 'navigate');
    sw.setNet(() => html('bad gateway', 502));
    const res = await sw.request('/', 'navigate');
    expect(await res!.text()).toBe('shell');
  });
});

describe('service worker — hashed assets are cache-first', () => {
  it('fetches a hashed asset once, then serves it from the cache', async () => {
    const sw = worker(() => js('bundle'));
    await sw.request('/assets/index-abc.js');
    const res = await sw.request('/assets/index-abc.js');
    expect(await res!.text()).toBe('bundle');
    expect(sw.calls).toEqual(['/assets/index-abc.js']);
  });

  it('never caches the SPA fallback page as a missing script or stylesheet', async () => {
    // The host answers an asset deleted by a newer deploy with index.html, status 200.
    const sw = worker(() => html('<!doctype html>'));
    await sw.request('/assets/index-gone.css');
    await sw.request('/assets/index-gone.css');
    expect(sw.cached('/assets/index-gone.css')).toBeUndefined();
    expect(sw.calls).toHaveLength(2);
  });

  it('answers 503 for an uncached asset offline', async () => {
    const sw = worker(offline);
    expect((await sw.request('/assets/index-abc.js'))!.status).toBe(503);
  });
});

describe('service worker — other files and housekeeping', () => {
  it('serves other files from the cache and refreshes them in the background', async () => {
    const sw = worker(() => new Response('icon 1', { headers: { 'content-type': 'image/svg+xml' } }));
    await sw.request('/icon.svg');
    sw.setNet(() => new Response('icon 2', { headers: { 'content-type': 'image/svg+xml' } }));
    expect(await (await sw.request('/icon.svg'))!.text()).toBe('icon 1');
    expect(await sw.cached('/icon.svg')!.clone().text()).toBe('icon 2');
  });

  it('drops caches written by older workers when it activates', async () => {
    const sw = worker(() => js('x'));
    sw.store.set('nexmap-v1', new Map([[`${ORIGIN}/assets/a.css`, html('poisoned')]]));
    await sw.request('/assets/b.js');
    await sw.activate();
    expect([...sw.store.keys()]).toEqual(['nexmap-v2']);
  });

  it('leaves non-GET and cross-origin requests to the browser', async () => {
    const sw = worker(() => js('x'));
    expect(await sw.request('/', 'navigate', 'POST')).toBeNull();
    expect(await sw.request('/beacon.js', 'no-cors', 'GET', 'https://elsewhere.test')).toBeNull();
    expect(sw.calls).toEqual([]);
  });
});
