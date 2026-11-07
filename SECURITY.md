# Security Policy

## NexMap's threat model

NexMap is a **client-only, local-first** app. There is no server, no database,
and no account system, so the usual web-app attack surface (auth, server-side
injection, data exfiltration endpoints) does not exist. The security posture
centers on two guarantees and one hostile input:

- **No egress.** A runtime tripwire (`src/lib/netguard.ts`) blocks any network
  request to a non-same-origin URL, and a strict Content-Security-Policy
  (`src/lib/csp.ts`) declares the same. Project data cannot leave the device.
- **Hostile files.** `.nexmap` documents and imported SVG/HTML are treated as
  untrusted. Rich-text and SVG underlays are sanitized with DOMPurify on both
  load and render (`src/lib/sanitizeHtml.ts`); the loader strips prototype-
  pollution keys.

Security-relevant bugs are therefore things like: a way to make the app reach
the network, a sanitizer bypass (stored XSS via a crafted `.nexmap`/SVG), or a
prototype-pollution gap in document loading.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on the repository.

Include: affected version/commit, a description, reproduction steps, and (if
possible) a minimal `.nexmap` or input that triggers it. We aim to acknowledge
within a few days. Coordinated disclosure is appreciated.

## Dependency advisories

The maintainer triages advisories against the production dependencies (the code
that ships to the browser). CI fails on any high or critical one
(`npm audit --omit=dev --audit-level=high`), and Dependabot opens update PRs
weekly. For each advisory, record in the update PR the locked version that was
affected and the version that replaces it. Discuss whether a flaw is reachable in
NexMap privately (see above), not in the public PR.

After updating a dependency in the security path, run these besides the full
suite:

| Dependency | What it guards | Check |
| --- | --- | --- |
| `dompurify` | rich text and SVG underlays in `.nexmap` and imports | `npx vitest run src/lib/sanitizeHtml.test.ts src/model` |
| `jspdf` | offline PDF handoffs | `npx playwright test e2e/pdf-export.spec.ts` |
| `fflate` | ZIP handoff packages | `npx vitest run src/io/export` |
| any | offline use of the shipped build | `npm run e2e:preview` |

## Supported versions

NexMap is pre-1.0; only the latest `main` is supported. Fixes land on `main`.
