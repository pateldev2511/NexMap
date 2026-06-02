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
  layerId: string;
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
  // Forward-declared, unused in MVP — preserved verbatim on load→save.
  views: unknown[];
  objects: unknown[];
  interfaces: unknown[];
  vlans: unknown[];
  subnets: unknown[];
  racks: unknown[];
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
