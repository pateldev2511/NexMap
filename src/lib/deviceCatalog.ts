/**
 * Preset catalogs for the inspector's vendor / model / role combo-boxes. These back a
 * `<datalist>` so the user gets sensible suggestions but can always type a custom value
 * (free text wins — these are hints, not a closed enum). Keep lists short and common;
 * exhaustiveness is not the goal.
 */

export const VENDORS = [
  'Cisco',
  'Juniper',
  'Arista',
  'HPE / Aruba',
  'Fortinet',
  'Palo Alto',
  'MikroTik',
  'Ubiquiti',
  'Dell',
  'Huawei',
  'Netgear',
  'F5',
  'Check Point',
  'Extreme',
] as const;

export const MODELS = [
  'Catalyst 9300',
  'Catalyst 9500',
  'Nexus 9000',
  'ISR 4000',
  'EX4400',
  'MX204',
  'FortiGate 100F',
  'PA-440',
  'UniFi USW-Pro',
  'PowerSwitch S5200',
] as const;

export const ROLES = [
  'Core',
  'Distribution',
  'Access',
  'Edge',
  'Border',
  'Spine',
  'Leaf',
  'Gateway',
  'Firewall',
  'Load Balancer',
  'Out-of-band',
] as const;
