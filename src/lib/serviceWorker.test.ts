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

function worker(net: Net) {
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
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
    location: { origin: ORIGIN },
  };
  const calls: string[] = [];
  const fetch = async (req: { url: string }) => {
    calls.push(new URL(req.url).pathname);
    return net(req.url);
  };
  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, fetch);

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
  const cached = (path: string) => {
    for (const entries of store.values()) {
      const hit = entries.get(new URL(path, ORIGIN).href);
      if (hit) return hit;
    }
  };
  return { request, activate, calls, store, cached, setNet: (n: Net) => (net = n) };
}

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
