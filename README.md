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

## What it does

**Canvas & editing.** Drag devices from the library, connect them, pan/zoom,
box-select, lasso-select, multi-drag, snap-to-grid, level-of-detail at scale, copy/
cut/paste, grouping, z-order, lock, keyboard nudge, context menus, text notes and
zone/shape annotations, image/SVG background underlays. Floating tool palette
(Select / Lasso / Pan / Connect / Text / Zone). Undo/redo throughout.

**Connectors.** Editable connectors with waypoints + reroute handles, arrowheads,
solid/dashed styles, orthogonal elbow routing, parallel-link fan-out, multi-labels
(name / bandwidth / VLAN / native VLAN / LACP / circuit ID + endpoint interfaces),
click-to-connect or drag-to-connect.

**Live validation (the wedge).** Duplicate IPs, invalid CIDR/IP, missing endpoints,
duplicate names, overlapping subnets, VLAN range/duplicate, IP-outside-subnet,
missing gateway, rack RU collision/overflow, trunk/access mismatch, orphaned
devices — flagged on the canvas + the Validation panel as you edit; click to jump.

**Network semantics.** First-class VLANs, subnets, racks; device rack-placement;
IP Plan / VLANs / Racks / Inventory / Links panels.

**Views & layers.** Layer management (visibility/lock/reorder/active), multi-view
saved perspectives, rack elevation view, presentation/read-only mode, page
boundaries for print.

**Local persistence.** Debounced IndexedDB autosave + crash recovery; multi-tab
single-writer via Web Locks; `.nexmap` save/open via File System Access with
download fallback; newer schema is refused rather than silently re-saved.

**Import.** CSV (devices/links/IP-plan/VLANs), GraphML, uncompressed draw.io XML,
topology JSON, NetBox CSV/JSON, Nmap XML (OS-inferred types), image/SVG underlays
— all previewed before commit and transactional (Cancel changes nothing; Undo
reverts the committed import).

**Export.** PNG / JPG / SVG / PDF + CSV, plus a ZIP package (`.nexmap` + images +
PDF + CSVs + validation report). Live preview, crop-to-selection, DPI slider,
transparency. Built from the model; SVG/CSV sanitized.

**Offline & hardening.** Installable PWA with an offline service worker; settings
(theme, connect behavior, reduced motion); storage diagnostics + clear-data;
browser-capability warnings; keyboard shortcuts (press `?`); light/dark themes.

## Isometric view

Toggle the canvas between **flat (2D)** and **isometric (2.5D)** from the toolbar
(`◈`). Iso renders your network as 3-D blocks on a diamond grid with upright,
readable labels and a coherent pictographic icon set — presentation-grade output —
while the model stays flat and editable underneath (drag, connect, select, and
align all work in iso). Exports (PNG/JPG/SVG/PDF) honor the active projection, and
each saved view remembers whether it's flat or iso.

## Direction

NexMap's moat is **validate-as-you-draw**, and it leads FossFLOW on validation,
import/export breadth, layers, racks, and data safety — now matched by an
isometric aesthetic of its own. Editor feel follows draw.io conventions
(right-drag to pan, click-to-isolate, drag threshold). See `TODOS.md` (Phases 8–9,
both complete) for the roadmap and remaining stretch ideas.

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
  io/         import (CSV/GraphML/draw.io/JSON/NetBox/Nmap/media) and export
              (SVG/PNG/JPG/PDF/CSV/ZIP)
  ui/         top bar, library, inspector, bottom panel, dialogs, first-run
```

Key invariants: every object has a stable ID; links reference IDs (never names);
the model is the single writer through commands; exports come from the model;
unknown future fields survive load→save. See `PLAN.md` for the full design and
`TODOS.md` for the shipped phase map plus remaining low-priority work.

## Stack

React 18 · TypeScript · Vite · Zustand · Vitest. PDF via jsPDF (lazy-loaded).
Built dependency-light on purpose — it should keep working offline, forever.
