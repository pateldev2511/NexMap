/**
 * Schema constants and factory functions. Factories are the ONLY way to mint new
 * model objects so every object gets a stable ID and sane defaults in one place.
 */
import { nanoid } from 'nanoid';
import type {
  CanvasObject,
  Device,
  DeviceType,
  ImageObject,
  Layer,
  Link,
  NexMapDocument,
  ProjectMeta,
  Rack,
  ShapeObject,
  Subnet,
  TextObject,
  View,
  Vlan,
} from './types';

/** Bump when the on-disk shape changes; add a migration in migrate.ts. */
export const SCHEMA_VERSION = 1;
export const APP_VERSION = '0.1.0';

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
    ...partial,
  };
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
    text: 'Text',
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

export function createView(name: string, partial: Partial<View> = {}): View {
  return { id: nanoid(), name, hiddenLayers: [], ...partial };
}

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
    assets: [],
    customFields: [],
  };
}
