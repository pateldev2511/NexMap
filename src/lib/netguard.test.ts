import { describe, it, expect, beforeEach } from 'vitest';
import { isLocalUrl, installNetGuard, NetworkBlockedError, type NetGuardScope } from './netguard';

const ORIGIN = 'http://localhost:5173';

describe('isLocalUrl', () => {
  it('allows same-origin absolute and relative URLs', () => {
    expect(isLocalUrl(`${ORIGIN}/sw.js`, ORIGIN)).toBe(true);
    expect(isLocalUrl('/assets/index.js', ORIGIN)).toBe(true);
    expect(isLocalUrl('manifest.webmanifest', ORIGIN)).toBe(true);
  });

  it('allows data: and blob: URLs (sanitized underlays, exports)', () => {
    expect(isLocalUrl('data:image/png;base64,AAAA', ORIGIN)).toBe(true);
    expect(isLocalUrl('blob:http://localhost:5173/abc', ORIGIN)).toBe(true);
  });

  it('blocks remote origins and schemes', () => {
    expect(isLocalUrl('https://evil.example.com/collect', ORIGIN)).toBe(false);
    expect(isLocalUrl('http://other.localhost/x', ORIGIN)).toBe(false);
    expect(isLocalUrl('wss://telemetry.example.com', ORIGIN)).toBe(false);
    expect(isLocalUrl('https://localhost:5173/x', ORIGIN)).toBe(false); // scheme mismatch
  });
});

interface Calls {
  fetch: string[];
  xhr: string[];
  ws: string[];
  es: string[];
  beacon: string[];
}

/** Build a fresh fake global scope with spy-able network primitives. */
function makeScope(): { scope: NetGuardScope; calls: Calls } {
  const calls: Calls = { fetch: [], xhr: [], ws: [], es: [], beacon: [] };

  class FakeXHR {
    open(_method: string, url: string) {
      calls.xhr.push(url);
    }
  }
  class FakeWS {
    url: string;
    constructor(url: string) {
      calls.ws.push(url);
      this.url = url;
    }
  }
  class FakeES {
    url: string;
    constructor(url: string) {
      calls.es.push(url);
      this.url = url;
    }
  }

  const scope: NetGuardScope = {
    location: { origin: ORIGIN },
    fetch: ((input: RequestInfo | URL) => {
      calls.fetch.push(String(input));
      return Promise.resolve({ ok: true } as Response);
    }) as typeof fetch,
    XMLHttpRequest: FakeXHR as unknown as typeof XMLHttpRequest,
    WebSocket: FakeWS as unknown as typeof WebSocket,
    EventSource: FakeES as unknown as typeof EventSource,
    navigator: {
      sendBeacon: (url: string) => {
        calls.beacon.push(url);
        return true;
      },
    },
  };
  return { scope, calls };
}

describe('installNetGuard', () => {
  let scope: NetGuardScope;
  let calls: Calls;

  beforeEach(() => {
    ({ scope, calls } = makeScope());
    installNetGuard(scope);
  });

  it('lets same-origin fetch through to the original implementation', async () => {
    await scope.fetch!('/api/local');
    expect(calls.fetch).toEqual(['/api/local']);
  });

  it('throws on remote fetch and never calls the original', async () => {
    await expect(scope.fetch!('https://evil.example.com/x')).rejects.toBeInstanceOf(
      NetworkBlockedError,
    );
    expect(calls.fetch).toEqual([]);
  });

  it('throws on remote XHR.open', () => {
    const xhr = new scope.XMLHttpRequest!();
    expect(() => xhr.open('GET', 'https://evil.example.com')).toThrow(NetworkBlockedError);
    expect(calls.xhr).toEqual([]);
    expect(() => xhr.open('GET', '/local')).not.toThrow();
    expect(calls.xhr).toEqual(['/local']);
  });

  it('throws on remote WebSocket', () => {
    expect(() => new scope.WebSocket!('wss://telemetry.example.com')).toThrow(
      NetworkBlockedError,
    );
    expect(calls.ws).toEqual([]);
  });

  it('throws on remote EventSource', () => {
    expect(() => new scope.EventSource!('https://evil.example.com/stream')).toThrow(
      NetworkBlockedError,
    );
    expect(calls.es).toEqual([]);
  });

  it('throws on remote sendBeacon (the classic exfil vector)', () => {
    expect(() => scope.navigator!.sendBeacon!('https://evil.example.com/beacon')).toThrow(
      NetworkBlockedError,
    );
    expect(calls.beacon).toEqual([]);
  });

  it('is idempotent — installing twice does not double-wrap', async () => {
    installNetGuard(scope); // second call is a no-op
    await expect(scope.fetch!('https://evil.example.com')).rejects.toBeInstanceOf(
      NetworkBlockedError,
    );
  });
});
