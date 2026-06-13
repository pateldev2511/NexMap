/**
 * NexMap data model.
 *
 * Invariants (from PLAN.md §2 / spec Data Model):
 *  - Every object has a stable string ID.
 *  - Links reference device IDs, never names — renaming never breaks a connection.
 *  - Unknown/future fields are preserved through load→save via `extra` (DA-D1).
 *  - Links connect DEVICE IDs with optional free-text endpoint interface labels.
 *    `interfaces[]` is reserved for a future first-class port/interface model.
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

/**
 * A first-class network interface/port on a device (schema v2). Embedded under its
 * device (`Device.interfaces`) so deletes cascade for free and there is no orphan-
 * interface class of bug. Links reference an interface by `{deviceId, ifaceId}`.
 */
export interface Interface {
  id: string;
  /** Port name, e.g. "Gi0/1", "eth0", "Te1/1/1". */
  name: string;
  /** Free-text media/kind for v1 (ethernet, fiber, sfp+, …). */
  kind?: string;
  /** Link speed, e.g. "1G", "10G". */
  speed?: string;
  /**
   * Access (or native) VLAN id tagged on this port, 1–4094 (schema v3 additive). Absent →
   * untagged/unset. Drives the rack VLAN-mismatch health check and the cable schedule.
   */
  vlan?: number;
  notes?: string;
  extra?: ExtraFields;
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
  // Core device properties. Custom/integration-specific fields live in `extra`.
  vendor?: string;
  model?: string;
  role?: string;
  location?: string;
  managementIp?: string;
  notes?: string;
  /**
   * Rich-text component description (sanitized HTML, schema v2 additive). UNTRUSTED on
   * load — always run through sanitizeHtml() before rendering with dangerouslySetInnerHTML.
   */
  descriptionHtml?: string;
  /**
   * On-canvas icon size multiplier (schema v2 additive). 1 = default. Drives the
   * rendered icon scale in both flat and iso projections. Absent = 1 (back-compat).
   */
  iconScale?: number;
  /**
   * Height in px the floating info card sits above the node, driving the dotted
   * leader line (schema v2 additive). Absent = DEFAULT_LABEL_HEIGHT.
   */
  labelHeight?: number;
  fill?: string;
  /** Rack placement (Phase 4): rack id, lowest occupied RU (1-based), height in U. */
  rackId?: string;
  ru?: number;
  ruSpan?: number;
  /**
   * Rack slot qualifiers (schema v3, additive). `ru`/`ruSpan` remain the CANONICAL
   * vertical position; these only add the mount face, half-width bay, and mount kind.
   * Absent → rack-mounted, front, full-width (back-compat for v2 racked devices).
   *  - mount 'rail' = 0U side channel (PDU / vertical cable manager); does NOT consume U.
   *  - bay 'left'/'right' = two half-width devices share one U; 'full' spans the whole bay.
   */
  mount?: 'rack' | 'rail';
  side?: 'front' | 'rear';
  bay?: 'full' | 'left' | 'right';
  /** Power draw (watts) and weight (kg) for the rack power/weight budget. Optional. */
  watts?: number;
  weightKg?: number;
  /**
   * Which power feed(s) this device cords into (schema v3 additive): 'A' or 'B' = single-
   * corded to that feed (a single point of failure); 'AB' = dual-corded / redundant PSUs
   * (survives losing either feed). Absent → single feed 'A' (back-compat).
   */
  powerFeed?: 'A' | 'B' | 'AB';
  /**
   * Lifecycle state (schema v3 additive). Absent → 'active'. Drives a status tint on the
   * rack art so planned/decommissioned gear reads differently from live gear.
   */
  status?: 'planned' | 'active' | 'maintenance' | 'decommissioned';
  /** Asset-tracking fields (schema v3 additive). Free-text, optional. */
  serial?: string;
  assetTag?: string;
  owner?: string;
  /** Warranty expiry as an ISO date string (YYYY-MM-DD). */
  warrantyExpiry?: string;
  /** Locked devices can't be moved or deleted until unlocked. */
  locked?: boolean;
  /** Stacking order; higher renders on top. Default 0. */
  z?: number;
  /** Devices sharing a groupId select and move together. */
  groupId?: string;
  /** First-class interfaces/ports (schema v2). Empty array on migrated v1 devices. */
  interfaces?: Interface[];
  extra?: ExtraFields;
}

export interface Link {
  id: string;
  kind: 'link';
  name?: string;
  /** Device IDs. */
  sourceId: string;
  targetId: string;
  /**
   * Endpoint interface references (schema v2): the id of an Interface on the source/
   * target device. The free-text *Interface labels below are kept in sync for display
   * and export, and remain the fallback when no first-class interface is assigned.
   */
  sourceIfaceId?: string;
  targetIfaceId?: string;
  /** Free-text endpoint labels (kept in sync with the assigned interface's name). */
  sourceInterface?: string;
  targetInterface?: string;
  linkType?: string;
  bandwidth?: string;
  /** Trunk carries multiple VLANs; access carries one. */
  mode?: 'access' | 'trunk';
  /**
   * True when this edge was inferred from reachability (e.g. a scan) rather than a
   * confirmed L2 adjacency. Topology-health reads it to caveat SPOF/redundancy results.
   * Optional + additive — no schema bump (older builds simply ignore it).
   */
  inferred?: boolean;
  layerId: string;
  /** Intermediate reroute points (canvas coords); path runs source → waypoints → target. */
  waypoints?: { x: number; y: number }[];
  /** Arrowhead placement. */
  arrow?: 'none' | 'end' | 'both';
  /** Line style. */
  style?: 'solid' | 'dashed';
  /** Manual stroke color (overrides health-derived tint). Schema v2 additive. */
  color?: string;
  /** Manual stroke width in px (overrides bandwidth-derived width). Schema v2 additive. */
  width?: number;
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
  /** Body / description text. */
  text: string;
  /** Optional annotation-card title + subtitle (schema v2 additive). */
  heading?: string;
  subheading?: string;
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
  /** Render projection for this view (Phase 9). Absent = flat (back-compat). */
  projection?: 'flat' | 'iso';
}

export interface Rack {
  id: string;
  name: string;
  /** Total rack units (e.g. 42). */
  ruHeight: number;
  site?: string;
  notes?: string;
  /** Rack form factor (schema v3, additive). Absent → four-post 19". */
  postType?: 'two-post' | 'four-post' | 'wall';
  widthIn?: 19 | 23;
  /** Id of the rackTypes preset this rack was created from (schema v3). */
  presetId?: string;
  /** Capacity caps for the power/weight budget (additive, optional). */
  maxWatts?: number;
  maxWeightKg?: number;
  /** Left-to-right order in the multi-rack row view; absent → insertion order. */
  order?: number;
  extra?: ExtraFields;
}

/** One end of a rack cable: a physical port on a device (schema v3). */
export interface RackCableEnd {
  deviceId: string;
  ifaceId: string;
}

/**
 * A physical patch cable between two device ports (schema v3). Kept in its OWN
 * `rackCables[]` collection, NOT in `links[]`, so the physical layer never pollutes
 * the logical topology (validation, health, NexText, topology render are untouched).
 * Endpoints reference embedded `Device.interfaces` by id; deleting/regenerating a
 * device or its interfaces cascade-prunes the cables that referenced them.
 */
export interface RackCable {
  id: string;
  aEnd: RackCableEnd;
  bEnd: RackCableEnd;
  /** Literal hex (e.g. "#22d3ee"); reuses the existing Link color control. */
  color: string;
  label?: string;
  /** Optional, user-entered run length in feet (v1: no auto-compute). */
  lengthFt?: number;
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
 * Reserved collections are kept as `unknown[]` so the schema is forward-stable
 * and can round-trip future content without dropping it.
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
  /** Physical rack cables (schema v3). Separate from logical `links[]`. */
  rackCables: RackCable[];
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
