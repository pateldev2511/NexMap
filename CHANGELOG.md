# Changelog

All notable changes to NexMap are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). NexMap is pre-1.0, so
minor/patch semantics are not yet enforced.

## [Unreleased]

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
