# Contributing to NexMap

Thanks for your interest. NexMap is a **local-first** network diagram designer:
no login, no backend, and **no byte of project data ever leaves the user's
machine**. That guarantee shapes how we accept changes — please read the
invariant below before opening a PR.

## The local-first invariant (non-negotiable)

NexMap must never make a network request for application or project data.

- The app is enforced at runtime by a network tripwire (`src/lib/netguard.ts`)
  that throws on any non-same-origin `fetch` / `XMLHttpRequest` / `WebSocket` /
  `EventSource` / `sendBeacon` in production, and declared by a strict
  Content-Security-Policy (`src/lib/csp.ts`).
- Do **not** add analytics, telemetry, remote fonts/scripts/images, crash
  reporters, "cloud sync", or any call to an external origin. Such a PR will be
  declined (and would trip the guard at runtime anyway).
- Imports come from files the user picks; exports are local downloads. Keep it
  that way.

## Development

Requires Node 22+. [`docs/DEVELOPING.md`](docs/DEVELOPING.md) has every
script, the architecture and the project layout.

```bash
npm install
npm run dev         # Vite dev server, http://localhost:5173
```

The dev server intentionally disables the CSP meta, the netguard and the
service worker so Vite HMR works. To exercise the real local-first enforcement
and offline support, run a production build (`npm run build && npm run preview`)
and `npm run e2e:preview`.

## Before you open a PR

Run the same gates CI runs — all must pass:

```bash
npm run lint && npm test && npm run build && npm run e2e && npm run e2e:preview
```

- Add or update tests for any logic change (we prefer too many tests to too few).
- Keep the diff focused; one logical change per PR.
- Match the existing code style — Prettier + ESLint are configured
  (`npm run format` applies Prettier).
- If you change the UI, refresh the guide's pictures with
  `npm run docs:screenshots` (with `npm run dev` running) and check the guide in
  [`docs/guide/`](docs/guide/) still describes it.
- Update `CHANGELOG.md` under `## [Unreleased]` for user-facing changes.

## Project layout

See [`docs/DEVELOPING.md`](docs/DEVELOPING.md#project-layout). In short:
`model/` (types, schema, validation), `store/` (Zustand + command history),
`canvas/` (SVG rendering, projections), `rack/` (Rack Designer), `io/`
(import/export), `persistence/` (IndexedDB / File System Access / Web Locks),
`ui/`, `lib/`.

## Commit messages

Conventional-ish prefixes are appreciated: `feat:`, `fix:`, `docs:`, `chore:`,
`test:`, `refactor:`. Keep the subject under ~72 chars.

## Reporting bugs / proposing features

Use the issue templates under `.github/ISSUE_TEMPLATE`. For security, see
[`SECURITY.md`](SECURITY.md) — do not open a public issue for vulnerabilities.
