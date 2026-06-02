/**
 * Schema constants and factory functions. Factories are the ONLY way to mint new
 * model objects so every object gets a stable ID and sane defaults in one place.
 */
import { nanoid } from 'nanoid';
import type {
  Device,
  DeviceType,
  Layer,
  Link,
  NexMapDocument,
  ProjectMeta,
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
  generic: 'Node',
};

export function defaultDeviceName(type: DeviceType): string {
  return TYPE_LABEL[type];
}

export function createLayer(name: string, order: number, partial: Partial<Layer> = {}): Layer {
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
