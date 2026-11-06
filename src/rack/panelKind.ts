/**
 * Map a device type → the rack front-panel style to draw (schema v3). Shared by the
 * live SVG editor and the pure export renderer so a "switch" looks like a switch in
 * both. Parametric: the actual jack/bay counts come from the device's interfaces, not
 * from per-model artwork.
 */
import type { Device, DeviceType } from '@/model/types';

export type PanelKind =
  | 'switch' // jack rows + SFP cages
  | 'appliance' // router / LB / WLC: solid body, few ports, console + accent
  | 'patch' // dense keystone port grid
  | 'server' // drive-bay array
  | 'firewall' // copper body + few ports
  | 'blade' // vertical blade modules
  | 'ups' // battery module + status LCD + outlets
  | 'psu' // fan grilles + vents
  | 'cable-mgr' // horizontal slotted bar
  | 'blank'; // featureless 1U filler

export function panelKindFor(type: DeviceType): PanelKind {
  switch (type) {
    case 'switch':
      return 'switch';
    case 'router':
    case 'load-balancer':
    case 'access-point':
    case 'wireless-controller':
      return 'appliance';
    case 'patch-panel':
      return 'patch';
    case 'server':
    case 'storage':
    case 'vm':
    case 'container':
      return 'server';
    case 'firewall':
      return 'firewall';
    case 'ups':
      return 'ups';
    default:
      return 'blank';
  }
}

/**
 * Is this device a horizontal cable manager? Its type is 'generic', so new ones are marked
 * (`rackAccessory`); unmarked ones from older designs are known by their stock names
 * ("Cable manager 2", a template's "cm-01") unless marked 'none'.
 */
export function isCableManager(device: Pick<Device, 'type' | 'name' | 'rackAccessory'>): boolean {
  if (device.rackAccessory) return device.rackAccessory === 'cable-manager';
  return device.type === 'generic' && /^(cable manager( \d+)?|cm-?\d+)$/i.test(device.name.trim());
}

/** Panel style for a specific device: a cable manager draws as one, not a blank. */
export function panelKindForDevice(device: Pick<Device, 'type' | 'name' | 'rackAccessory'>): PanelKind {
  return isCableManager(device) ? 'cable-mgr' : panelKindFor(device.type);
}
