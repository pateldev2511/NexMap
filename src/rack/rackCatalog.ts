/**
 * Named vendor-model catalog (schema v3). Real-world gear with its U-height, port count,
 * nominal power, and weight so a user can tag a device as a known model and pull accurate
 * specs instead of guessing. Applying a model fills vendor/model/watts/weightKg (the safe,
 * non-destructive fields — it never silently changes a placed device's U-span or rewires
 * its ports). Numbers are typical/nominal, not guarantees. Pure data + lookup helpers.
 */
import type { DeviceType } from '@/model/types';

export interface CatalogModel {
  id: string;
  vendor: string;
  model: string;
  type: DeviceType;
  /** U-height. */
  span: number;
  /** Front data ports (informational; placement still owns the actual port set). */
  ports: number;
  /** Nominal power draw, watts (0 for power sources). */
  watts: number;
  /** Nominal weight, kg. */
  weightKg: number;
}

export const RACK_CATALOG: readonly CatalogModel[] = [
  // Switches
  { id: 'cisco-c9300-24t', vendor: 'Cisco', model: 'Catalyst 9300-24T', type: 'switch', span: 1, ports: 24, watts: 350, weightKg: 5 },
  { id: 'cisco-c9300-48p', vendor: 'Cisco', model: 'Catalyst 9300-48P', type: 'switch', span: 1, ports: 48, watts: 715, weightKg: 6.6 },
  { id: 'cisco-n9336c', vendor: 'Cisco', model: 'Nexus 9336C-FX2', type: 'switch', span: 1, ports: 36, watts: 650, weightKg: 9 },
  { id: 'arista-7050sx3-48', vendor: 'Arista', model: '7050SX3-48YC8', type: 'switch', span: 1, ports: 48, watts: 250, weightKg: 7 },
  { id: 'juniper-ex4300-48t', vendor: 'Juniper', model: 'EX4300-48T', type: 'switch', span: 1, ports: 48, watts: 350, weightKg: 5.5 },
  { id: 'ubnt-usw-pro-48', vendor: 'Ubiquiti', model: 'USW-Pro-48', type: 'switch', span: 1, ports: 48, watts: 60, weightKg: 5 },
  { id: 'hpe-aruba-6300m', vendor: 'HPE Aruba', model: '6300M 48G', type: 'switch', span: 1, ports: 48, watts: 500, weightKg: 6 },
  { id: 'netgear-gs724t', vendor: 'Netgear', model: 'GS724T', type: 'switch', span: 1, ports: 24, watts: 30, weightKg: 3 },
  // Routers
  { id: 'cisco-isr4331', vendor: 'Cisco', model: 'ISR 4331', type: 'router', span: 1, ports: 3, watts: 100, weightKg: 6 },
  { id: 'cisco-asr1001x', vendor: 'Cisco', model: 'ASR 1001-X', type: 'router', span: 1, ports: 6, watts: 250, weightKg: 12 },
  { id: 'juniper-mx204', vendor: 'Juniper', model: 'MX204', type: 'router', span: 1, ports: 8, watts: 400, weightKg: 9 },
  { id: 'mikrotik-ccr2004', vendor: 'MikroTik', model: 'CCR2004-16G', type: 'router', span: 1, ports: 16, watts: 60, weightKg: 3 },
  // Firewalls
  { id: 'palo-pa3220', vendor: 'Palo Alto', model: 'PA-3220', type: 'firewall', span: 1, ports: 8, watts: 150, weightKg: 9 },
  { id: 'forti-100f', vendor: 'Fortinet', model: 'FortiGate 100F', type: 'firewall', span: 1, ports: 22, watts: 40, weightKg: 4 },
  { id: 'cisco-fpr1140', vendor: 'Cisco', model: 'Firepower 1140', type: 'firewall', span: 1, ports: 12, watts: 100, weightKg: 6 },
  { id: 'netgate-6100', vendor: 'Netgate', model: '6100 (pfSense)', type: 'firewall', span: 1, ports: 6, watts: 35, weightKg: 3 },
  // Load balancer
  { id: 'f5-i2800', vendor: 'F5', model: 'BIG-IP i2800', type: 'load-balancer', span: 1, ports: 8, watts: 300, weightKg: 11 },
  // Wireless controller
  { id: 'cisco-c9800-40', vendor: 'Cisco', model: 'Catalyst 9800-40', type: 'wireless-controller', span: 1, ports: 4, watts: 250, weightKg: 8 },
  // Servers
  { id: 'dell-r650', vendor: 'Dell', model: 'PowerEdge R650', type: 'server', span: 1, ports: 4, watts: 700, weightKg: 18 },
  { id: 'dell-r750', vendor: 'Dell', model: 'PowerEdge R750', type: 'server', span: 2, ports: 4, watts: 1100, weightKg: 28 },
  { id: 'hpe-dl360-g11', vendor: 'HPE', model: 'ProLiant DL360 Gen11', type: 'server', span: 1, ports: 4, watts: 800, weightKg: 18 },
  { id: 'hpe-dl380-g11', vendor: 'HPE', model: 'ProLiant DL380 Gen11', type: 'server', span: 2, ports: 4, watts: 1200, weightKg: 28 },
  { id: 'supermicro-1029u', vendor: 'Supermicro', model: 'SYS-1029U', type: 'server', span: 1, ports: 2, watts: 750, weightKg: 18 },
  { id: 'lenovo-sr650', vendor: 'Lenovo', model: 'ThinkSystem SR650', type: 'server', span: 2, ports: 4, watts: 1100, weightKg: 27 },
  // Storage
  { id: 'synology-rs3621', vendor: 'Synology', model: 'RS3621xs+', type: 'storage', span: 2, ports: 4, watts: 350, weightKg: 16 },
  { id: 'dell-me5024', vendor: 'Dell', model: 'PowerVault ME5024', type: 'storage', span: 2, ports: 4, watts: 580, weightKg: 30 },
  { id: 'netapp-fas2750', vendor: 'NetApp', model: 'FAS2750', type: 'storage', span: 2, ports: 8, watts: 450, weightKg: 24 },
  // UPS (power sources → 0 W draw)
  { id: 'apc-srt2200', vendor: 'APC', model: 'Smart-UPS SRT 2200', type: 'ups', span: 2, ports: 0, watts: 0, weightKg: 23 },
  { id: 'eaton-5px3000', vendor: 'Eaton', model: '5PX 3000', type: 'ups', span: 2, ports: 0, watts: 0, weightKg: 28 },
  { id: 'cyberpower-or1500', vendor: 'CyberPower', model: 'OR1500LCDRM1U', type: 'ups', span: 1, ports: 0, watts: 0, weightKg: 13 },
  // Patch panels
  { id: 'panduit-24', vendor: 'Panduit', model: '24-port Cat6 patch', type: 'patch-panel', span: 1, ports: 24, watts: 0, weightKg: 1.5 },
  { id: 'panduit-48', vendor: 'Panduit', model: '48-port Cat6 patch', type: 'patch-panel', span: 1, ports: 48, watts: 0, weightKg: 2.5 },
] as const;

/** Models matching a device type (so a switch only offers switch models). */
export function catalogForType(type: DeviceType): CatalogModel[] {
  return RACK_CATALOG.filter((m) => m.type === type);
}

export function catalogById(id: string): CatalogModel | undefined {
  return RACK_CATALOG.find((m) => m.id === id);
}

/** One-line spec summary for a picker label, e.g. "1U · 48p · 715W". */
export function catalogSpecLabel(m: CatalogModel): string {
  const parts = [`${m.span}U`];
  if (m.ports > 0) parts.push(`${m.ports}p`);
  if (m.watts > 0) parts.push(`${m.watts}W`);
  parts.push(`${m.weightKg}kg`);
  return parts.join(' · ');
}
