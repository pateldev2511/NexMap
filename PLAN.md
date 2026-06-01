<!-- /autoplan restore point: /Users/dev/.gstack/projects/pateldev2511-NexMap/main-autoplan-restore-20260531-222417.md -->
# NexMap — Implementation Plan (reviewed)

> Source of truth for scope: `Project NexMap.md`. This plan turns that spec into a
> concrete MVP. Reviewed via `/autoplan` (CEO + Design + Eng voices). Decisions and
> findings are logged in the Decision Audit Trail at the bottom.

## 0. Wedge & Premises (added by review)

**Wedge thesis:** NexMap is *the diagram that validates itself.* No incumbent gives a
network engineer instant, free, no-login feedback ("duplicate IP", "IP outside subnet",
"trunk missing VLAN", "dangling link") **while they draw**. draw.io is dumb pixels;
NetBox is authoritative but server-bound with no canvas. NexMap = draw.io for people who
get yelled at for a wrong subnet. **Every MVP feature is subordinate to making the
validate-while-you-draw loop feel magical.** If a feature doesn't serve that loop or the
local-first/data-ownership promise, it waits.

**Load-bearing premises** (stated so we can be wrong on purpose, not by accident):
1. Network engineers/designers/students want a no-login local tool. (Confidence: med. Validate: usage + interviews.)
2. Live semantic validation is worth switching tools for. (Confidence: med — this is the wedge bet.)
3. The MVP user designs *new* topology manually (vs documenting existing infra via import). **Chosen: design-first.** Discovery imports (Nmap/LLDP/NetBox) stay Post-MVP.
4. A browser canvas is the right form factor. (Confidence: high.)
5. Files-as-collaboration is acceptable for the solo/handoff user. (Teams = out of scope.)

## 1. Tech Stack

- **React 18 + TypeScript**, built with **Vite**. **Vitest** + Testing Library for unit/component, **Playwright** for E2E.
- **Rendering**: SVG scene graph, built in-house (chosen over adopting React Flow/tldraw — see audit DA-2). The SVG-at-scale risk is real, so the renderer is built behind a `SceneSource` interface with a spatial index, LOD, and a hybrid interaction layer from day one (§3, §7).
- **State**: Zustand store holding the project model + a command/undo stack. The model slice is the **single writer** — UI dispatches commands, never raw `setState` (audit DA-A2).
- **Local storage**: IndexedDB (`idb`) for autosave/recovery/recent; localStorage for small prefs; File System Access API for direct `.nexmap` read/write with download/upload fallback; **Web Locks API** for multi-tab single-writer (audit DA-E2).
- **Workers**: Web Workers for import/export/validation/layout **and autosave serialization** (audit DA-P3), with main-thread fallback.
- **Libraries**: `papaparse` (CSV), `jspdf` + `svg2pdf` (PDF, known-feature subset), `DOMPurify` (SVG sanitize, SVG profile), `fflate` (zip), `nanoid` (IDs).

## 2. Architecture

```
src/
  model/      types.ts schema.ts migrate.ts validate.ts   # pure TS, no React
  store/      projectStore.ts commands.ts history.ts       # Zustand + command pattern (single writer)
  lib/        geometry.ts ipcidr.ts spatial-index.ts file.ts  # pure leaf; spatial-index = keystone
  canvas/     renderer (SVG) viewport selection snapping guides minimap toolbar  # reads SceneSource only
  persistence/ indexeddb.ts fsaccess.ts recovery.ts locks.ts
  io/ import/ (detect→parse→preview→map→validate→draft→commit) export/ (png jpg svg pdf csv nexmap) workers/
  ui/ TopBar/ LeftSidebar/ Inspector/ BottomPanel/ dialogs/ firstrun/
  App.tsx main.tsx
```

**Module rules (audit DA-A2/A3):**
- `store/` is the only writer to model state; mutations go through `dispatch(command)`.
- `canvas/` consumes a `SceneSource` read interface (`getVisibleObjects(viewport)`, `subscribe(cb)`) — it never imports Zustand. Hit-testing uses `lib/spatial-index`, **never `event.target`**, so the renderer stays swappable and snapping/culling reuse the same index.

**Command pattern (audit DA-A1):** `Command { apply(state); invert(state): Command }` plus `transaction(label)` that batches sub-commands into one history entry, and `mergeWith(prev)` to coalesce drag streams. Inverse-based, with a full-state snapshot checkpoint every N entries to bound undo-replay cost. Lands in **M1**, before M2 consumes it.

**Core invariants:** stable IDs (`nanoid`); links reference IDs not names; unknown/future fields preserved via a per-object `extra` bag (audit DA-D1); import is transactional (build draft → validate → single atomic commit, audit DA-T2); export generated from the model.

**In-memory model is normalized** (audit DA-D2): `Record<id, T>` maps + a device→links adjacency index, maintained by the command layer. The `.nexmap` file stays array-based per spec.

## 3. Data Model

Top-level `.nexmap` matches the spec JSON: `schemaVersion`, `appVersion`, `project{}`,
`views[]`, `layers[]`, `objects[]`, `links[]`, `devices[]`, `interfaces[]`, `vlans[]`,
`subnets[]`, `racks[]`, `assets[]`, `customFields[]`.

**MVP link granularity (resolved, audit DA-CEO-F7):** links connect **devices**, with an
optional free-text interface label. `interfaces[]` exists in the schema but is an optional
layer activated Post-MVP. MVP validations operate at device-IP level.

**Migrations (audit DA-D1):** `migrations: Record<fromVersion, (doc)=>doc>` applied in
sequence, each with a fixture test. **Newer-than-supported schema → refuse to edit, offer
read-only / "update the app". Never silent load-and-resave** (data-safety hard rule).
Unknown fields preserved through load→save via per-object `extra` bag.

## 4. MVP Scope

The spec's MVP list, reframed around the validation wedge:
1. Local app, no login; offline after load.
2. New / Open / Save / Autosave (IndexedDB, worker-serialized) + crash recovery.
3. Native `.nexmap` import & export (FS Access API + download fallback).
4. Device library (common network objects) — drag to canvas.
5. Canvas: drag, drop, pan, zoom, select, box-select, connect, delete, snap-to-grid.
6. Properties inspector (device + link), grouped, ~8-field MVP subset, undoable.
7. Basic layers (show/hide/lock).
8. Bottom panel: Inventory, Links, Validation, Import-results tabs only (audit DA-DES-4.2).
9. Export: PNG, JPG, SVG, PDF (PDF = single-page vector subset for MVP; tiling/appendices deferred).
10. CSV import for devices and links (preview → map → validate → draft → commit → summary).
11. CSV export for inventory and links.
12. **Validation (the wedge): duplicate IPs, invalid CIDR, missing link endpoints, duplicate names — live, debounced, with canvas badges + panel + jump-to-object.**
13. Undo / redo.
14. Import preview & error report.
15. **First-run experience** (audit DA-DES-1.3): start screen (Blank / Template / Open / Recent) + 2-3 starter templates + empty-canvas hint.

**Cut from MVP → Post-MVP** (logged in TODOS.md): rack mode, cloud objects/validations,
advanced auto-layout, multi-view, all discovery imports (GraphML/draw.io/VSDX/NetBox/
Terraform/Nmap/LLDP), wireless, project diffing, presentation mode, zip package,
**connector obstacle-avoidance routing** (audit DA-ENG-H2, multi-week), **multi-page PDF +
inventory/IP/validation appendices** (audit DA-ENG-H1, multi-week — but the appendix PDF is
the real MSP artifact, do it properly later).

## 5. UX Decisions (added by Design review)

- **Hierarchy:** canvas is primary (~70% pixels, high contrast); side panels recessive; bottom panel collapsed by default. Default widths: left 240px, right 300px, bottom 0. All side panels collapsible.
- **Library:** category accordions; a "Common" group (router, switch, firewall, AP, server, end-user, cloud, generic) expanded by default; Recently-used/Favorites appear once populated; icon+label grid. Empty-search state has copy + "create custom template".
- **Connect interaction (audit DA-DES-3.1):** hover a device → anchor handles → drag to target (no mode needed, discoverable) **plus** a Connect tool (`C`/`L`) for repeated linking. Crosshair cursor, source highlight, rubber-band, valid-target highlight, Esc cancels.
- **Pan/zoom (audit DA-DES-5.1):** scroll / two-finger = pan; Cmd/Ctrl+scroll or pinch = zoom (cursor-anchored); Space+drag = pan fallback. Zoom 10%–400%. Fit-to-screen has padding.
- **Gesture conflicts (audit DA-DES-5.2):** Select mode — drag empty = box-select, drag object = move, Space+drag = pan. Shift adds to selection.
- **Snapping (audit DA-DES-3.2):** grid 16px, snap threshold 6px, hold Alt to suspend. Alignment guides reuse the spatial index (not free — scheduled in M2 only if the index makes them cheap).
- **Hit targets (audit DA-DES-3.3):** links get a ~10px invisible hit stroke; devices a min clickable footprint; alt/repeat-click cycles stacked objects.
- **LOD (audit DA-DES-3.4 / ENG-P2):** below a zoom threshold, hide secondary labels (IP/VLAN/bandwidth) then device labels → icons only. Part of the M2 render loop, also a perf win.
- **Drag-from-library drop:** snap to grid at cursor, auto-select, open inspector with name field focused.
- **Canvas mode toolbar (audit DA-DES-5.4):** floating toolbar, mode buttons + shortcuts (V/C/T...), active mode indicated, Esc → Select.
- **States specified (audit DA-DES-2.x):** empty (canvas/search/each tab), loading (cold-load skeleton, recovery spinner), reusable progress affordance (determinate bar + Cancel) for import/export/validation, recovery dialog (shows project/time/object-count, three-way Recover/Discard/Keep-both), multi-tab read-only banner + Take-over.
- **Visual system (audit DA-DES-4.3):** single consistent line/duotone icon set (not mixed vendor logos) for MVP; token palette with explicit dark/light; 4 validation-severity colors each paired with a non-color glyph.
- **Accessibility stance (audit DA-DES-6.1, honest):** full keyboard + SR for all chrome (top bar, library arrow-nav + Enter-to-add-at-center, inspector real form fields, bottom-panel tables). **The Inventory/Links tables are the canonical accessible view of the diagram** — SR users work the table, not the canvas. Canvas gets keyboard select (Tab/arrow), arrow-nudge, Enter-to-edit, connect-selected-to-next command. Visual layout is mouse-primary; we say so. Reduced motion, contrast, non-color validation glyphs, 80–200% zoom all kept.

## 6. Milestones

- **M0 — Scaffold + perf harness:** Vite/React/TS, lint/format, folder structure, app shell with hierarchy (canvas-primary, panels collapsible). **Build the SVG perf harness here** (audit DA-P1): render synthetic 1k/5k/10k projects, measure pan/zoom/select frame time on a mid laptop. The renderer design follows the numbers.
- **M1 — Model + Store + lib:** types, schema, factories, migrations + fixtures, validation engine, Zustand store, **command/transaction/coalesce + history (single writer)**, `lib/spatial-index`, ip/cidr math. Unit + property tests for undo/redo, ip/cidr, migrations.
- **M2 — Canvas core:** SVG viewport (pan/zoom/fit per §5), `SceneSource` interface, spatial-index hit-testing, LOD, render devices/links, select + box-select + multi-select, drag-move (coalesced), delete (cascade links transactionally), snap-to-grid, mode toolbar, library drag-to-create.
- **M3 — Inspector + Connect + first-run:** grouped inspector (MVP field subset, undoable), connect interaction (hover-handle + C tool), inline title edit, unsaved indicator, first-run start screen + 2 starter templates + empty-canvas hint.
- **M4 — Persistence:** worker-serialized IndexedDB autosave (debounced) + last-saved status, recovery dialog, `.nexmap` save/open (FS Access + fallback with explicit fallback-save UX), recent projects, Web Locks multi-tab, quota-exceeded write-new-then-swap.
- **M5 — Validation + Inventory (the wedge):** wire the 4 validations live (debounced), canvas badges (color + glyph), Validation panel, Inventory + Links tables, jump-to-object, re-run after edits.
- **M6 — Import:** CSV device/link import, full flow (build-draft → validate → atomic commit → summary). Edge cases: BOM, quoted commas, delimiters, dup names, links-before-devices, corrupt/empty, prototype-pollution key stripping. DOMPurify (SVG profile, strip external refs + foreignObject) for any SVG path. Fault-injection rollback test gates this milestone.
- **M7 — Export:** PNG/JPG (scale, bg, transparency), SVG (sanitized, text option, ID round-trip), single-page vector PDF (svg2pdf, known-feature subset; probe max canvas size before raster paths), CSV export (formula-injection guard). Export options panel + scope + clipping warnings + progress/cancel.
- **M8 — Polish & a11y:** keyboard shortcuts, focus states, contrast, reduced motion, theme toggle, tablet drawers, visual-system pass, perf pass against M0 harness numbers.

## 7. Performance Strategy (hardened by Eng review)

Target re-baselined: most real diagrams are <200 nodes; we engineer for smooth interaction
to ~1,000 devices and degrade gracefully above. Mechanisms: model/render separation,
scoped selectors, `lib/spatial-index` quadtree for hit-test + cull + snap, **LOD** to kill
the fit-to-screen worst case (the real SVG killer), batched updates, debounced validation,
worker IO **including autosave serialization** (diff/delta persistence, not full snapshots
at scale). The M0 harness validates this before M2 writes the real renderer. If the harness
fails the bar, the `SceneSource` interface + spatial index mean a Canvas-2D static layer can
be added under the same contract without rewriting selection/snapping.

## 8. Security & Privacy (hard requirements, hardened)

No login, no uploads, no remote sync, no analytics by default. **SVG import:** DOMPurify with
SVG profile, **strip all external references unconditionally** (no "user confirms" path —
external refs break the never-phones-home promise), strip `foreignObject`/`script`/handlers;
prefer SVG→model conversion over DOM injection. **CSV export:** prefix formula-trigger cells
(`= + - @` / tab / CR). **Image import:** size-cap decoded dimensions to prevent decompression
bombs. **JSON import:** strip `__proto__`/prototype-pollution keys. Never `eval` imported
content. Errors never include project contents unless the user exports diagnostics. In-app
messaging that data is local + warnings about cache-clear and private-window data loss.

## 9. Testing (hardened)

- **Unit/property (Vitest):** undo/redo property test (random ops, undo-all === initial, coalesced drag = one entry); ip/cidr property tests + IPv6 + boundary CIDRs + overlap detection; migration fixtures per version + newer-schema-refuses test + unknown-field round-trip; validation rules; CSV parse/map.
- **Fault injection:** import rollback (throw after K of N → project byte-identical to pre-import); quota-exceeded autosave; crash-mid-write recovery loads last complete generation.
- **Security:** malicious-SVG fixtures; sanitize round-trip (import malicious SVG → export → re-scan, no script survives); CSV formula-injection on export.
- **Component (Testing Library):** inspector edits, library drag-create, dialogs, recovery prompt.
- **E2E (Playwright):** build topology, save→reload→recover, import CSV, export PNG, multi-tab Web Locks single-writer.
- **Manual QA** via `/qa` before each milestone close.

## 10. Risks & Open Questions

- **SVG at scale (highest risk, user chose scratch SVG):** mitigated by M0 harness + spatial index + LOD + SceneSource escape hatch. If the harness fails, add a Canvas-2D static layer behind SceneSource.
- **PDF fidelity:** MVP = single-page vector, known-feature subset (no filters/masks in canvas style so they survive svg2pdf). Appendix/tiling PDF done properly Post-MVP.
- **FS Access fallback cliff:** on Firefox/Safari, Ctrl+S can't write back to the original file — every save is a new download. M4 specifies this UX explicitly (dirty flag + reminder), not discovered late.
- **Validation wedge must actually feel instant:** debounce + worker; if validation lags the draw loop, the entire thesis weakens. Watch this in M5.

## 11. Definition of Done (MVP)

Build a validated topology locally with no login; live validation flags dup IP / invalid CIDR
/ missing endpoints / dup names as you draw; close/reopen browser without losing autosaved
work; save/reopen `.nexmap`; import device/link CSV with mapping + validation + rollback;
export PNG/JPG/SVG/single-page-PDF; smooth interaction to ~1,000 devices; import errors never
corrupt the project; newer-schema files refuse rather than corrupt; app clearly communicates
data is local and user-owned.

---

## Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| DA-1 | CEO | MVP wedge = self-validating diagram | **USER** | — | User chose: design+validate loop is the moat draw.io/NetBox can't match. |
| DA-2 | CEO/Eng | Canvas engine = build SVG from scratch | **USER** | — | Both models recommended adopting React Flow/tldraw; user chose scratch for control. Mitigations (DA-P1/P2) made mandatory. |
| DA-3 | CEO | Export = all four formats in MVP | **USER** | — | Models recommended PNG+SVG only; user kept all four. MVP PDF scoped to single-page vector. |
| DA-CEO-F7 | CEO | MVP links connect devices (+ optional iface label); interfaces[] Post-MVP | Taste→auto | P5 explicit | Resolves model/validation inconsistency without ballooning scope. |
| DA-CEO-F3 | CEO | Discovery imports stay Post-MVP (design-first MVP) | auto | P6 | Follows from wedge choice (design-first). |
| DA-A1 | Eng | Inverse-based commands + transaction() + mergeWith coalesce + snapshot checkpoints | auto | P5 | Named-not-designed → specified; lands M1 before M2. |
| DA-A2 | Eng | Store = single writer; UI dispatches commands only | auto | P5 | Prevents undo-stack corruption via raw setState. |
| DA-A3 | Eng | Renderer reads SceneSource interface, never imports Zustand | auto | P5 | Keeps renderer swappable; enables escape hatch. |
| DA-P1 | Eng | Perf harness moved to M0 (before renderer) | auto | P1 | Validate highest-risk assumption first, data-driven renderer. |
| DA-P2 | Eng | lib/spatial-index quadtree; hit-test never uses event.target; LOD | auto | P1 | Keystone for hit-test/snap/cull + makes Canvas-2D swap viable. |
| DA-P3 | Eng | Autosave serialization in worker; diff/delta persistence | auto | P1 | Avoids main-thread jank at scale. |
| DA-E1 | Eng | Persist bounded history tail; pause autosave mid-undo | auto | P1 | Fixes autosave-during-undo corruption. |
| DA-E2 | Eng | Web Locks API for multi-tab single-writer; BroadcastChannel for UX only | auto | P1 | Real concurrency control vs racy "prefer read-only". |
| DA-E3 | Eng | Quota-exceeded → write-new-then-swap, never overwrite in place | auto | P1 | No data loss on full IndexedDB. |
| DA-D1 | Eng | Migration registry + fixtures; newer-schema refuses (read-only); unknown-field extra bag | auto | P1 | Data-safety: never silent resave that drops fields. |
| DA-D2 | Eng | Normalized in-memory maps + device→links adjacency index | auto | P3 | O(1) lookups vs O(n) scans at 5k links. |
| DA-T2 | Eng | Import = build-draft → atomic commit (single undo entry) | auto | P5 | Makes rollback real and testable. |
| DA-S1 | Eng | DOMPurify SVG profile; strip external refs unconditionally; strip foreignObject | auto | P1 | Privacy product: external refs break never-phones-home. |
| DA-S2 | Eng | CSV formula-injection guard on export | auto | P1 | Real export threat, absent from spec. |
| DA-S3 | Eng | Image decompression-bomb size cap; JSON prototype-pollution key strip | auto | P1 | Closes import threat-model gaps. |
| DA-T1 | Eng | Gating tests: import-rollback fault injection, undo/redo property, migration fixtures, sanitize round-trip | auto | P1 | The tests that catch 2am-Friday corruption. |
| DA-DES-1.3 | Design | First-run start screen + 2-3 starter templates + empty-canvas hint | auto | P1 | Biggest UX gap; cheap high-impact fix. |
| DA-DES-2.x | Design | Specify empty/loading/recovery/multi-tab/inline-validation states | auto | P1 | Prevents badly-improvised states. |
| DA-DES-3.1 | Design | Connect = hover-handle + C tool, full cursor/rubber-band feedback | auto | P5 | The defining interaction; one sentence → specified. |
| DA-DES-5.1 | Design | Pan/zoom: scroll=pan, Cmd-scroll/pinch=zoom (cursor-anchored), Space+drag fallback | auto | P5 | Matches modern tools; trackpad-friendly. |
| DA-DES-5.2/5.4 | Design | Canvas mode toolbar + gesture-conflict rules | auto | P5 | Core chrome was absent. |
| DA-DES-3.2/3.3/3.4 | Design | Grid 16/snap 6/Alt-suspend; inflated hit areas; LOD labels | auto | P1 | Canvas feel + legibility at scale. |
| DA-DES-4.1/4.2 | Design | Inspector grouped, ~8-field MVP subset; bottom tabs = Inventory/Links/Validation/Import | auto | P5 | Prevents 20-field wall + 8-empty-tab clutter. |
| DA-DES-4.3 | Design | Single line/duotone icon set, token palette, 4 severity glyphs | auto | P1 | Visual system IS the product for a diagram tool. |
| DA-DES-6.1 | Design | Honest a11y: tables = canonical accessible view; chrome fully accessible; canvas mouse-primary | auto | P1 | Stops a11y from being a token pass. |
| DA-ENG-H1 | Eng | MVP PDF = single-page vector; tiling + appendices Post-MVP | auto | P3 | Multi-page doc engine is multi-week; don't fake it in MVP. |
| DA-ENG-H2 | Eng | MVP connectors = straight + simple elbow, no obstacle avoidance | auto | P3 | A*/visibility-graph routing is multi-week; defer. |

## Review Scores

- **CEO:** PARTIAL→resolved. Wedge defined (DA-1), premises stated (§0), scope recalibrated. Build-from-scratch + all-4-exports kept as user challenges.
- **CEO voices:** Codex [unavailable — not installed], Claude subagent [8 findings, 2 critical]. Consensus: single-voice.
- **Design:** initial 3.3/10 design-readiness → gaps closed in §5 (first-run, connect, pan/zoom, toolbar, states, visual system, a11y).
- **Design voices:** Codex [unavailable], Claude subagent [scorecard avg ~3.3/10, first-run = 2/10 biggest gap]. Consensus: single-voice.
- **Eng:** PARTIAL→hardened. Command/transaction contract, single-writer, SceneSource, spatial index, migration safety, multi-tab locks, security gaps, gating tests all specified.
- **Eng voices:** Codex [unavailable], Claude subagent [~20 findings, 2 critical = SVG-at-scale + escape-hatch viability]. Consensus: single-voice.
- **DX:** skipped — no developer-facing scope (end-user app, not SDK/CLI/API).

## NOT in scope (MVP)

Rack mode, cloud objects/validations, advanced auto-layout, multi-view, discovery imports
(GraphML/draw.io/VSDX/NetBox/Terraform/Nmap/LLDP), wireless coverage, project diffing,
presentation mode, zip export package, connector obstacle-avoidance routing, multi-page PDF +
appendices, full interfaces[] layer, teams/collaboration. All logged in TODOS.md.

## What already exists

Greenfield. Remote repo `pateldev2511/NexMap` contains only LICENSE. No code to reuse;
no migration burden. The from-scratch decision (DA-2) means the canvas/selection/snapping
plumbing is all new — the largest source of MVP effort and risk.
