# NexMap

**The network diagram that validates itself.** A local-first, no-login browser app
for designing, documenting, validating, importing, and exporting network
infrastructure diagrams. Open it, draw your topology, and get instant feedback —
"duplicate IP", "invalid CIDR", "missing link endpoint" — while you work.

No accounts. No cloud. No upload. Your project data stays on your machine.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build
npm test           # unit + property tests (Vitest)
npm run lint       # ESLint
```

## What it does (MVP)

- **Canvas** — drag devices from the library, connect them, pan/zoom, box-select,
  multi-drag, snap-to-grid, fit-to-screen, level-of-detail at scale.
- **Live validation** (the wedge) — duplicate IPs, invalid CIDR/IP, missing link
  endpoints, duplicate names, flagged on the canvas and in the Validation panel as
  you edit. Click an issue to jump to the object.
- **Properties inspector** — grouped, undoable device/link fields with inline
  validation.
- **Local persistence** — debounced autosave to IndexedDB with crash recovery on
  next launch; multi-tab single-writer via the Web Locks API.
- **Files** — save/open `.nexmap` (JSON) via the File System Access API, with a
  download/upload fallback. Newer-than-supported files are refused rather than
  silently re-saved (no data loss).
- **Import** — CSV device/link import with header auto-mapping, preview, warnings,
  and transactional commit (a bad import never half-corrupts your project; Undo
  reverts the whole thing).
- **Export** — PNG, JPG, SVG, single-page PDF, and CSV (inventory/links), all built
  from the model. Exported SVG/CSV are sanitized (no scripts, formula-injection
  guarded).
- **Undo/redo, templates, keyboard shortcuts** (press `?`), light/dark themes.

## Where your data lives

- **IndexedDB** — autosaved drafts and recovery snapshots.
- **localStorage** — small preferences (theme).
- **`.nexmap` files** — wherever you save them on disk.

Clearing browser data deletes local autosaves — export a `.nexmap` file to keep a
project safe. Private/incognito windows may lose local data on close.

## Architecture

```
src/
  model/      pure types, schema, migrations, validation (no React)
  store/      Zustand store + inverse-based command/undo stack (single writer)
  lib/        ip/cidr math, spatial index (hit-test/cull/snap), CSV parser
  canvas/     SVG renderer (reads a SceneSource interface, not the store directly)
  persistence/ IndexedDB autosave, FS Access save/open, Web Locks, recovery
  io/         import (CSV) and export (SVG/PNG/JPG/PDF/CSV)
  ui/         top bar, library, inspector, bottom panel, dialogs, first-run
```

Key invariants: every object has a stable ID; links reference IDs (never names);
the model is the single writer through commands; exports come from the model;
unknown future fields survive load→save. See `PLAN.md` for the full design and the
`/autoplan` review that shaped it; `TODOS.md` for deferred Post-MVP work.

## Stack

React 18 · TypeScript · Vite · Zustand · Vitest. PDF via jsPDF (lazy-loaded).
Built dependency-light on purpose — it should keep working offline, forever.
