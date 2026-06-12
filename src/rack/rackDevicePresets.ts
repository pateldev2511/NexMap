/**
 * Library presets for the rack designer (schema v3). Each entry is a draggable chip
 * in the left rail; dropping it creates a device of `type`, spanning `span` U, with
 * `ports` auto-populated interfaces named by `portName` (E5). Grouped for the rail.
 *
 * Each preset also carries nominal `watts` (typical power draw) and `weightKg` so the
 * per-rack power/weight budget reads real numbers the moment gear is placed — a UPS/PDU
 * is a power SOURCE, so its draw is 0. These are sensible generic defaults; picking a
 * specific vendor model (see rackCatalog.ts) overrides them.
 */
import type { DeviceType } from '@/model/types';

export interface RackDevicePreset {
  key: string;
  label: string;
  type: DeviceType;
  span: number;
  ports: number;
  /** Build the i-th port name (0-based). */
  portName: (i: number) => string;
  /** 'rail' = 0U side channel (PDU / vertical manager); does not consume U. Default 'rack'. */
  mount?: 'rack' | 'rail';
  /** Nominal power draw in watts (0 for passive gear and power sources). */
  watts: number;
  /** Nominal weight in kilograms. */
  weightKg: number;
  group: 'Switches' | 'Network' | 'Compute' | 'Power & cable' | 'Other';
}

const gi = (i: number) => `Gi1/0/${i + 1}`;
const nic = (i: number) => `nic${i}`;
const keystone = (i: number) => `${i + 1}`;
const eth = (i: number) => `eth${i}`;

const te = (i: number) => `Te1/${i + 1}`;

export const RACK_DEVICE_PRESETS: readonly RackDevicePreset[] = [
  // Switches
  { key: 'sw-48', label: '48-port switch', type: 'switch', span: 1, ports: 48, portName: gi, watts: 120, weightKg: 5, group: 'Switches' },
  { key: 'sw-24', label: '24-port switch', type: 'switch', span: 1, ports: 24, portName: gi, watts: 60, weightKg: 4, group: 'Switches' },
  { key: 'sw-16', label: '16-port switch', type: 'switch', span: 1, ports: 16, portName: gi, watts: 30, weightKg: 3, group: 'Switches' },
  { key: 'sw-8', label: '8-port switch', type: 'switch', span: 1, ports: 8, portName: gi, watts: 15, weightKg: 2, group: 'Switches' },
  { key: 'sw-4', label: '4-port switch', type: 'switch', span: 1, ports: 4, portName: gi, watts: 10, weightKg: 1.5, group: 'Switches' },
  { key: 'sw-core', label: 'Core switch (10G)', type: 'switch', span: 2, ports: 24, portName: te, watts: 350, weightKg: 9, group: 'Switches' },
  // Network appliances
  { key: 'router', label: 'Router', type: 'router', span: 1, ports: 8, portName: gi, watts: 80, weightKg: 4, group: 'Network' },
  { key: 'firewall', label: 'Firewall', type: 'firewall', span: 1, ports: 6, portName: eth, watts: 60, weightKg: 4, group: 'Network' },
  { key: 'lb', label: 'Load balancer', type: 'load-balancer', span: 1, ports: 4, portName: te, watts: 100, weightKg: 5, group: 'Network' },
  { key: 'wlc', label: 'WLAN controller', type: 'wireless-controller', span: 1, ports: 4, portName: gi, watts: 60, weightKg: 4, group: 'Network' },
  { key: 'console', label: 'Console server', type: 'switch', span: 1, ports: 16, portName: (i) => `tty${i + 1}`, watts: 25, weightKg: 3, group: 'Network' },
  // Compute
  { key: 'server-2u', label: 'Server (2U)', type: 'server', span: 2, ports: 2, portName: nic, watts: 400, weightKg: 18, group: 'Compute' },
  { key: 'server-1u', label: 'Server (1U)', type: 'server', span: 1, ports: 2, portName: nic, watts: 250, weightKg: 12, group: 'Compute' },
  { key: 'blade', label: 'Blade chassis (6U)', type: 'server', span: 6, ports: 0, portName: nic, watts: 2500, weightKg: 90, group: 'Compute' },
  { key: 'storage', label: 'Storage / NAS (4U)', type: 'storage', span: 4, ports: 2, portName: nic, watts: 300, weightKg: 30, group: 'Compute' },
  { key: 'pc', label: 'PC / Host', type: 'end-user', span: 1, ports: 1, portName: eth, watts: 200, weightKg: 8, group: 'Compute' },
  // Power & cable (UPS/PSU/PDU are power SOURCES → 0 W draw)
  { key: 'ups', label: 'UPS (2U)', type: 'ups', span: 2, ports: 0, portName: eth, watts: 0, weightKg: 25, group: 'Power & cable' },
  { key: 'psu', label: 'PSU shelf', type: 'ups', span: 2, ports: 0, portName: eth, watts: 0, weightKg: 15, group: 'Power & cable' },
  { key: 'pdu', label: 'PDU (0U rail)', type: 'ups', span: 6, ports: 8, portName: (i) => `C13-${i + 1}`, mount: 'rail', watts: 0, weightKg: 3, group: 'Power & cable' },
  { key: 'cable-mgr', label: 'Cable manager', type: 'generic', span: 1, ports: 0, portName: eth, watts: 0, weightKg: 1, group: 'Power & cable' },
  // Other
  { key: 'patch-24', label: 'Patch panel (24)', type: 'patch-panel', span: 1, ports: 24, portName: keystone, watts: 0, weightKg: 1.5, group: 'Other' },
  { key: 'patch-48', label: 'Patch panel (48)', type: 'patch-panel', span: 1, ports: 48, portName: keystone, watts: 0, weightKg: 2.5, group: 'Other' },
  { key: 'fiber', label: 'Fiber patch (24)', type: 'patch-panel', span: 1, ports: 24, portName: (i) => `LC${i + 1}`, watts: 0, weightKg: 1.5, group: 'Other' },
  { key: 'blank', label: 'Blanking panel', type: 'generic', span: 1, ports: 0, portName: eth, watts: 0, weightKg: 0.3, group: 'Other' },
  { key: 'shelf', label: 'Shelf (2U)', type: 'generic', span: 2, ports: 0, portName: eth, watts: 0, weightKg: 3, group: 'Other' },
] as const;

export const RACK_PRESET_GROUPS = ['Switches', 'Network', 'Compute', 'Power & cable', 'Other'] as const;

/** Look up a preset by its key. */
export function presetByKey(key: string): RackDevicePreset | undefined {
  return RACK_DEVICE_PRESETS.find((p) => p.key === key);
}
