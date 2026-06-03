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

## Phase 3 — Export & Import Upgrade
- Export dialog: live preview, crop-to-selection/content, custom filename, DPI/scale
  slider, transparent checkerboard preview, layer/view scope, progress/cancel.
- Export package ZIP: `.nexmap` + images + PDF + inventory CSV + links CSV +
  validation report.
- Import: `.nexmap`, CSV (devices/links/IP/VLANs), JSON, SVG/image underlays,
  draw.io, GraphML, NetBox CSV/JSON.
- Edge cases: huge diagrams, canvas limits, PDF pagination, unsafe SVG, malformed
  CSV, bad encodings, duplicate IDs/names, links-before-devices, partial rollback.

## Phase 4 — Network Semantics
- First-class interfaces, VLANs, subnets, zones, sites, racks, cloud networks.
- Validations: overlapping subnets, duplicate VLAN IDs, invalid VLAN ranges, IP
  outside subnet, missing gateway, trunk/access mismatch, orphaned devices, rack RU
  collisions, link bandwidth mismatch.
- Bottom-panel tabs: IP Plan, VLANs, Interfaces, Racks, Sites, Import Results.
- Edge cases: IPv4/IPv6 mixed, subnet boundaries, VLAN scope per site, device
  renames, interface deletion, stale link refs, custom-metadata round-trip.

## Phase 5 — Views, Layers & Presentation
- Layer management: visible/hidden, locked/unlocked, reorder, rename, delete confirm,
  export selected layers.
- Multi-view projects: overview, physical, logical, rack, site, security zones,
  cloud, IP plan.
- Presentation/read-only mode; page boundaries for print/PDF handoff.
- Edge cases: object in multiple views, hidden validation issues, deleting a layer
  with objects, exporting empty views, stale view refs.

## Phase 6 — Rack, Cloud & Discovery
- Rack elevation mode: RU placement, front/rear, patch panels, UPS, cable tracing,
  collision validation.
- Cloud objects: VPC/VNet, subnets, gateways, route tables, security groups, VPN,
  direct connect, load balancers, regions/AZs.
- Discovery imports (stretch): Nmap XML, LLDP/CDP, Terraform, Visio VSDX.
- Edge cases: rack overflow, split devices, cloud region mismatch, unknown discovered
  types, duplicate discovered assets.

## Phase 7 — App Hardening
- PWA install/offline, service-worker cache strategy, recovery diagnostics, storage
  quota handling, browser-compat warnings.
- Settings: hotkeys, pan/zoom behavior, connector mode, grid size, theme, label
  visibility, reduced motion.
- Accessibility: keyboard-operable chrome, table-based accessible editing, focus
  states, contrast, non-color validation symbols.
- Edge cases: private browsing, storage disabled, multiple tabs, refresh mid
  import/export, stale service worker, unsupported FS Access API.

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
