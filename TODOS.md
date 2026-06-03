# NexMap — Master Roadmap

> Phased roadmap to make NexMap a polished, FossFLOW-**inspired** (not a clone)
> local network designer, while keeping its identity: **no login, no accounts, no
> server storage, no hidden cloud sync.** Each phase must keep existing behavior
> green before the next is accepted. Replaces the old MVP-deferral list.

**Non-negotiable constraint (all phases):** no login, no cloud, no hidden upload.
Data stays local (IndexedDB + `.nexmap` files) unless the user explicitly exports.

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
- [x] Context menus (canvas / device — copy/cut/dup/paste/lock/delete/group/z-order)
- [x] Grouping (group/ungroup, group-aware selection), z-order (front/back/forward/back)
- [x] Lasso selection (freehand polygon)
- [x] Text notes + Zone/Shape objects (new object types: create, render, select,
      move, lock, delete, inspector, export, round-trip)
- [x] Richer device visuals: depth shadow, hover outline, locked/error badges
- Remaining Phase-1 nice-to-haves (deferred, low priority): shape resize handles,
      object grouping/z-order, full isometric styling, tablet gestures.

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
- Deferred to Phase 4 (needs the subnet/VLAN model): IP-plan + VLAN CSV import.
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
