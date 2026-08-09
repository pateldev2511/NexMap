# Changelog

All notable changes to NexMap are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). NexMap is pre-1.0, so
minor/patch semantics are not yet enforced.

## [Unreleased]

The spatial model release: racks, devices and ports gained real addresses, and
the physical cabling layer became traceable and comparable against the drawing.
Plan: `docs/designs/spatial-model-and-tracing.md`. Suite 757 → 1070 unit tests.

### Added

- **Location hierarchy (schema v5).** A site → building → floor → room → row
  tree. Racks and devices point at a location, so every port has a
  fully-qualified address like `HQ/28/RK001/SW01/Gi1/0/13`. Paths are DERIVED on
  every read, never stored, so renaming a room can't leave a stale copy behind.
  Traversal is cycle-safe and depth-capped: a corrupt or hand-edited file
  degrades to a marked partial path instead of hanging the UI.
- **Locations navigator.** A tree in the left sidebar; clicking a row selects
  everything placed there. Adding a child defaults to the next rung down.
  Deleting a location that still holds anything is REFUSED with a count of what
  is inside — never cascaded, so a subtree can't be lost to one click.
- **Legacy site conversion.** One undoable step turns free-text `Rack.site`
  values into real site locations, deduping case-insensitively. Never clobbers a
  rack that already has a location, and never clears the original text.
- **Multi-hop cable tracing.** Patch-panel front/rear ports can be wired through
  to each other (`Interface.throughTo`), and a trace walks cable → pass-through →
  cable to the far end. It always reports WHY it stopped — terminated, un-patched,
  looped, ambiguous, or depth-capped — because a trace that looks complete when it
  isn't is worse than no trace. Only patch panels are treated as pass-through.
- **Port inspector scope.** A third inspector level below Rack and Device: name,
  media, speed, access VLAN, face, a jump to the coupled port, and the full
  physical path. Clicking any hop navigates to that port.
- **Bulk pass-through pairing.** Wires a whole patch panel's faces together in
  one undoable edit, mirroring front-only panels into new rear ports. Idempotent.
- **Cabling panel.** Compares the DESIGNED topology against the PATCHED cabling
  and reports the delta: documented-and-patched, designed-but-not-cabled, and
  cabled-but-undocumented, plus cables that are part of no complete circuit. Only
  links whose both endpoints are rack-mounted are in scope, so a diagram drawn
  without racks reports nothing rather than flagging every link.
- **Focus dimming.** Selecting anything demotes everything else in both
  designers. A link stays lit when either endpoint is selected, since those links
  are what make the selection meaningful.
- **Zoom-tiered rack canvas.** The row view now draws rack outlines when zoomed
  out, faceplates at mid zoom, and individual ports up close, with separate
  enter/exit thresholds per boundary so the drawing can't flicker while you rest
  at one. Port hit-testing is suppressed — not merely hidden — below the port
  tier, so a device drag at low zoom can never become a stray cable.
- **Inline port cabling in the row view.** Drag jack to jack across the whole row
  without drilling into a single rack.

### Changed

- Exported cable schedules carry fully-qualified endpoint paths alongside the
  short `device:port` labels, so a printed patch list matches the on-screen trace.
  Generated title blocks include the rack's location.
- New validations: location cycles (error), orphaned and duplicate-sibling
  locations, odd containment order (info — real estate is messy, so it warns
  rather than blocks), stale placement references, and four malformed
  pass-through cases.

### Fixed

- `README.md` claimed first-class interfaces/ports were "not modeled yet" (they
  shipped in schema v2) and that the contributor guide, issue templates and
  security policy were "still missing" (all present). Both corrected.
- `src/model/types.ts` now states that per-field `(schema vN)` comments record
  the version a field was INTRODUCED in, not the current version — the newest
  annotations said v3 while v4 had already shipped, which nearly caused a
  colliding migration.

## [0.6.2] - 2026-07-05

The pointer-native canvas release: both designers' input layers were rebuilt
from scratch on one shared gesture engine, then hardened by a seven-reviewer
audit. 33 commits; suite at 669 unit tests and 58 end-to-end specs.

### Added

- **One gesture engine for every canvas.** All pointer work on the network
  designer, the rack editor, and the multi-rack row view now runs on a single
  pure state machine (`src/input/`): identical 4px click-vs-drag feel at every
  zoom level, Escape always cancels cleanly, and interrupted gestures (OS
  popups, window switches, lost pointer capture) can never leave the canvas
  stuck. Proven by a 3000-sequence fuzz harness.
- **Touch and tablet support everywhere.** Two-finger pinch zooms at your
  fingers, two-finger drag pans, a second finger mid-drag safely cancels into
  a pinch — and lifting one finger from a pinch continues as a smooth
  one-finger pan. Works on all three canvases.
- **Quick-create.** Double-click empty canvas to place a device from a compact
  picker; drop a connection on empty space to create AND wire the new device
  in one motion (one undo entry). In the rack, double-click an empty bay to
  repeat the last-used preset.
- **Cross-rack drag in the row view.** Grab gear and drag it onto another
  cabinet with a live drop preview that tells the truth: green when the span
  fits at that U, amber naming the actual landing U when it doesn't.
- **Click-click cabling** in the rack editor: tap one jack, tap another —
  the low-dexterity alternative to drag-to-cable, gated on the same
  connect-mode preference as the flat canvas.
- **Quiet canvas.** A floating selection toolbar is now the primary quick-
  action path on both designers (align/distribute, z-order, group, nudge,
  unmount, cable editing at the cable itself); idle chrome gently fades to
  80% after you start working and wakes on hover, tap, or keypress.
- **Unified wheel contract.** Plain scroll pans, Ctrl/pinch zooms at the
  cursor — the same on every canvas, flippable in Settings. Returning rack
  users get a one-time toast (their wheel used to zoom).

### Changed

- Pan/zoom is now a pure CSS transform on every canvas: scenes (device art,
  rack shells, cables, minimap dots) are memoized and no longer re-render per
  frame — pinned by render-count perf tests on all three canvases.
- Rejected rack drops always flash the slot, name the reason, and pulse the
  nearest free U; screen-reader users hear the same announcements.
- Accessibility: real one-Tab-stop toolbar with roving focus, keyboard-
  reachable rack reorder buttons, focus returns to the canvas when menus
  close, cable color swatches announce names ("green"), readable contrast on
  drop-preview labels and quiet chrome.

### Fixed

- A stray release from a second pointer (touch + pen/mouse) could resolve an
  armed press as a phantom click and orphan the real gesture.
- An Escape-cancelled bend drag left a hidden no-op history entry that
  silently ate the next undo; quick-create-with-connection was two undo
  entries (one undo stranded an orphan device). Both are now exactly one.
- Keys no longer leak through the open quick-create picker to the canvas
  behind it (Delete could destroy the selection while picking).
- Rail-mounted gear (0U PDUs) was falsely rejected when moved into a full
  rack; double-clicking the rack zoom buttons could mount gear behind them;
  wheel-panning under an open picker shifted where the device landed.
- Cancelled drags no longer mark a freshly saved document as edited.


### Fixed

- **Rack canvas pan/zoom no longer steals clicks (v0.6.1).** Capturing the pointer on
  press retargeted the subsequent click to the canvas, so clicking a rack to drill in (or
  selecting gear) silently stopped working in the row view. The pointer is now captured
  only once an actual pan drag begins, so plain clicks reach the rack again. Caught by the
  multi-rack e2e.

### Added

- **Rack canvas navigation + A/B power (v0.6.0).**
  - **Pan + zoom** on the multi-rack canvas: wheel-zoom anchored to the cursor, drag-to-pan,
    fit-to-screen, and a zoom control cluster. The canvas no longer just scrolls — large
    fleets are navigable. (Crisp vector zoom via an SVG transform.)
  - **A/B power feeds.** Each device cords into feed A, B, or A+B (redundant PSUs); the
    fleet capacity strip shows per-feed load (`⚡ A x · B y kW`) and flags single-corded
    devices that have no power redundancy. Per-feed failover load is modeled too (what each
    feed must carry if the other dies).

- **Rack Designer Pro — power, planning, and at-a-glance ops (v0.5.0).** A big batch of
  rack-designer upgrades:
  - **Realistic power/weight budgets.** Every device now carries nominal watts + weight, so
    the per-rack and new **fleet capacity strip** (`N racks · used/total U · free % · kW · kg`)
    read real numbers instead of 0. UPS/PDU correctly count as power sources.
  - **Pre-made templates.** Quick-start from 7 designs grouped Home / Office / Enterprise
    (wall lab, media+NAS, office IDF, server room, enterprise core/compute/edge) — picker in
    the empty state and a **Templates** toolbar button; applying one appends a fully-built,
    named rack in a single undo.
  - **Named vendor catalog.** ~32 real models (Cisco, Arista, Juniper, Dell, HPE, Palo Alto,
    Fortinet, Synology, APC, …); the inspector's **Hardware model** picker auto-fills
    vendor/model/power/weight.
  - **Per-port VLAN tagging** with a VLAN-mismatch health check and a VLAN column in the
    cable schedule (CSV + on-canvas table).
  - **Auto cable length** estimated from rack geometry (vertical U + cross-rack travel +
    slack, rounded to a stocked length) — one-click fill for every cable without a length.
  - **Lifecycle + asset tracking.** Device status (planned / active / maintenance /
    decommissioned) with a status tint on the gear, plus serial / asset tag / owner /
    warranty fields.
  - **Occupancy heatmap** — a per-U used/free track on each rail.
  - **Color-by-attribute** — tint the whole fleet by status or owner, with a legend.
  - **Opposite-face ghosts** — a full-depth chassis (switch/server/firewall/UPS) now shows a
    muted back-of-chassis ghost on the opposite face and blocks the same U on both faces;
    shallow gear (patch/blank) can still share a U front-to-back.
  - **Rear-specific port art** — the rear of full-depth gear renders PSUs + fan grilles, not
    a mirror of the front jacks.
  - **Printable label sheet** export — a cut-out label per device (name, rack/U, model).

- **Rack Designer v3 — default side-by-side canvas + realistic gear.** The designer now
  opens straight into the multi-rack canvas: every rack shown next to the others with
  **both faces (front + rear) side by side**, a **Hide rear** toggle, and `+ Rack` dropping
  a new cabinet in place. Click a rack to drill into the detailed port editor; "← All racks"
  returns. Every device is redrawn realistically (Studio Realism): switches with real RJ45
  jacks, link/activity LEDs, and SFP+ cages; patch panels with numbered keystone ports;
  servers with drive bays, status LCD, and power button; PDUs with outlets; brushed-metal
  faceplates with a glossy sheen. One shared renderer (`rackDeviceArt.ts`) drives the live
  editor, the canvas, and the PNG/PDF export identically — gradients survive rasterization.

- **Rack Designer** — a separate designer screen, chosen at launch (Network vs
  Rack). Drag switches, servers, firewalls, patch panels, PDUs and more into a
  cabinet at any U; front/rear faces; full- and half-bay placement; 0U rail gear.
  Port-to-port cabling with color-coded, labeled connectors and an installer
  cable-schedule. Export the elevation to PNG/PDF and the schedule to CSV.
  Auto-numbered device names, inline rename, keyboard nudge/delete, and an
  invalid-drop rejection hint. Everything runs locally — no login, no server.
  `.nexmap` schema migrated v2 → v3 (additive, round-trip-safe).
- **Rack Designer v2 — multi-rack + cross-rack cabling + validation + table export.**
  A new **Row view** shows every rack side by side in one canvas; click a rack to
  focus and edit it, reorder cabinets, and move a device to another rack. Cables can
  now span racks. A **cabling-health** panel warns (never blocks) on physical loops
  (spanning-tree), single points of failure, bridge cables, speed/media mismatches,
  and cross-rack sanity — reusing the network designer's graph engine on the physical
  cable graph. A **connections table** is shown in-app and export now offers three
  modes (diagram, diagram + table, or table only) for PNG/PDF. Plus a per-rack
  **power/weight + U-utilization budget** with overload warnings, one-click **rack
  clone** (gear + intra-rack cabling), and **cross-rack device search**. All additive
  to schema v3 — no version bump, old files load unchanged.
- Flat 2D device-model icons (detailed, per-type) distinct from the 3D
  isometric models; the library palette and flat-mode export track the active
  projection.
- FossFLOW-style floating info card above nodes (name + sanitized rich-text
  description) with a dotted leader; on-canvas inline rename.
- 2D vs ISO visual differentiation: grounded shadows in iso (flat stays flat),
  an iso stage vignette, cable-on-floor connector shadows, and an animated tilt
  on projection toggle.
- Positioned vendor/model/role combobox; per-node icon-size and label-height
  controls.
- 18 grouped starter templates (Home & small office, Enterprise & data center).
- Group move carries a connector's waypoints when both endpoints move.
- Cloudflare Workers + Pages deployment config (`wrangler.toml`, `_headers`,
  deploy scripts); live at https://nexmap.xyz.
- Generated README/social visuals from the export pipeline
  (`npm run gen:readme-media`) including a 1200×630 Open Graph card.
- Continuous Integration (GitHub Actions): lint, test, build, and Cloudflare
  config validation on every PR and push to `main`.
- Project governance: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  issue/PR templates.

### Fixed

- Info card no longer swallows connector clicks (foreignObject is click-through).
- Vendor/model/role dropdown now anchors correctly under its input.
