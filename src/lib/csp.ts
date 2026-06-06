/**
 * Content-Security-Policy — the *declarative* half of NexMap's local-first promise.
 *
 * This is the single source of truth for the policy. The build-time Vite plugin
 * (vite.config.ts) imports `cspString()` and injects it as a <meta http-equiv> into
 * the production index.html; `csp.test.ts` asserts the directives without needing a
 * full build. The *behavioural* half — actually trapping egress at runtime — lives in
 * `netguard.ts`. Two independent guarantees: this declares intent, netguard proves it.
 *
 * Only injected in production builds. The dev server is left uncapped so Vite's HMR
 * websocket and inline React-refresh preamble keep working.
 *
 * Relaxations, each deliberate:
 * - `style-src 'unsafe-inline'` — the canvas sets inline `style=` attributes (SVG
 *   transforms, the drag readout's position). Inline style is not an exfiltration
 *   vector, so this is a safe loosening.
 * - `img-src data: blob:` — sanitized image underlays and raster exports use data/blob
 *   URLs. Remote `https:` images stay blocked (that would be a phone-home).
 * - `worker-src blob:` — headroom for the deferred topology-redundancy worker.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
};

/** Serialize the directives into a CSP header/meta value. */
export function cspString(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
}
