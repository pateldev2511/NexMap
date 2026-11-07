/**
 * The NexMap icon system — the one spec every device skin draws to.
 *
 * Four skins render the same 35 device types: line (deviceVisuals, the house
 * style), flat (deviceFlatArt), iso (deviceIso) and blueprint (blueprintArt,
 * which traces the line set in drafting ink). Without a shared spec they drift:
 * a UPS that is a tower in one skin and a wide box in another reads as two
 * different things. So the geometry lives HERE, and `iconSystem.test.ts`
 * measures every skin's art against it — a drift fails CI instead of shipping.
 *
 * The human-readable version, with the reasoning, is docs/ICON-SYSTEM.md.
 */
import type { DeviceType } from '@/model/types';

/** Every 2D skin is authored on one square grid, scaled by its caller. */
export const ICON_GRID = 24;

/**
 * The live area. Ink (including half a stroke) stays inside it so icons sit on a
 * common optical size and never kiss a neighbour's tile. The 2-unit keyline is
 * breathing room the halo and badges use.
 */
export const ICON_LIVE = { min: 2, max: 22 } as const;

/** Measuring slack for the live area — rounding in hand-authored coordinates. */
export const ICON_LIVE_SLACK = 0.1;

/**
 * Outline stroke weight per stroked skin, in grid units. One weight per skin:
 * line art never overrides it per element (detail weight comes from geometry,
 * not thinner pens). Flat art is a filled product render; its detail lines —
 * engraved seams, corrugation, brick courses at the thin end, antenna-free
 * wifi arcs at the thick end — stay in {@link FLAT_DETAIL_STROKE}.
 */
export const ICON_STROKE = { line: 2, blueprint: 1.25 } as const;
export const FLAT_DETAIL_STROKE = { min: 0.3, max: 1.4 } as const;

/**
 * Corner radii for line art, by role: a port or small detail, a device body, a
 * logical region (VPC / subnet — softer, so a boundary never reads as hardware).
 */
export const ICON_CORNER = { port: 0.4, body: 1.5, region: 2.5 } as const;

/** One port/jack size, shared by every skin that draws a port row. */
export const ICON_PORT = { size: 2, corner: ICON_CORNER.port } as const;

/**
 * The family of shapes a device type belongs to. It is the silhouette a viewer
 * recognises at a glance — every skin keeps it, even the 3D one.
 */
export type IconForm =
  | 'chassis' // wide, low rack-style box (router, switch, patch panel)
  | 'tower' // tall box (server, UPS, rack)
  | 'shield' // security boundary (firewall, security group)
  | 'dome' // ceiling/wall mount (AP, camera)
  | 'cylinder' // data at rest (storage, managed DB)
  | 'globe' // the outside world (ISP, internet gateway)
  | 'cloud'
  | 'screen' // something a person looks at (PC, VM)
  | 'region' // a logical boundary (VPC, subnet)
  | 'block' // a square module (IoT, route table, printer, NAT, LB)
  | 'hex'; // orchestration / generic node (container, k8s, generic)

export interface IconSilhouette {
  form: IconForm;
  /** Ink bounds on the 24 grid, stroke included: [minX, minY, maxX, maxY]. */
  box: readonly [number, number, number, number];
}

/**
 * The skeleton each skin traces. Boxes follow the flat art — the look users
 * already know — so the line and blueprint skins conform to it, not the other
 * way round.
 */
export const ICON_SILHOUETTES: Record<DeviceType, IconSilhouette> = {
  router: { form: 'chassis', box: [2, 2, 22, 19] },
  switch: { form: 'chassis', box: [2, 9, 22, 17] },
  firewall: { form: 'shield', box: [3.5, 2.5, 20.5, 22] },
  'access-point': { form: 'dome', box: [4, 5.5, 20, 21] },
  'wireless-controller': { form: 'chassis', box: [3.5, 6, 20.5, 20] },
  server: { form: 'tower', box: [5, 2.5, 19, 21.5] },
  storage: { form: 'cylinder', box: [4.5, 4, 19.5, 20] },
  'load-balancer': { form: 'block', box: [2.5, 2.5, 21, 21.5] },
  'end-user': { form: 'screen', box: [2.5, 3.5, 21.5, 21] },
  printer: { form: 'block', box: [3.5, 2, 20.5, 19.5] },
  iot: { form: 'block', box: [4, 4, 20, 20] },
  isp: { form: 'globe', box: [2.5, 2.5, 21.5, 21.5] },
  cloud: { form: 'cloud', box: [2, 5, 21.5, 18.5] },
  vm: { form: 'screen', box: [2.5, 4, 21.5, 20.5] },
  container: { form: 'hex', box: [3, 3, 21, 21.5] },
  rack: { form: 'tower', box: [4.5, 2.5, 19.5, 21.5] },
  'patch-panel': { form: 'chassis', box: [2.5, 7.5, 21.5, 16.5] },
  ups: { form: 'tower', box: [5, 3, 19, 21] },
  camera: { form: 'dome', box: [4.5, 10.5, 19.5, 21] },
  laptop: { form: 'screen', box: [2, 4.5, 22, 19.5] },
  'ip-phone': { form: 'block', box: [3.5, 3, 20.5, 21] },
  mobile: { form: 'screen', box: [7, 2.5, 17, 21.5] },
  modem: { form: 'chassis', box: [3, 7, 21, 18.5] },
  nas: { form: 'tower', box: [5, 3, 19, 21] },
  vpc: { form: 'region', box: [2.5, 4, 22, 20] },
  'cloud-subnet': { form: 'region', box: [2.5, 5, 21.5, 19] },
  'internet-gateway': { form: 'globe', box: [2, 5, 21, 19] },
  'nat-gateway': { form: 'block', box: [2, 5.5, 22, 18.5] },
  'route-table': { form: 'block', box: [3, 3.5, 21, 21] },
  'security-group': { form: 'shield', box: [3.5, 2.5, 20.5, 22] },
  'vpn-gateway': { form: 'block', box: [5.5, 4, 18.5, 20] },
  k8s: { form: 'hex', box: [4, 2.5, 20, 18] },
  'managed-db': { form: 'cylinder', box: [4.5, 4, 21, 21] },
  'object-storage': { form: 'cylinder', box: [5, 3.5, 19, 20] },
  generic: { form: 'hex', box: [4, 3, 20, 21] },
};

/**
 * How far a skin's measured ink may sit from the silhouette box, per edge.
 * Flat defines the boxes, so it's held tight; line art has a heavier pen and
 * simpler geometry, so it gets a little more room. Past this the skins read as
 * different objects.
 */
export const SILHOUETTE_TOLERANCE = { flat: 1, line: 1.5 } as const;

export function iconSilhouette(type: DeviceType): IconSilhouette {
  return ICON_SILHOUETTES[type] ?? ICON_SILHOUETTES.generic;
}
