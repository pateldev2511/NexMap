# Changelog

All notable changes to NexMap are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). NexMap is pre-1.0, so
minor/patch semantics are not yet enforced.

## [Unreleased]

Two big pushes land together: the **NexMap Deck** — a reimagined, command-first
entry experience with a dark-first design-system restyle — and the **living
canvas**, where the diagram itself now reads as a live, breathing network from
the cables down to the hardware, with a user control to dial the motion.

### Added

- **The NexMap Deck — a reimagined, command-first entry experience.** The plain
  two-card chooser is now a cinematic hub: a real-time 3D "network constellation"
  rendered on a dependency-free canvas (DPR/visibility/reduced-motion aware), a
  bespoke animated brand mark, hand-built isometric illustrations for each
  designer, and a ⌘K-style quick-launch you can drive from the keyboard. The
  tested contract is unchanged (the `Choose a designer` dialog and the
  `Network Designer` / `Rack Designer` entry points still route exactly as before).
- **A bundled motion reel.** A rendered, seamless-looping 3D network reel ships
  as a local VP8 `.webm` (+ poster) — no CDN, no runtime network. Reachable from
  the Deck ("See NexMap in motion") and embedded in the About dialog; it never
  autoplays under reduced-motion.
- **Self-hosted type system.** Inter, Space Grotesk and JetBrains Mono ship as
  latin-subset variable `woff2` (SIL OFL), applied to hero/overlay surfaces,
  brand, and metrics chips. The dense editor chrome stays on the system stack so
  its tested geometry is byte-for-byte unchanged.
- **Living signal flow.** Every network link carries bright "packets" that
  march source→target, health-colored (cyan when healthy, amber/red on a
  critical bridge or conflict, accent when selected) and phase-offset per link
  so the field shimmers out of phase instead of in lockstep. The rack editor's
  patched cables carry matching light-packets. Compositor-cheap (animated
  `stroke-dashoffset`, no per-frame JS, no filters in the hot path).
- **Magnetic connect gesture.** Dragging a new link paints a glowing, gently
  bowed cable with flowing packets, a start dot, and a pulsing reticle that
  snaps onto valid targets; drop-target nodes breathe with an accent glow and
  selected nodes glow.
- **Living hardware.** Device icons, flat and isometric, now read as powered
  gear: status lights are real activity LEDs that pulse (health-hued, staggered
  out of phase, amber/red blinking faster and deeper), every device carries a
  faint device-family "powered" under-glow, and the displays on monitors, VMs
  and printer panels glow with a sweeping scanline.
- **Living motion control** (Settings → Living motion): `full` (the designed
  experience), `subtle` (gentle breathing only, no traveling packets or
  scanlines), or `off` (static diagram, ordinary UI transitions unaffected).
  Persists locally and applies via `<html data-motion>`; the Reduced motion /
  `prefers-reduced-motion` accessibility switch still overrides everything.

### Changed

- **A cohesive, dark-first design system.** A greatly expanded token set
  (layered surfaces, brand gradients, elevation, glow, radii, spacing, motion
  curves, z-index) restyles the whole app — topbar, panels, status bar, command
  palette, first-run, dialogs, and the device library — in both light and dark,
  with GPU-friendly micro-interactions throughout. The local-first CSP + netguard
  guarantees are untouched.
- Refreshed brand assets: new app icon, Open Graph image, and theme color.

### Fixed

- **E2E CI.** Pinned the Playwright E2E job to `ubuntu-24.04`. `ubuntu-latest`
  had rolled to 26.04, where Playwright can't install Chromium
  (`does not support chromium on ubuntu26.04-x64`), reddening every run.

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
