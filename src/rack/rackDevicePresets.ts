/**
 * Library presets for the rack designer (schema v3). Each entry is a draggable chip
 * in the left rail; dropping it creates a device of `type`, spanning `span` U, with
 * `ports` auto-populated interfaces named by `portName` (E5). Grouped for the rail.
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
  group: 'Switches' | 'Network' | 'Compute' | 'Power & cable' | 'Other';
}

const gi = (i: number) => `Gi1/0/${i + 1}`;
const nic = (i: number) => `nic${i}`;
const keystone = (i: number) => `${i + 1}`;
const eth = (i: number) => `eth${i}`;

const te = (i: number) => `Te1/${i + 1}`;

export const RACK_DEVICE_PRESETS: readonly RackDevicePreset[] = [
  // Switches
  { key: 'sw-48', label: '48-port switch', type: 'switch', span: 1, ports: 48, portName: gi, group: 'Switches' },
  { key: 'sw-24', label: '24-port switch', type: 'switch', span: 1, ports: 24, portName: gi, group: 'Switches' },
  { key: 'sw-16', label: '16-port switch', type: 'switch', span: 1, ports: 16, portName: gi, group: 'Switches' },
  { key: 'sw-8', label: '8-port switch', type: 'switch', span: 1, ports: 8, portName: gi, group: 'Switches' },
  { key: 'sw-4', label: '4-port switch', type: 'switch', span: 1, ports: 4, portName: gi, group: 'Switches' },
  { key: 'sw-core', label: 'Core switch (10G)', type: 'switch', span: 2, ports: 24, portName: te, group: 'Switches' },
  // Network appliances
  { key: 'router', label: 'Router', type: 'router', span: 1, ports: 8, portName: gi, group: 'Network' },
  { key: 'firewall', label: 'Firewall', type: 'firewall', span: 1, ports: 6, portName: eth, group: 'Network' },
  { key: 'lb', label: 'Load balancer', type: 'load-balancer', span: 1, ports: 4, portName: te, group: 'Network' },
  { key: 'wlc', label: 'WLAN controller', type: 'wireless-controller', span: 1, ports: 4, portName: gi, group: 'Network' },
  { key: 'console', label: 'Console server', type: 'switch', span: 1, ports: 16, portName: (i) => `tty${i + 1}`, group: 'Network' },
  // Compute
  { key: 'server-2u', label: 'Server (2U)', type: 'server', span: 2, ports: 2, portName: nic, group: 'Compute' },
  { key: 'server-1u', label: 'Server (1U)', type: 'server', span: 1, ports: 2, portName: nic, group: 'Compute' },
  { key: 'blade', label: 'Blade chassis (6U)', type: 'server', span: 6, ports: 0, portName: nic, group: 'Compute' },
  { key: 'storage', label: 'Storage / NAS (4U)', type: 'storage', span: 4, ports: 2, portName: nic, group: 'Compute' },
  { key: 'pc', label: 'PC / Host', type: 'end-user', span: 1, ports: 1, portName: eth, group: 'Compute' },
  // Power & cable
  { key: 'ups', label: 'UPS (2U)', type: 'ups', span: 2, ports: 0, portName: eth, group: 'Power & cable' },
  { key: 'psu', label: 'PSU shelf', type: 'ups', span: 2, ports: 0, portName: eth, group: 'Power & cable' },
  { key: 'pdu', label: 'PDU (0U rail)', type: 'ups', span: 6, ports: 8, portName: (i) => `C13-${i + 1}`, mount: 'rail', group: 'Power & cable' },
  { key: 'cable-mgr', label: 'Cable manager', type: 'generic', span: 1, ports: 0, portName: eth, group: 'Power & cable' },
  // Other
  { key: 'patch-24', label: 'Patch panel (24)', type: 'patch-panel', span: 1, ports: 24, portName: keystone, group: 'Other' },
  { key: 'patch-48', label: 'Patch panel (48)', type: 'patch-panel', span: 1, ports: 48, portName: keystone, group: 'Other' },
  { key: 'fiber', label: 'Fiber patch (24)', type: 'patch-panel', span: 1, ports: 24, portName: (i) => `LC${i + 1}`, group: 'Other' },
  { key: 'blank', label: 'Blanking panel', type: 'generic', span: 1, ports: 0, portName: eth, group: 'Other' },
  { key: 'shelf', label: 'Shelf (2U)', type: 'generic', span: 2, ports: 0, portName: eth, group: 'Other' },
] as const;

export const RACK_PRESET_GROUPS = ['Switches', 'Network', 'Compute', 'Power & cable', 'Other'] as const;
