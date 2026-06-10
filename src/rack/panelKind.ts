/**
 * Map a device type → the rack front-panel style to draw (schema v3). Shared by the
 * live SVG editor and the pure export renderer so a "switch" looks like a switch in
 * both. Parametric: the actual jack/bay counts come from the device's interfaces, not
 * from per-model artwork.
 */
import type { DeviceType } from '@/model/types';

export type PanelKind =
  | 'switch' // jack rows + SFP cages
  | 'patch' // dense keystone port grid
  | 'server' // drive-bay array
  | 'firewall' // copper body + few ports
  | 'blade' // vertical blade modules
  | 'psu' // fan grilles + vents
  | 'cable-mgr' // horizontal slotted bar
  | 'blank'; // featureless 1U filler

export function panelKindFor(type: DeviceType): PanelKind {
  switch (type) {
    case 'switch':
    case 'router':
    case 'load-balancer':
    case 'access-point':
    case 'wireless-controller':
      return 'switch';
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
      return 'psu';
    default:
      return 'blank';
  }
}
