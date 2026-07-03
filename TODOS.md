# NexMap — Master Roadmap

> Phased roadmap to make NexMap a polished, FossFLOW-**inspired** (not a clone)
> local network designer, while keeping its identity: **no login, no accounts, no
> server storage, no hidden cloud sync.** Each phase must keep existing behavior
> green before the next is accepted. Replaces the old MVP-deferral list.

**Non-negotiable constraint (all phases):** no login, no cloud, no hidden upload.
Data stays local (IndexedDB + `.nexmap` files) unless the user explicitly exports.

---

## Strategic direction — Path C (chosen 2026-06-03)

After a competitive teardown against FossFLOW (Isoflow lineage), NexMap already
beats it on validation, import/export breadth, layers, racks, and data safety.
FossFLOW's only real edge is its **isometric aesthetic** and frictionless feel.

**Path C = sequence the bet.** First close the daily-driver editor-polish gaps
that make the flat editor feel unfinished (Phase 8). *Then* add an **isometric
view mode** on top of the existing flat model as the v2 headline feature
(Phase 9) — a re-projection toggle, not a rewrite, leveraging the `SceneSource`
indirection so the model stays flat and editable.

Identity is unchanged: the moat is **validate-as-you-draw**; isometric is polish
on top, never a replacement for correctness.

---

## Phase 8 — Editor Polish (daily-driver friction)  ✅ COMPLETE (checkboxes synced 2026-07-03; every item verified in code by the CEO review)

Closes the power-user gaps surfaced by the expert review. Each item keeps existing
behavior green and is undoable where it mutates the model.

- [x] **P0 Alignment guides + smart snap** ✅ — `canvas/align.ts` (computeAlignSnap
      + equal-spacing snap beyond spec), wired into store dragTo, guide lines
      rendered; 12 tests in align.test.ts.
- [x] **P0 Inline text editing** ✅ — dbl-click overlay editor on canvas, commit on
      blur/Enter as one undoable update (Canvas.tsx).
- [x] **P0 Resize handles** ✅ — 8 handles, MIN_OBJ_SIZE=16 clamp, one undoable
      endResize commit.
- [x] **P1 Align & distribute** ✅ — AlignBar (6 align + 2 distribute) via store
      alignSelection/distributeSelection, one undo each.
- [x] **P1 Canvas search (⌘F)** ✅ — CanvasSearch.tsx, find by name/IP/role,
      jump-to + select.
- [x] **P1 Zoom-to-selection** ✅ — key `2` + zoom-bar button.
- [x] **P1 Drag/resize readout** ✅ — live x/y during drag, w×h during resize.
- [x] **Click/drag refinement** ✅ — selection now resolves on RELEASE: a click
      isolates one item out of a multi-selection, shift-click toggles off, and a
      4px movement threshold means clicks never accidentally move/nudge a device.
      Marquee/lasso are pure visual overlays (`pointer-events: none`) so they can't
      swallow clicks; Esc clears an in-flight marquee/lasso.
- [x] **draw.io-style pointer parity** ✅ — right-drag (and middle-drag) pans
      anywhere; right-click without dragging still opens the context menu (trailing
      contextmenu suppressed only after an actual pan); `move` cursor over cells.
      Fixed a latent bug where gestures captured the wrong element (parent div),
      which had silently broken drag-panning, marquee, lasso, resize, and link
      rubber-banding — all now capture the SVG and track correctly; pointer-capture
      calls are wrapped so a stray throw can't abort a gesture.
- Deferred to a later polish pass: connector-label drag-reposition, save-in-place
      UX clarity on Firefox/Safari, first-class `interfaces`/`assets`/`customFields`.

## Phase 9 — Isometric View Mode (v2 headline)  🚧 IN PROGRESS

Add an isometric projection of the existing flat model. The model stays flat and
canonical; isometric is a **render/edit mode**, toggled per view.

- [x] **9.1 Projection core** ✅ — pure iso transform (`canvas/iso.ts`): flat
      (x,y)→screen diamond mapping + inverse for hit-testing; configurable tile
      size (2:1 default); painter's-depth key; 12 round-trip unit tests.
- [x] **9.2 Iso grid + camera** ✅ — toolbar flat/iso toggle; diamond lattice
      grid; whole scene projected via one linear SVG matrix; iso-aware pointer
      hit-testing, drag (linear inverse), marquee/lasso, fit-to-screen, jump-to,
      and culling; view-level `projection: 'flat' | 'iso'` flag (optional, defaults
      flat, captured/restored by saved views). Interim: rects/labels shear — 9.3
      replaces device tiles with upright 3D rendering + crisp labels.
- [x] **9.3 Iso device rendering** ✅ — devices render as UPRIGHT iso tiles
      (`IsoDeviceNode`): projected footprint diamond + extruded depth skirt
      (shaded accent faces) + upright glyph badge + crisp upright label, in a
      non-sheared layer at projected coords; painter's z-order by (x+y); LOD;
      iso connect-handle. Footprint == projected flat box so hit-testing stays
      exact. (Text-annotation objects still shear → folded into 9.4/9.5 polish.)
- [x] **9.4 Iso editing** ✅ — drag/snap, place-from-library, connect,
      select/marquee/lasso, double-click-to-edit, and inline text editor all work
      in iso via the linear inverse projection (built across 9.2–9.4). Text
      annotations render UPRIGHT (`IsoTextNode`) instead of shearing; resize
      handles suppressed for upright text; Esc clears in-flight marquee/lasso.
      (Remaining shear: shape/zone *labels* — minor, deferred to 9.5.)
- [x] **9.5 Iso connectors** ✅ — links route on the iso plane; connector
      multi-labels (name/bandwidth/VLAN/native/LACP/circuit), endpoint interface
      labels, and shape/zone labels all render UPRIGHT via an inverse-matrix
      counter-transform (de-shear in place, no extra layer). Hardening: label
      builders coerce non-string fields (numeric VLAN from imports no longer
      throws), and an ErrorBoundary now wraps the canvas so a render error shows a
      recoverable message instead of white-screening the app.
- [x] **9.6 Iso export** ✅ — PNG/JPG/SVG/PDF render the iso projection (all
      formats flow through `buildSvg`, which now has an iso branch: floor layer
      sheared by the iso matrix, device tiles + labels upright at projected
      coords, projected viewBox). Export dialog has an "Isometric view" toggle
      defaulting to the current canvas projection; live preview reflects it. Unit-
      tested (iso SVG emits the matrix group + tile polygons, differs from flat).
- [x] **9.7 Icon system** ✅ — a single coherent, pictographic line-art icon set
      (`DEVICE_ICONS`, 0–24 grid) covering all ~30 device types incl. cloud,
      replacing the letter badges. Rendered consistently across flat tiles, iso
      tiles, the library, and SVG/PNG/JPG/PDF export (shared `deviceIconGroup`
      string + `DeviceGlyph` React component). Letter glyph kept only as the
      tiny-zoom LOD fallback. Directly answers FossFLOW's #1 complaint (sparse /
      clashing iso icons) — one consistent set, every type.

**Phase 9 complete.** NexMap now has a full isometric view mode (toggle, grid,
camera, device tiles, editing, connectors, labels, export, and a coherent icon
set) layered on the flat, self-validating model — plus draw.io-style pointer
parity and an error boundary.

## Post-Phase-9 stretch

- [x] **Auto-layout ("tidy")** ✅ — one-click layered layout (`lib/layout.ts`):
      per connected component, root at the highest-degree node and layer by BFS
      depth (core → distribution → access → endpoints), then shelf-pack
      disconnected components into rows. Pure + deterministic (8 unit tests);
      `store.autoLayout()` commits as one undoable transaction and respects locks
      (3 store tests); toolbar `⊞` button + ⌘⇧L. Works in flat and iso.
- [x] **Isometric 3D icon engine** ✅ — replaced the flat/fake-layered glyphs with
      a true isometric solid engine (`deviceIso.ts`): volumetric primitives (iso
      box, cylinder, sphere, shaded top/left/right faces) composed into recognizable
      hardware — router = chassis + antennas, switch = rack box w/ ports, server =
      tower w/ bays, firewall = brick wall, storage/DB = drum, AP = puck + Wi-Fi
      arcs, cloud/globe/k8s specials, archetype + emblem for the long tail. Thin
      detail strokes; per-device gradient palette retained. Rendered via `IsoIcon`
      (canvas/library) + `deviceIsoGroup` (export), verified flat/iso/light/dark.
- [ ] Text/Mermaid-to-diagram input (auto-layout is the placement engine for it).
- [ ] Guided live-discovery import wizard.
- [ ] Obstacle-avoiding connector routing.

---

## Phase 0 — Audit & Baseline ✅ (recorded 2026-06-02)

**Current MVP status (M0–M8 shipped, on `main`):**
- Stack: React 18 + TS + Vite + Zustand; model-driven exports; `.nexmap` JSON.
- Canvas: SVG renderer via `SceneSource` + spatial index; pan/zoom (scroll=pan,
  Cmd-scroll=zoom), select, Shift-add, marquee box-select, multi-drag (one undo),
  snap-to-grid, LOD, fit-to-screen, delete.
- Edit: inverse-based command/undo stack (single writer), coalesced drags/edits,
  duplicate, select-all.
- Inspector: grouped device/link fields, inline IP/CIDR validation, undoable.
- Connect: hover-handle + Connect tool, rubber-band, valid-target highlight.
- Validation (the wedge, live + debounced): duplicate IP, invalid CIDR/IP, missing
  link endpoints, duplicate names; canvas badges + Validation panel + jump-to.
- Bottom panel: Inventory / Links / Validation tabs (collapsed by default).
- Persistence: IndexedDB autosave + crash recovery; `.nexmap` save/open (FS Access
  + download fallback); Web Locks multi-tab single-writer; newer-schema refuses.
- Import: CSV device/link with header auto-map, preview, warnings, transactional
  commit (single-undo). Parser handles BOM/quotes/delimiters.
- Export: PNG/JPG/SVG/single-page-PDF + CSV; from the model; SVG/CSV sanitized.
- Polish: first-run + templates, keyboard shortcuts (`?` help), light/dark.

**Working checks:** 82 unit/property/fault-injection tests green; `npm run build`
+ `npm run lint` clean. Browser smoke verified for canvas, validation, persistence,
import, export, shortcuts.

**FossFLOW feature-gap list (drives Phases 1–7):**
- No floating icon toolbar; only Select/Connect. No Pan/Text/Zone/Shape/Lasso tools.
- Devices are flat tiles; no isometric-inspired styling, no context menus.
- No copy/paste, grouping, z-order, lock/unlock, lasso, keyboard nudge.
- Links are plain lines: no waypoints, arrows, line styles, multi-labels, parallel spacing.
- Export dialog has no live preview / crop / DPI slider / ZIP package.
- Import lacks JSON/SVG-underlay/draw.io/GraphML/NetBox.
- Model lacks first-class interfaces/VLANs/subnets/zones/sites/racks/cloud.
- No real layers, multi-view, presentation mode, rack/cloud/discovery, PWA/offline.

---

## Phase 1 — Canvas Polish  ✅ COMPLETE

- [x] Edit ops: copy / cut / paste (offset, new IDs, transactional), lock/unlock,
      keyboard nudge (arrows; Shift = grid step) — drag/delete respect locked
- [x] FossFLOW-inspired floating icon toolbar: Select, Lasso, Pan, Connect, Text,
      Zone/Shape, Undo, Redo, Help (Add-Device = library drag; Freehand-lasso folded
      into Lasso)
- [x] Context menus (canvas / entity — copy/cut/dup/paste/lock/delete/group/z-order)
- [x] Grouping (group/ungroup, group-aware selection), z-order (front/back/forward/back)
- [x] Lasso selection (freehand polygon)
- [x] Text notes + Zone/Shape objects (new object types: create, render, select,
      move, lock, delete, inspector, export, round-trip)
- [x] Richer device visuals: depth shadow, hover outline, locked/error badges
- Remaining Phase-1 nice-to-haves (deferred, low priority): shape resize handles,
      full isometric styling, tablet gestures.

## Phase 2 — Connector System  ✅ COMPLETE
- [x] Editable connectors: waypoints, reroute handles, arrows, line styles,
  midpoint label, parallel-link spacing (fan-out)
- [x] Click-to-connect + drag-to-connect, with a persisted preferred-behavior setting
- [x] Multiple labels per connector (name, bandwidth, VLAN, native VLAN, LACP,
  circuit ID + source/target interface labels at endpoints)
- [x] Orthogonal (elbow) routing option
- Deferred (low priority): obstacle-avoiding auto-routing, curved/freeform links,
  per-segment orthogonal routing through waypoints.

## Phase 3 — Export & Import Upgrade  ✅ COMPLETE (IP/VLAN CSV → Phase 4)
- [x] Export dialog: live preview, crop-to-selection, custom filename, DPI/scale
  slider, transparent checkerboard preview
- [x] Export package ZIP: `.nexmap` + PNG + SVG + PDF + inventory CSV + links CSV +
  validation report
- [x] Import: CSV (devices/links), JSON (topology), draw.io, GraphML, NetBox CSV/JSON,
  SVG/image background underlays (sanitized)
- [x] Unsafe-SVG sanitization on import; transactional partial-rollback (single undo)
- [x] IP-plan + VLAN CSV import (header-detected; preview + single undo)
- Deferred (low priority): layer/view export scope, multi-page PDF pagination.

## Phase 4 — Network Semantics  ✅ CORE COMPLETE
- [x] First-class VLANs, subnets, racks (typed model, undoable CRUD, round-trip)
- [x] Validations: overlapping subnets, duplicate VLAN IDs, invalid VLAN ranges, IP
  outside subnet, missing gateway, trunk/access mismatch, orphaned devices, rack RU
  collisions + overflow
- [x] Bottom-panel tabs: IP Plan, VLANs, Racks (editable); device Rack-placement +
  link trunk/access in the inspector
- [x] IP-plan + VLAN CSV import (header-detected)
- Deferred (lower priority): first-class interfaces (link interface labels exist),
  dedicated zones/sites entities (zone fields exist), cloud networks (→ Phase 6),
  link bandwidth mismatch, rack elevation view (→ Phase 6).

## Phase 5 — Views, Layers & Presentation  ✅ COMPLETE
- [x] Layer management: visible/hidden, locked/unlocked, reorder, rename, delete-with-
  reassign; active layer; Layers panel
- [x] Multi-view projects: user-defined saved views (layer visibility + camera),
  view switcher, round-trip
- [x] Presentation/read-only mode (chrome hidden, pan/zoom only, Esc exit)
- [x] Page boundaries (A4-landscape printable overlay)
- Deferred (low priority): preset view types (overview/physical/logical/...) as
  auto-generated semantic filters; per-view export scope.

## Phase 6 — Rack, Cloud & Discovery  ✅ CORE COMPLETE
- [x] Rack elevation view: RU placement, drag-to-reposition, collision validation
  (front view; rear view + cable tracing deferred)
- [x] Cloud objects: VPC/VNet, cloud subnet, internet/NAT/VPN gateways, route table,
  security group, K8s, managed DB, object storage (as device types + Cloud library)
- [x] Discovery import: Nmap XML (OS-inferred types); LLDP/CDP via the neighbor/link
  CSV path
- Deferred (stretch): Terraform + Visio VSDX import, rear-view racks, cable tracing,
  region/AZ grouping containers.

## Phase 7 — App Hardening  ✅ COMPLETE
- [x] PWA: web manifest + offline service worker (stale-while-revalidate, app-shell
  fallback), install support, prod-only registration
- [x] Settings dialog: theme, connect behavior, reduced-motion override; storage
  usage estimate + clear-all-local-data; browser-capability status (FS Access,
  IndexedDB) — also surfaced as the multi-tab read-only banner + quota handling
- [x] Accessibility: aria-labels on icon controls, :focus-visible rings, non-color
  validation glyphs, reduced-motion, tables as the accessible data view, 80–200% zoom
- [x] Edge cases handled across phases: private/storage-disabled (capability status +
  warnings), multi-tab (Web Locks), newer-schema refuse, quota write-new-then-swap
- Deferred (low priority): rebindable hotkeys, configurable grid size, stale-SW
  update prompt.

## Stabilization Pass — Issue Backlog ✅ COMPLETE (2026-06-03)

- [x] Responsive shell: side-panel toggles, drawer behavior on narrow screens,
  compact topbar overflow controls.
- [x] Export correctness: object-only selections, selected links with endpoints,
  accurate preview/summary counts.
- [x] ZIP validation: report now includes VLAN/subnet/rack context and project name.
- [x] Canvas objects first-class in copy/cut/paste/duplicate/select-all/group/z-order
  and context menus.
- [x] View/layer consistency: applying views is transient and non-dirty; layer
  edits are undoable document changes.
- [x] Fit-to-screen/page bounds include devices, canvas objects, and link waypoints.
- [x] Import safety: images/SVG/IP-plan/VLAN imports preview before commit; large
  file/image safeguards; stronger SVG external-reference stripping.
- [x] Parser/doc polish: GraphML label selection improved; compressed draw.io gets
  clear guidance; README/type comments aligned with current behavior.

---

## Schema evolution (Phases 2–6)
Extend `.nexmap` with versioned `interfaces`, `vlans`, `subnets`, `zones`, `sites`,
`views`, `racks`, `assets`, plus connector `waypoints`/`labels`. Migrations stay
strict: older files migrate forward; newer unsupported files open read-only or fail
safely. Preserve unknown future fields through load/save unless unsafe.

## Standing test plan
Unit: migrations, validation rules, connector routing/labels, import mapping,
CSV/SVG sanitization, export option generation. Store/history: undo across imports,
reroutes, group edits, layer changes, multi-object transforms. Browser: first-run,
toolbar modes, lasso, connector creation, export preview, import rollback, recovery,
multi-tab read-only. Perf: 1k devices/5k links, large labels, parallel connectors,
hidden layers, huge exports, validation debounce. Security: malicious SVG, CSV
formula injection, prototype-pollution keys, external image refs, corrupt `.nexmap`.

---

## Canvas & UX Roadmap — local-first (CEO review 2026-06-05)

Mode: SCOPE EXPANSION. Premise: NexMap's moat is "knows it's a network + validates
itself + 100% local" — not draw.io feature-parity. Sequenced **moat-forward,
clean-capture-first** (revised from the original capture-first order after an
independent outside-voice challenge). Full reviewed plan + per-feature rigor:
`~/.gstack/projects/NexMap/ceo-plans/2026-06-05-canvas-ux-local-roadmap.md`.

**Hard constraint (all items): no login, no cloud, no network calls.**

**Eng-review locks (2026-06-05, AUTHORITATIVE — supersede notes below where they conflict):**
- Health runs **main-thread, debounced ~150ms** (extend `validate.ts`, O(V+E), sub-frame
  to 5k nodes). Web Worker deferred to ONLY opt-in redundancy/max-flow, only if >16ms.
- Interfaces **embedded under device** (`device.interfaces[]`); links ref `{deviceId,ifaceId}`.
  Migration v1→2 adds empty array. NOT a top-level FK table.
- CSP **build-time-injected** (strict prod `default-src 'self'`; dev relaxes ws:/inline for HMR).
- Local-promise gate = **two layers**: CSP-present unit test + network-cut E2E (zero requests).
- Test plan: `~/.gstack/projects/NexMap/pateldev-feat-iso-view-mode-editor-polish-eng-review-test-plan-20260605.md`

### Stage 0 — Local-promise enforcement (prerequisite gate) — P1 ✅ SHIPPED 2026-06-05
- [x] Strict `Content-Security-Policy` (`default-src 'self'`, `connect-src 'self'`,
      remote `img`/`script`/`object` blocked) — build-time injected into prod
      `index.html` only via Vite plugin. Source of truth: `src/lib/csp.ts`. Unit test:
      `src/lib/csp.test.ts` (7 tests).
- [x] Behavioural enforcement: `src/lib/netguard.ts` runtime tripwire wraps
      fetch/XHR/WebSocket/EventSource/sendBeacon → throws `NetworkBlockedError` on any
      non-local URL. Installed in PROD from `main.tsx`. Test: `netguard.test.ts` (10 tests).
      **Note:** chose a *continuous* runtime tripwire over a one-shot Playwright E2E
      (no ~150MB browser download; enforces every run, not just in CI). A browser-driven
      network-cut E2E remains a nice-to-have follow-up if Playwright is ever added.

### Stage 1 — Moat-forward foundation — P1 ✅ SHIPPED 2026-06-05
- [x] **NexText (text-to-diagram), one-shot scaffold.** Pure `lib/nextext.ts`
      (parse + build + serialize, totally non-throwing). Toolbar dialog → `applyNexText`
      store action REPLACES the diagram in one undoable transaction, auto-laid-out,
      re-validated; aborts on parse errors. Live-verified: 4 devices + 3 links + subnet
      + vlan from text. Tests: nextext.test.ts (19) + store nextext.test.ts (5).
- [x] **IPAM auto-suggest.** `lib/ipam.ts` nextFreeHost (lowest free, skips
      net/bcast/gateway/assigned; RFC3021 /31,/32) + subnetUsage. Inspector "Suggest"
      button on Management IP; utilization bar in IP Plan panel. Live-verified
      (.2→.3 allocation skipping gateway; 2/254 bar). Tests: ipam.test.ts (15).
- Fixed en route: topbar buttons crushed/overlapped when a 6th was added —
      `.topbarBtn` now `flex:0 0 auto`, labels collapse to icons ≤1240px.

### Stage 2 — Trustworthy intelligence + broad capture — P2 (partially shipped 2026-06-05)
- [x] **Topology health checks.** `lib/health.ts`: SPOF (iterative articulation points,
      stack-safe to 5k), fragmented-topology, conflicting parallel links, on-demand
      redundancy = edge-disjoint paths between user-selected pairs (Menger/max-flow).
      Soundness score + Health panel tab w/ jump-to-object + redundancy checker.
      MAIN-THREAD, folded into the existing debounced runValidation (eng-review lock).
      Live-verified (score 84, SW1+R1 SPOFs, R1→FW1 = 1 path). Tests: health.test.ts (15).
- [x] **Import fidelity (mechanism).** Optional `Link.inferred` field (additive, no schema
      bump); health emits a "scan-inferred" caveat when present so SPOF/redundancy aren't
      over-trusted. Reachability importers set it. (Nmap currently synthesizes no edges,
      so nothing to mark there yet — mechanism + caveat are in place and tested.)
- [x] **Paste-to-canvas.** `io/import/clipboardImport.ts` + `usePasteToCanvas` hook:
      clipboard CSV → devices/links/subnets/vlans via the SHARED csvImport model (one
      parsing path); clipboard image → raster underlay (size-clamped, sanitized path).
      Defers to internal device clipboard + form fields. Live-verified (CSV paste
      4→6 devices, auto-selected). Tests: clipboardImport.test.ts (7).
- [~] **Guided discovery-import wizard.** Substantially met by the existing ImportDialog
      (file → auto-detected kind → field mapping → preview → transactional apply; NetBox =
      file only) + the new paste path + a paste hint. An explicit step-indicator UI is
      deferred as polish over the already-guided dialog (not worth a risky rewrite now).

### Stage 3 — First-class interfaces — P2 ✅ SHIPPED 2026-06-05
- [x] **Embedded interfaces** (`Device.interfaces[]`) per the eng-review lock; links
      reference `{deviceId, ifaceId}` via `sourceIfaceId`/`targetIfaceId` (free-text
      label kept in sync). `createInterface` factory; `createDevice` defaults `[]`.
- [x] **Schema v1→v2 migration** — purely ADDITIVE (adds `interfaces:[]` per device);
      forward-only; too-new guard now holds at v2. CRITICAL tests (IRON RULE):
      v1 loads & gains arrays, non-destructive, idempotent-safe, v3 still refused.
      Live-verified migration. Tests: migrate.test.ts (+4).
- [x] **Store actions + cascade:** add/update/deleteInterface; deleting an interface
      clears referencing link endpoints in one undoable transaction. Tests: interfaces.test.ts (4).
- [x] **Port-level validation:** dangling interface reference + over-subscribed port.
      Tests: validate.test.ts (+3).
- [x] **Inspector UI:** device Interfaces section (add/rename/speed/delete, live-verified
      eth0 add) + link endpoint interface pickers (select / +add, label kept in sync).
- [x] **Migration upgrade notice.** `loadDocument` reports `migratedFrom`; open/openText
      surface a dismissible NoticeToast ("upgraded to v2, older builds won't open it").
      Tests: migrate.test.ts (+2).
- [~] **Pre-migration backup file (deferred):** `<name>.backup.nexmap` on file-open migrate.
      Needs a directory handle / File System Access (unavailable in some sandboxes), and
      the migration is non-destructive anyway — low-stakes follow-up.

### Stage 4 — Canvas craft (fast-follow polish) — P3 (mostly shipped 2026-06-05)
- [x] **Smart equal-spacing snap while dragging.** `computeSpacingSnap` in align.ts:
      extend-equal-sequence + center-between patterns per axis, 6/scale threshold, ≥3
      reference boxes. Runs in the store drag path on axes alignment didn't claim
      (wider neighbor query). Tests: align.test.ts (+6).
- [x] **Mini-map / overview navigator.** `canvas/MiniMap.tsx`: scaled bird's-eye of all
      devices (flat scene coords), live viewport rectangle (flat mode), click/drag to
      recenter the camera (projection-aware jump). Live-verified (6 device rects, view
      rect tracks projection, click-to-jump pans).
- [x] **Connection ports + directional hover-connect.** Replaced the single right-edge
      handle with 4 directional ports (top/right/bottom/left) on the hovered device, in
      both flat and iso. Additive — reuses the existing, tested `startLinkFrom` connect
      gesture, so no gesture-machine rewrite. Live-verified (4 ports render on hover).

### Distribution — the growth lever ✅ SHIPPED 2026-06-05
Local-first amputates the SaaS growth loop, so the shareable file is the growth engine.
- [x] **Self-contained HTML export.** `io/export/html.ts` wraps the rendered SVG in a
      single standalone `.html` with a tiny inline pan/zoom viewer; the file carries its
      own strict CSP (`default-src 'none'`) so it stays 100% local. Opens in any browser,
      no NexMap install. Wired into runExport + the Export dialog ("HTML (viewer)").
      Live-verified (exported a working doc). Tests: html.test.ts (6).

## Connectors & annotations — semantic-first (CEO review 2026-06-05)

Mode: SELECTIVE EXPANSION, Approach B. Full plan + spec-review clarifications:
`~/.gstack/projects/NexMap/ceo-plans/2026-06-05-connectors-and-annotations.md`.
Premise: reframe the requested draw.io-style knobs to carry network meaning (moat),
not commodity styling. Run /plan-design-review before implementing (UI scope).

### Accepted scope (this plan) — P2
- [ ] **Per-member connector identity:** optional `Link.color` + reuse `Link.name`;
      parallel links stay independent records (no LAG object v1). Additive, no migration.
- [ ] **Width = bandwidth-derived + override:** pure `bandwidthToWidth(bandwidth)`
      (M/G scaled, unparseable→default, never throws) + optional `Link.width` override.
- [x] **Drag-to-relink** ✅ (checkbox synced 2026-07-03 — shipped: diamond endpoint
      handles on selected links, store `relinkEndpoint`, tested in
      `store/relink.test.ts`): drag a selected link's endpoint onto another
      device → rewire via connect()-style + clear that endpoint's iface ref + one
      undoable txn + runValidation on DROP. Recompute parallel offsets for old+new pair.
      Drop-in-air / self-loop → snap back. Health/color are derived, re-computed on undo.
- [ ] **Annotation card:** extend `TextObject` with optional `heading`/`subheading`
      (existing `text` = body); width+height resizable (reuse resize handles); absent
      fields collapse+reflow; NO WYSIWYG. heading/subheading MUST escapeXml in export.
- [ ] **Link-health coloring (cherry-pick, S):** auto-tint from the Stage-2 health
      report (SPOF→amber, conflict→red; scan-inferred→dashed). Manual `Link.color` wins
      for color; dash is independent. Reuses the existing health pass.

### Deferred
- [x] **Bandwidth/width legend overlay** ✅ — `BandwidthLegend` on-canvas key (1G/10G/100G
      via bandwidthToWidth), shown when a link carries bandwidth; matching SVG group in
      flat + iso export. Tests + live-verified.
- [ ] **Explicit LAG/bundle object** (M) — only if independent per-link members prove
      insufficient for modeling port-channels. Revisit; not needed for v1.

### Fast-follows shipped after the eng review
- [x] **Bandwidth/width legend** (canvas + flat/iso export).
- [x] **Health-tint in export** — runExport → buildSvg threads the health report so
      exported PNG/SVG/HTML highlight SPOF/critical/conflict links; Export dialog toggle
      "Highlight risks" (default on); manual colors still win.

### Rejected
- Floating/dangling connector endpoints (breaks the validates-itself invariant).
- Full inline WYSIWYG rich-text editor (off-moat; fights the SVG canvas).

## Deferred from rack-designer CEO review (2026-06-07)
- [x] **E6 — Multi-rack row view + cross-rack cabling** (P2). ✅ SHIPPED 2026-06-10
      (Rack Designer v2). Row view, cross-rack cabling, move-device-to-rack, reorder.
- [~] **E7 — Power/weight/thermal budget** (P3). Watts + weight + U-utilization budget
      with overload warnings SHIPPED 2026-06-10. **Thermal/BTU half deferred** — add an
      optional `btu` device field + per-rack airflow/thermal cap. Effort: CC ~20m.

## Deferred from Rack Designer v2 (2026-06-10)
- [ ] **Drag a device between racks in the Row view** (P3). Cross-rack moves currently
      go through the "Move to rack" select in the focused editor; add native pointer
      drag-and-drop from one cabinet onto another in `RackRow.tsx` (React SVG `draggable`
      typing needs a small shim). Effort: CC ~20m.
- [ ] **Multi-page PDF for the row export** (P3). A wide multi-rack row + table is one tall
      composite page today; paginate (one rack per page + a table page) via jsPDF
      `addPage()` in `pdf.ts`. Effort: CC ~30m.
- [ ] **Auto-color cables by speed/media** (P4). Optional palette mapping 1G/10G/40G or
      copper/fiber to colors, on top of the manual swatch. Effort: CC ~15m.
- [ ] **Cross-rack cable + length should be one undo** (P3). `ConnectPortsDialog.submit`
      creates the cable (`connectRackCable`) then writes `lengthFt` in a separate
      `updateRackCable` — two history entries for one action. Fold an optional `lengthFt`
      into `connectRackCable`. Found by ship adversarial review. Effort: CC ~15m.
- [x] **Share the cable-curve helper between row renderers** ✅ (checkbox synced
      2026-07-03 — SHIPPED in 2ad076d: `src/rack/cablePath.ts` exports
      `cablePath(a,b,index,crossRack)` + `cablePath.test.ts`; imported by
      RackRow.tsx:27 and buildRackSvg.ts. The stale entry briefly got re-scheduled
      by a review before the code was checked — verified done.)

## Deferred from Rack Designer v3 (2026-06-10)
- [ ] **True rear-face port art** (P3). The rear column currently shows the same front
      faceplate; real rear layouts differ (PSUs, fan trays, rear ports). Add rear-specific
      art in `rackDeviceArt.ts` keyed on `side`. Effort: CC ~30m.
- [ ] **Pan/zoom unified canvas + inline port editing** (P3). v3 keeps a focus drill-in for
      port-level work; a future infinite pan/zoom canvas could place gear + cable inline with
      no drill-in step (the rejected "unified canvas" CEO option). Needs viewport math.

## Deferred from rack-designer ship review (2026-06-10)
- [x] **Validate rack-cable endpoints exist** ✅ (checkbox synced 2026-07-03 —
      SHIPPED in 2ad076d: `hasEnd` existence check at projectStore.ts:1942-1946
      returns null on unresolvable `{deviceId, ifaceId}`; tested by "rejects
      endpoints that do not resolve to real interfaces", rackActions.test.ts:117.)

## Pointer-Native Canvas follow-ups (CEO review 2026-07-03)

Plan: `~/.gstack/projects/pateldev2511-NexMap/ceo-plans/2026-07-03-pointer-native-canvas.md`

### Pointer-native library palette drag

**What:** Replace the HTML5 DnD palette→canvas/rack drag with a pointer-based drag
on the shared input core.

**Why:** HTML5 DnD never fires on touch devices and has its own gesture feel; this
is the last non-pointer-native drag in the app once the pointer-native canvas plan
ships.

**Context:** Explicit NOT-in-scope decision in the 2026-07-03 CEO plan (finding C2
of its spec review). Touch users meanwhile place gear via click-to-arm + tap-bay
and double-click quick-add (M4c). Start in Library.tsx (draggable/onDragStart) and
RackDesigner.tsx:717 / RackRow.tsx:107 drop targets.

**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** Pointer-native canvas M1+M2 (shared input core).

### Network-cut CI e2e

**What:** A Playwright spec that blocks all non-localhost requests at the context
level and runs the full app flow (load, edit, export), failing on ANY network
attempt.

**Why:** The local-only guarantee currently rests on CSP (build-time meta) +
netguard (runtime tripwire). A CI tripwire proves the guarantee on every commit
instead of trusting the two layers stay wired.

**Context:** Named as the remaining nice-to-have when netguard shipped; the
2026-06-05 strategy explicitly calls for "CSP default-src self + network-cut CI
test." Use `context.route('**/*')` allowlisting localhost, assert zero blocked
requests fired.

**Effort:** S (human) / S (CC)
**Priority:** P2
**Depends on:** None (can land before or with the pointer-native canvas work).

### Stuck-gesture dev watchdog

**What:** Dev-mode-only console warning when a gesture stays active >30 s with
zero pointer moves.

**Why:** Belt-and-suspenders on top of the fuzz invariant; the signature of the
pointer-capture bug class that shipped twice (Phase 8 latent capture bug, v0.6.1
rack pan click-stealing). ~10 lines.

**Context:** From the CEO review's observability section. Lives in the `src/input/`
adapter layer next to the `?debug=input` logger.

**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** Pointer-native canvas M1 (shared core + debug tooling).
