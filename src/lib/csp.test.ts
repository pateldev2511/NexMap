import { describe, it, expect } from 'vitest';
import { CSP_DIRECTIVES, cspString } from './csp';

describe('csp policy', () => {
  it('locks the default fetch directive to self — the core local-first guarantee', () => {
    expect(CSP_DIRECTIVES['default-src']).toEqual(["'self'"]);
  });

  it('blocks remote network connections (no remote fetch/XHR/WebSocket)', () => {
    expect(CSP_DIRECTIVES['connect-src']).toEqual(["'self'"]);
  });

  it('allows local + data/blob images but no remote images (no pixel phone-home)', () => {
    expect(CSP_DIRECTIVES['img-src']).toContain("'self'");
    expect(CSP_DIRECTIVES['img-src']).toContain('data:');
    expect(CSP_DIRECTIVES['img-src']).toContain('blob:');
    expect(CSP_DIRECTIVES['img-src']).not.toContain('*');
    expect((CSP_DIRECTIVES['img-src'] ?? []).some((s) => s.startsWith('http'))).toBe(false);
  });

  it('forbids inline/remote scripts (script-src self only)', () => {
    expect(CSP_DIRECTIVES['script-src']).toEqual(["'self'"]);
  });

  it('disallows plugins, form posts, and framing', () => {
    expect(CSP_DIRECTIVES['object-src']).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES['form-action']).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES['frame-ancestors']).toEqual(["'none'"]);
  });

  it('serializes to a valid meta-content string', () => {
    const s = cspString();
    expect(s).toContain("default-src 'self'");
    expect(s).toContain("connect-src 'self'");
    expect(s.split('; ').length).toBe(Object.keys(CSP_DIRECTIVES).length);
  });

  it('never widens any directive to a wildcard or http(s) origin', () => {
    for (const sources of Object.values(CSP_DIRECTIVES)) {
      for (const src of sources) {
        expect(src).not.toBe('*');
        expect(src.startsWith('http://')).toBe(false);
        expect(src.startsWith('https://')).toBe(false);
      }
    }
  });
});
