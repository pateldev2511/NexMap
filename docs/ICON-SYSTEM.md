# The NexMap icon system

NexMap draws its 30 device types in four skins. This document is the spec they
all draw to. The numbers live in code, in
[`src/canvas/iconSystem.ts`](../src/canvas/iconSystem.ts), and
[`src/canvas/iconSystem.test.ts`](../src/canvas/iconSystem.test.ts) measures every
skin against them. If an icon drifts, CI fails; nobody has to catch it by eye.

| Skin | Where | Look | Used for |
| --- | --- | --- | --- |
| **Line** | `deviceVisuals.ts` → `DEVICE_ICONS` | One-colour strokes. The house style. | The master every other 2D skin traces. |
| **Flat** | `deviceFlatArt.ts` | Filled illustration, 3-tone bodies, live LEDs. | The 2D canvas, Library, flat export. |
| **Iso** | `deviceIso.ts` | Solid 3D models, top-lit. | Isometric view and export. |
| **Blueprint** | `blueprintArt.ts` | The line set in pale ink on cyanotype paper, plus registration ticks. | Blueprint view and the blueprint sheet export. |

## The grid

- **One 24 × 24 grid.** Every 2D skin is authored in 0–24 units and scaled by its
  caller. Nothing is drawn in pixels.
- **Live area 2–22.** All ink, including half a stroke, stays inside it, with 0.1
  slack for hand-rounded coordinates. The 2-unit keyline is reserved for the
  selection halo and the issue, rule and lock badges.

## Pens

- **Line art uses one weight: 2.** The caller's `<g>` sets it, and no element
  overrides it. Detail comes from geometry, not thinner pens.
- **Blueprint uses one weight: 1.25.** It is the same geometry with a finer
  drafting pen. Registration ticks are 0.5, at 60% opacity.
- **Flat art is filled.** Its few detail lines (meridians, vents, arrows) stay
  between 0.6 and 1.4.

## Corners

Line art uses three radii, one per role:

| Role | Radius | Examples |
| --- | --- | --- |
| Port or small detail | 0.4 | jacks, keyhole, IoT die |
| Device body | 1.5 | chassis, tower, screen |
| Logical region | 2.5 | VPC, subnet |

Only `region` types may use 2.5, so a cloud boundary never reads as hardware.

## Ports

There is one port size: **2 × 2 at radius 0.4**. Every port row draws it
(switch, patch panel). The test checks this.

## Silhouettes: one skeleton per type

Each type has a **form**: the shape family a viewer recognises at a glance.
It also has a **silhouette box**: the ink bounds on the grid, stroke included.

| Form | Types |
| --- | --- |
| chassis (wide, low) | router, switch, wireless controller, patch panel |
| tower (tall) | server, UPS, rack |
| shield | firewall, security group |
| dome | access point, camera |
| cylinder | storage, managed DB, object storage |
| globe | ISP, internet gateway |
| screen | PC, VM |
| region | VPC, subnet |
| block | load balancer, printer, IoT, NAT gateway, route table, VPN gateway |
| hex | container, k8s, generic |
| cloud | cloud |

The boxes follow the **flat** art, because that is what users already see on the
canvas. Line art conforms to flat, not the other way round. Flat must sit within
1 unit of each box edge; line art, with its heavier pen, within 1.5. Blueprint
traces line art exactly, and its corner ticks mark the silhouette box on the
sheet itself.

Iso is 3D, so it has no 2D box to measure. It keeps the **form**: a UPS is a
tower in every skin. Iso conformance is checked by eye when an iso model
changes.

### Why the line set was redrawn

When this spec was written, a dozen line icons disagreed with their flat
counterparts:

- The UPS was a wide box in line art but a tower in flat.
- The switch had legs.
- The camera was a handheld body, not a dome.
- The router was a round routing symbol, not a chassis.

These icons were redrawn to the flat silhouettes. Until blueprint, line art had
not appeared on the canvas, so no user saw the old shapes. Blueprint is the
first place line art is shown, which made this the moment to fix them.

## Adding a device type

1. Add the type to `DeviceType` and give it an entry in every skin's table. Each
   table is a `Record<DeviceType, …>`, so TypeScript reports a missing one.
2. Add its form and silhouette box to `ICON_SILHOUETTES`. Measure the flat art
   for the box; `artBounds()` in `iconBounds.ts` does it.
3. Run `npx vitest run src/canvas/iconSystem.test.ts`. It fails with the type and
   its measured box if any skin leaves the live area, misses the silhouette, or
   uses an off-spec pen, corner or port.

## The blueprint sheet

Blueprint is a third view style beside 2D and ISO: the toolbar's sheet icon, or
**Blueprint view** in ⌘K. Saved views remember it. Under the hood it is the
`blueprint` value of the view's `projection`. Every `projection === 'iso'` check
treats it as flat geometry, and an older build that doesn't know the value falls
back to flat.

- **Paper and ink are fixed colours (`BLUEPRINT`).** The sheet is the same blue
  in light and dark mode, as a printed blueprint is.
- **Health tints stay.** A risky link is still amber or red on the sheet. A
  drawing that hides a single point of failure is worse than a plain one.
- **The drawing is still.** No travelling packets, glow or shadows. Names are
  lettered in mono caps. Zones become dashed outlines, and callouts are lettered
  in ink whatever colour they carry.
- **Export adds a ruled border and a title block** with the project name, date,
  scale (NTS, not to scale) and node and link counts. The block sits in its own
  strip, so it never covers the drawing. A blueprint export always paints its
  paper, because transparency would lose pale ink on a white page.
