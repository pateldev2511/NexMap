/**
 * Network tripwire — the *behavioural* half of NexMap's local-first promise.
 *
 * NexMap must never send a byte off the machine. CSP (src/lib/csp.ts) *declares* that;
 * this *enforces* it at runtime by wrapping every browser egress primitive so an
 * accidental remote call throws loudly instead of silently phoning home. It runs
 * continuously in production (installed from main.tsx), which is strictly stronger than
 * a one-shot CI check — a regression that adds a remote `fetch` trips it the first time
 * it executes, in front of the developer, not months later in someone's network tab.
 *
 * Same-origin, `data:`, and `blob:` URLs are allowed (app shell, sanitized underlays,
 * exports). Everything else is blocked. The guard is NOT installed in dev so Vite's HMR
 * websocket keeps working; the test suite exercises it directly with a fake scope.
 */

export class NetworkBlockedError extends Error {
  constructor(url: string) {
    super(
      `NexMap blocked a network request to "${url}". NexMap is 100% local — ` +
        `no data leaves your machine. If you see this, a code path tried to reach the network.`,
    );
    this.name = 'NetworkBlockedError';
  }
}

/** True if `raw` resolves to the same origin, or a data:/blob: URL. */
export function isLocalUrl(raw: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    // Unparseable against our own origin → treat as local (relative junk can't egress).
    return true;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
  return u.origin === origin;
}

/** Minimal shape of the global object the guard patches (real `window` or a test fake). */
export interface NetGuardScope {
  location?: { origin: string };
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  WebSocket?: typeof WebSocket;
  EventSource?: typeof EventSource;
  navigator?: { sendBeacon?: (url: string, data?: BodyInit | null) => boolean };
  __nexmapNetGuard?: boolean;
}

/**
 * Wrap fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon on `scope` so any
 * non-local URL throws NetworkBlockedError. Idempotent. Returns the scope for chaining.
 */
export function installNetGuard(scope: NetGuardScope): NetGuardScope {
  if (scope.__nexmapNetGuard) return scope;
  scope.__nexmapNetGuard = true;

  const origin = scope.location?.origin ?? 'http://localhost';
  const guard = (url: string) => {
    if (!isLocalUrl(url, origin)) throw new NetworkBlockedError(url);
  };
  const urlOf = (input: unknown): string =>
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : typeof (input as { url?: string })?.url === 'string'
          ? (input as { url: string }).url
          : String(input);

  const origFetch = scope.fetch;
  if (origFetch) {
    // Bind to the scope so the native fetch keeps its required `this` (avoids
    // "Illegal invocation" in real browsers) without an implicit-any `this` param.
    const boundFetch = origFetch.bind(scope as unknown as typeof globalThis);
    scope.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      // Honour fetch's contract: a blocked request rejects, it does not throw synchronously.
      try {
        guard(urlOf(input));
      } catch (err) {
        return Promise.reject(err);
      }
      return boundFetch(input, init);
    } as typeof fetch;
  }

  const XHR = scope.XMLHttpRequest;
  if (XHR) {
    const origOpen = XHR.prototype.open;
    XHR.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      guard(urlOf(url));
      // eslint-disable-next-line prefer-spread
      return origOpen.apply(this, [method, url, ...rest] as Parameters<typeof origOpen>);
    };
  }

  const OrigWS = scope.WebSocket;
  if (OrigWS) {
    const Wrapped = function (url: string | URL, protocols?: string | string[]) {
      guard(urlOf(url));
      return new OrigWS(url, protocols);
    } as unknown as typeof WebSocket;
    Wrapped.prototype = OrigWS.prototype;
    scope.WebSocket = Wrapped;
  }

  const OrigES = scope.EventSource;
  if (OrigES) {
    const Wrapped = function (url: string | URL, init?: EventSourceInit) {
      guard(urlOf(url));
      return new OrigES(url, init);
    } as unknown as typeof EventSource;
    Wrapped.prototype = OrigES.prototype;
    scope.EventSource = Wrapped;
  }

  const nav = scope.navigator;
  if (nav?.sendBeacon) {
    const origBeacon = nav.sendBeacon.bind(nav);
    nav.sendBeacon = (url: string, data?: BodyInit | null) => {
      guard(urlOf(url));
      return origBeacon(url, data);
    };
  }

  return scope;
}
