/**
 * Schema constants and factory functions. Factories are the ONLY way to mint new
 * model objects so every object gets a stable ID and sane defaults in one place.
 */
import { nanoid } from 'nanoid';
import { paragraphBlocks } from './callout';
import type {
  CanvasObject,
  Device,
  DeviceType,
  ImageObject,
  Interface,
  Layer,
  Link,
  NexMapDocument,
  ProjectMeta,
  Rack,
  RackCable,
  ShapeObject,
  Subnet,
  TextObject,
  View,
  Vlan,
} from './types';

/** Bump when the on-disk shape changes; add a migration in migrate.ts. */
export const SCHEMA_VERSION = 7;
/** The running release, from package.json (injected by vite.config.ts `define`). */
export const APP_VERSION = __APP_VERSION__;

export const DEFAULT_DEVICE_SIZE = { width: 56, height: 40 } as const;

/** Default device label per type, used when dropping from the library. */
const TYPE_LABEL: Record<DeviceType, string> = {
  router: 'Router',
  switch: 'Switch',
  firewall: 'Firewall',
  'access-point': 'AP',
  'wireless-controller': 'WLC',
  server: 'Server',
  storage: 'Storage',
  'load-balancer': 'LB',
  'end-user': 'PC',
  printer: 'Printer',
  iot: 'IoT',
  isp: 'ISP',
  cloud: 'Cloud',
  vm: 'VM',
  container: 'Container',
  rack: 'Rack',
  'patch-panel': 'Patch Panel',
  ups: 'UPS',
  camera: 'Camera',
  laptop: 'Laptop',
  'ip-phone': 'IP Phone',
  mobile: 'Mobile',
  modem: 'Modem',
  nas: 'NAS',
  vpc: 'VPC / VNet',
  'cloud-subnet': 'Cloud Subnet',
  'internet-gateway': 'Internet GW',
  'nat-gateway': 'NAT GW',
  'route-table': 'Route Table',
  'security-group': 'Security Group',
  'vpn-gateway': 'VPN GW',
  k8s: 'Kubernetes',
  'managed-db': 'Managed DB',
  'object-storage': 'Object Storage',
  generic: 'Node',
};

/** Every device type, in palette order (the keys of the label table). */
export const DEVICE_TYPES = Object.keys(TYPE_LABEL) as DeviceType[];

export function defaultDeviceName(type: DeviceType): string {
  return TYPE_LABEL[type];
}

export function createLayer(
  name: string,
  order: number,
  partial: Partial<Layer> = {},
): Layer {
  return { id: nanoid(), name, visible: true, locked: false, order, ...partial };
}

export function createDevice(
  type: DeviceType,
  x: number,
  y: number,
  layerId: string,
  partial: Partial<Device> = {},
): Device {
  return {
    id: nanoid(),
    kind: 'device',
    type,
    name: defaultDeviceName(type),
    x,
    y,
    width: DEFAULT_DEVICE_SIZE.width,
    height: DEFAULT_DEVICE_SIZE.height,
    layerId,
    interfaces: [],
    ...partial,
  };
}

/** Mint a first-class interface (schema v2). */
export function createInterface(name: string, partial: Partial<Interface> = {}): Interface {
  return { id: nanoid(), name, ...partial };
}

export function createLink(
  sourceId: string,
  targetId: string,
  layerId: string,
  partial: Partial<Link> = {},
): Link {
  return { id: nanoid(), kind: 'link', sourceId, targetId, layerId, ...partial };
}

export function createTextObject(
  x: number,
  y: number,
  layerId: string,
  partial: Partial<TextObject> = {},
): TextObject {
  return {
    id: nanoid(),
    kind: 'text',
    x,
    y,
    width: 160,
    height: 28,
    layerId,
    blocks: paragraphBlocks('Text'),
    fontSize: 14,
    ...partial,
  };
}

export function createShapeObject(
  x: number,
  y: number,
  width: number,
  height: number,
  layerId: string,
  partial: Partial<ShapeObject> = {},
): ShapeObject {
  return {
    id: nanoid(),
    kind: 'shape',
    shape: 'rect',
    x,
    y,
    width,
    height,
    layerId,
    ...partial,
  };
}

export function createImageObject(
  x: number,
  y: number,
  width: number,
  height: number,
  layerId: string,
  href: string,
  partial: Partial<ImageObject> = {},
): ImageObject {
  return {
    id: nanoid(),
    kind: 'image',
    x,
    y,
    width,
    height,
    layerId,
    href,
    z: -1000,
    ...partial,
  };
}

export function createVlan(
  vlanId: number,
  name: string,
  partial: Partial<Vlan> = {},
): Vlan {
  return { id: nanoid(), vlanId, name, ...partial };
}

export function createSubnet(cidr: string, partial: Partial<Subnet> = {}): Subnet {
  return { id: nanoid(), cidr, ...partial };
}

export function createRack(
  name: string,
  ruHeight = 42,
  partial: Partial<Rack> = {},
): Rack {
  return { id: nanoid(), name, ruHeight, ...partial };
}

/** Mint a physical rack cable between two device ports (schema v3). */
export function createRackCable(
  aEnd: RackCable['aEnd'],
  bEnd: RackCable['bEnd'],
  color: string,
  partial: Partial<RackCable> = {},
): RackCable {
  return { id: nanoid(), aEnd, bEnd, color, ...partial };
}

export function createView(name: string, partial: Partial<View> = {}): View {
  return { id: nanoid(), name, hiddenLayers: [], ...partial };
}

/**
 * The only image sources a document may carry: an EMBEDDED image — an inline
 * `data:image/<subtype>` URI, whatever the subtype (png, tiff, heic, x-icon… paste
 * accepts every `image/*`, and none of them can reach the network). Anything else
 * — `https:`, `//host`, `file:`, `blob:`, `javascript:`, a non-image data URI —
 * would make an exported SVG/HTML fetch from the network (or worse) when its
 * recipient opens it, which the local-first promise forbids. Checked wherever an
 * image enters the document (addImage, load, paste) and again by the exporters.
 */
const SAFE_IMAGE_HREF = /^data:image\/[a-z0-9.+-]+[;,]/i;

export function isSafeImageHref(href: unknown): href is string {
  return typeof href === 'string' && SAFE_IMAGE_HREF.test(href);
}

/** Whether an (unsafe) image source names somewhere outside the file, for the warning text. */
export function isRemoteHref(href: unknown): boolean {
  return typeof href === 'string' && /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href);
}

/**
 * A paint value safe to write into an exported SVG attribute: a hex colour, a
 * colour name / keyword (`none`, `transparent`, `currentColor`…), an
 * rgb()/rgba()/hsl()/hsla() function, or a `var(--token)`. Above all NOT a
 * `url(...)` paint server: `stroke="url(https://…)"` makes the export's reader
 * fetch it. The app's own pickers store hex.
 */
const SAFE_COLOR =
  /^(?:#[0-9a-f]{3,8}|[a-z]{1,32}|(?:rgba?|hsla?)\([-+0-9.,%\s/a-z]{1,64}\)|var\(--[a-z0-9_-]{1,64}\))$/i;

export function isSafeColor(value: unknown): value is string {
  return typeof value === 'string' && !/url\s*\(/i.test(value) && SAFE_COLOR.test(value.trim());
}

/** `value` if it is a safe paint, else `fallback`. */
export function safeColor(value: unknown, fallback: string): string {
  return isSafeColor(value) ? value.trim() : fallback;
}

/** Tallest rack the editor supports: the elevation draws one row per U. */
export const MIN_RACK_UNITS = 1;
export const MAX_RACK_UNITS = 1000;

/** A rack height as the editor stores it: a whole number of U, 1–1000. */
export function clampRackUnits(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return MIN_RACK_UNITS;
  return Math.min(MAX_RACK_UNITS, Math.max(MIN_RACK_UNITS, Math.round(n)));
}

/** Largest |x|, |y|, width or height a device/object may have (scene px). */
export const MAX_COORD = 1e7;

export function isCanvasObject(v: unknown): v is CanvasObject {
  const k = (v as CanvasObject | null)?.kind;
  return (
    typeof v === 'object' &&
    v !== null &&
    (k === 'text' || k === 'shape' || k === 'image')
  );
}

export function createProjectMeta(
  now: string,
  partial: Partial<ProjectMeta> = {},
): ProjectMeta {
  return {
    id: nanoid(),
    name: 'Untitled NexMap Project',
    createdAt: now,
    updatedAt: now,
    description: '',
    units: 'px',
    ...partial,
  };
}

/**
 * A fresh, empty document. `now` is passed in (never Date.now() inside the model)
 * so the model stays pure and deterministic for tests.
 */
export function createEmptyDocument(now: string): NexMapDocument {
  const layer = createLayer('Default', 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    project: createProjectMeta(now),
    layers: [layer],
    devices: [],
    links: [],
    views: [],
    objects: [],
    interfaces: [],
    vlans: [],
    subnets: [],
    racks: [],
    rackCables: [],
    invariants: [],
    customRules: [],
    assets: [],
    customFields: [],
  };
}
