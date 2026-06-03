/**
 * NexMap data model.
 *
 * Invariants (from PLAN.md §2 / spec Data Model):
 *  - Every object has a stable string ID.
 *  - Links reference device IDs, never names — renaming never breaks a connection.
 *  - Unknown/future fields are preserved through load→save via `extra` (DA-D1).
 *  - MVP: links connect DEVICES with an optional free-text interface label.
 *    The first-class `interfaces[]` layer is Post-MVP (DA-CEO-F7).
 */

export type DeviceType =
  | 'router'
  | 'switch'
  | 'firewall'
  | 'access-point'
  | 'wireless-controller'
  | 'server'
  | 'storage'
  | 'load-balancer'
  | 'end-user'
  | 'printer'
  | 'iot'
  | 'isp'
  | 'cloud'
  | 'vm'
  | 'container'
  | 'rack'
  | 'patch-panel'
  | 'ups'
  | 'camera'
  // Cloud objects (Phase 6).
  | 'vpc'
  | 'cloud-subnet'
  | 'internet-gateway'
  | 'nat-gateway'
  | 'route-table'
  | 'security-group'
  | 'vpn-gateway'
  | 'k8s'
  | 'managed-db'
  | 'object-storage'
  | 'generic';

export type Severity = 'info' | 'warn' | 'error' | 'critical';

/** Fields preserved verbatim across load→save even if this app version is unaware of them. */
export type ExtraFields = Record<string, unknown>;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
}

export interface Device {
  id: string;
  kind: 'device';
  type: DeviceType;
  name: string;
  /** Top-left in canvas coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  layerId: string;
  // MVP property subset (DA-DES-4.1). The rest of the spec's ~20 fields are Post-MVP.
  vendor?: string;
  model?: string;
  role?: string;
  location?: string;
  managementIp?: string;
  notes?: string;
  fill?: string;
  /** Rack placement (Phase 4): rack id, lowest occupied RU (1-based), height in U. */
  rackId?: string;
  ru?: number;
  ruSpan?: number;
  /** Locked devices can't be moved or deleted until unlocked. */
  locked?: boolean;
  /** Stacking order; higher renders on top. Default 0. */
  z?: number;
  /** Devices sharing a groupId select and move together. */
  groupId?: string;
  extra?: ExtraFields;
}

export interface Link {
  id: string;
  kind: 'link';
  name?: string;
  /** Device IDs. */
  sourceId: string;
  targetId: string;
  /** Free-text interface labels (MVP); first-class interfaces are Post-MVP. */
  sourceInterface?: string;
  targetInterface?: string;
  linkType?: string;
  bandwidth?: string;
  /** Trunk carries multiple VLANs; access carries one. */
  mode?: 'access' | 'trunk';
  layerId: string;
  /** Intermediate reroute points (canvas coords); path runs source → waypoints → target. */
  waypoints?: { x: number; y: number }[];
  /** Arrowhead placement. */
  arrow?: 'none' | 'end' | 'both';
  /** Line style. */
  style?: 'solid' | 'dashed';
  /** Routing: straight polyline (default) or orthogonal elbow. */
  routing?: 'straight' | 'orthogonal';
  // Extra connector labels (rendered stacked at the midpoint).
  vlan?: string;
  nativeVlan?: string;
  lacp?: string;
  circuitId?: string;
  extra?: ExtraFields;
}

/**
 * Non-device canvas objects (Phase 1): freeform text notes and shapes/zones.
 * Share the position/lock/group fields with devices so the editor can move,
 * select, lock, and delete them through the same flows.
 */
interface BaseCanvasObject {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layerId: string;
  z?: number;
  locked?: boolean;
  groupId?: string;
  extra?: ExtraFields;
}

export interface TextObject extends BaseCanvasObject {
  kind: 'text';
  text: string;
  fontSize?: number;
  color?: string;
}

export interface ShapeObject extends BaseCanvasObject {
  kind: 'shape';
  shape: 'rect' | 'ellipse';
  label?: string;
  fill?: string;
  stroke?: string;
}

export interface ImageObject extends BaseCanvasObject {
  kind: 'image';
  /** Data URL (sanitized for SVG; raster for png/jpg/webp). */
  href: string;
  opacity?: number;
}

export type CanvasObject = TextObject | ShapeObject | ImageObject;

/** First-class network semantics (Phase 4). */
export interface Vlan {
  id: string;
  /** 802.1Q VLAN ID (valid 1–4094). */
  vlanId: number;
  name: string;
  color?: string;
  zone?: string;
  notes?: string;
  extra?: ExtraFields;
}

export interface Subnet {
  id: string;
  /** CIDR, e.g. "10.0.0.0/24". */
  cidr: string;
  name?: string;
  gateway?: string;
  /** Associated VLAN ID (802.1Q). */
  vlanId?: number;
  zone?: string;
  notes?: string;
  extra?: ExtraFields;
}

/** A saved perspective (Phase 5 multi-view): which layers show + the camera. */
export interface View {
  id: string;
  name: string;
  /** Layer IDs hidden in this view. */
  hiddenLayers: string[];
  camera?: { tx: number; ty: number; scale: number };
}

export interface Rack {
  id: string;
  name: string;
  /** Total rack units (e.g. 42). */
  ruHeight: number;
  site?: string;
  notes?: string;
  extra?: ExtraFields;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  units: 'px';
}

/**
 * The serialized `.nexmap` document. Arrays for portability/diffability.
 * Post-MVP collections are kept as `unknown[]` so the schema is forward-stable
 * and round-trips unknown content without dropping it.
 */
export interface NexMapDocument {
  schemaVersion: number;
  appVersion: string;
  project: ProjectMeta;
  layers: Layer[];
  devices: Device[];
  links: Link[];
  objects: CanvasObject[];
  vlans: Vlan[];
  subnets: Subnet[];
  racks: Rack[];
  views: View[];
  // Forward-declared, unused yet — preserved verbatim on load→save.
  interfaces: unknown[];
  assets: unknown[];
  customFields: unknown[];
}

export interface ValidationIssue {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  /** Object IDs this issue points at, for jump-to-object (DA-DES-2.5). */
  objectIds: string[];
}
