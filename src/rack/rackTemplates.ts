/**
 * Pre-made rack designs (schema v3) so a user can quick-start instead of building from an
 * empty cabinet. Each template is a list of racks, each rack a chosen form-factor
 * (`rackPresetId` → rackTypes.ts) holding devices placed by `presetKey`
 * (→ rackDevicePresets.ts) at a given lowest-U. Applying a template is one undoable edit
 * (store.applyRackTemplate) that APPENDS the racks to the current row — never destructive.
 *
 * Tiers: 'home' (wall cabinets, a few devices), 'office' (IDF / server closet),
 * 'enterprise' (full 42U cabinets, redundant gear). Names are meaningful so the cable
 * schedule and labels read well out of the box.
 */
import type { Side } from './rackModel';

export type RackTier = 'home' | 'office' | 'enterprise';

export interface TemplateDevice {
  /** References a RACK_DEVICE_PRESETS key. */
  presetKey: string;
  /** Lowest occupied U (1-based). The preset supplies the U-span. */
  ru: number;
  /** Friendly device name (drives auto labels + cable schedule). */
  name?: string;
  side?: Side;
  /** Optional vendor/model catalog id for richer specs and model-aware rack art. */
  catalogId?: string;
}

export interface TemplateRack {
  name: string;
  /** References a RACK_PRESETS id (rackTypes.ts). */
  rackPresetId: string;
  devices: TemplateDevice[];
}

export interface RackTemplate {
  id: string;
  tier: RackTier;
  label: string;
  hint: string;
  racks: TemplateRack[];
}

/** Terse device-row helper. */
const d = (presetKey: string, ru: number, name?: string, side?: Side, catalogId?: string): TemplateDevice => ({ presetKey, ru, name, side, catalogId });

export const RACK_TEMPLATES: readonly RackTemplate[] = [
  // ── Home ──────────────────────────────────────────────────────────────────
  {
    id: 'home-lab-6u',
    tier: 'home',
    label: 'Home lab (6U)',
    hint: 'Wall cabinet: patch, switch, router, NAS, UPS',
    racks: [
      {
        name: 'Home lab', rackPresetId: 'wall-6u', devices: [
          d('patch-24', 6, 'patch-01', undefined, 'panduit-24'), d('sw-8', 5, 'home-sw', undefined, 'netgear-gs724t'), d('router', 4, 'edge-rtr', undefined, 'mikrotik-ccr2004'),
          d('server-1u', 3, 'nas-01', undefined, 'hpe-dl360-g11'), d('ups', 1, 'ups-01', undefined, 'apc-srt2200'),
        ],
      },
    ],
  },
  {
    id: 'home-media-12u',
    tier: 'home',
    label: 'Home media + NAS (12U)',
    hint: 'Wall cabinet with firewall, Wi-Fi controller, 4U NAS',
    racks: [
      {
        name: 'Media rack', rackPresetId: 'wall-12u', devices: [
          d('patch-24', 12, 'patch-01', undefined, 'panduit-24'), d('sw-16', 11, 'home-sw', undefined, 'ubnt-usw-pro-48'), d('router', 10, 'router-01', undefined, 'cisco-isr4331'),
          d('firewall', 9, 'fw-01', undefined, 'forti-100f'), d('wlc', 8, 'wifi-01', undefined, 'cisco-c9800-40'), d('storage', 4, 'nas-01', undefined, 'synology-rs3621'),
          d('server-1u', 3, 'media-01', undefined, 'dell-r650'), d('ups', 1, 'ups-01', undefined, 'apc-srt2200'),
        ],
      },
    ],
  },
  // ── Office ────────────────────────────────────────────────────────────────
  {
    id: 'office-idf-12u',
    tier: 'office',
    label: 'Small office IDF (12U)',
    hint: 'Wall IDF: dual access switches, firewall, Wi-Fi, PDU',
    racks: [
      {
        name: 'IDF', rackPresetId: 'wall-12u', devices: [
          // patch-48 is 2U (48 keystones need two 24-wide rows), so the stack is
          // packed from U11 down — exactly 12U of gear in a 12U cabinet.
          d('patch-48', 11, 'patch-01', undefined, 'panduit-48'), d('sw-48', 10, 'access-01', undefined, 'cisco-c9300-48p'), d('sw-48', 9, 'access-02', undefined, 'arista-7050sx3-48'),
          d('cable-mgr', 8, 'cm-01'), d('router', 7, 'router-01', undefined, 'cisco-isr4331'), d('firewall', 6, 'fw-01', undefined, 'forti-100f'),
          d('wlc', 5, 'wifi-01', undefined, 'cisco-c9800-40'), d('server-1u', 4, 'srv-01', undefined, 'dell-r650'), d('server-1u', 3, 'srv-02', undefined, 'hpe-dl360-g11'),
          d('ups', 1, 'ups-01', undefined, 'apc-srt2200'), d('pdu', 1, 'pdu-01', 'rear'),
        ],
      },
    ],
  },
  {
    id: 'office-server-room-24u',
    tier: 'office',
    label: 'Office server room (24U)',
    hint: '24U: core switch, virtualization hosts, SAN, dual UPS',
    racks: [
      {
        name: 'Server room', rackPresetId: 'std-24u', devices: [
          d('patch-48', 23, 'patch-01', undefined, 'panduit-48'), d('patch-48', 21, 'patch-02', undefined, 'panduit-48'), d('cable-mgr', 20, 'cm-01'),
          d('sw-48', 19, 'access-01', undefined, 'cisco-c9300-48p'), d('sw-48', 18, 'access-02', undefined, 'arista-7050sx3-48'), d('sw-core', 16, 'core-01', undefined, 'cisco-n9336c'),
          d('router', 15, 'router-01', undefined, 'cisco-isr4331'), d('firewall', 14, 'fw-01', undefined, 'palo-pa3220'), d('lb', 13, 'lb-01', undefined, 'f5-i2800'),
          d('server-2u', 11, 'esxi-01', undefined, 'dell-r750'), d('server-2u', 9, 'esxi-02', undefined, 'hpe-dl380-g11'), d('storage', 5, 'san-01', undefined, 'dell-me5024'),
          d('ups', 3, 'ups-02', undefined, 'apc-srt2200'), d('ups', 1, 'ups-01', undefined, 'apc-srt2200'), d('pdu', 1, 'pdu-01', 'rear'),
        ],
      },
    ],
  },
  // ── Enterprise ──────────────────────────────────────────────────────────────
  {
    id: 'ent-core-42u',
    tier: 'enterprise',
    label: 'Enterprise core (42U)',
    hint: 'Redundant core + distribution, routers, firewalls, LBs',
    racks: [
      {
        name: 'Core', rackPresetId: 'std-42u', devices: [
          d('patch-48', 41, 'patch-01', undefined, 'panduit-48'), d('patch-48', 39, 'patch-02', undefined, 'panduit-48'), d('cable-mgr', 38, 'cm-01'),
          d('sw-core', 36, 'core-01', undefined, 'cisco-n9336c'), d('sw-core', 34, 'core-02', undefined, 'cisco-n9336c'), d('cable-mgr', 33, 'cm-02'),
          d('sw-48', 32, 'dist-01', undefined, 'cisco-c9300-48p'), d('sw-48', 31, 'dist-02', undefined, 'arista-7050sx3-48'), d('sw-48', 30, 'dist-03', undefined, 'juniper-ex4300-48t'), d('sw-48', 29, 'dist-04', undefined, 'hpe-aruba-6300m'),
          d('cable-mgr', 28, 'cm-03'), d('router', 27, 'router-01', undefined, 'cisco-asr1001x'), d('router', 26, 'router-02', undefined, 'juniper-mx204'),
          d('firewall', 25, 'fw-01', undefined, 'palo-pa3220'), d('firewall', 24, 'fw-02', undefined, 'forti-100f'), d('lb', 23, 'lb-01', undefined, 'f5-i2800'), d('lb', 22, 'lb-02', undefined, 'f5-i2800'),
          d('server-1u', 21, 'mgmt-01', undefined, 'dell-r650'), d('storage', 17, 'san-01', undefined, 'netapp-fas2750'),
          d('ups', 3, 'ups-b', undefined, 'apc-srt2200'), d('ups', 1, 'ups-a', undefined, 'apc-srt2200'), d('pdu', 1, 'pdu-a', 'rear'),
        ],
      },
    ],
  },
  {
    id: 'ent-compute-42u',
    tier: 'enterprise',
    label: 'Enterprise compute (42U)',
    hint: 'Top-of-rack switching, blade chassis, hosts, dual SAN',
    racks: [
      {
        name: 'Compute', rackPresetId: 'std-42u', devices: [
          d('patch-48', 41, 'patch-01', undefined, 'panduit-48'), d('sw-48', 40, 'tor-01', undefined, 'arista-7050sx3-48'), d('sw-48', 39, 'tor-02', undefined, 'cisco-c9300-48p'), d('cable-mgr', 38, 'cm-01'),
          d('blade', 32, 'blade-01'), d('blade', 26, 'blade-02'),
          d('server-2u', 24, 'esxi-01', undefined, 'dell-r750'), d('server-2u', 22, 'esxi-02', undefined, 'hpe-dl380-g11'), d('server-2u', 20, 'esxi-03', undefined, 'lenovo-sr650'),
          d('storage', 16, 'san-01', undefined, 'dell-me5024'), d('storage', 12, 'san-02', undefined, 'netapp-fas2750'),
          d('ups', 3, 'ups-b', undefined, 'apc-srt2200'), d('ups', 1, 'ups-a', undefined, 'apc-srt2200'), d('pdu', 1, 'pdu-a', 'rear'),
        ],
      },
    ],
  },
  {
    id: 'ent-edge-42u',
    tier: 'enterprise',
    label: 'Enterprise edge (42U open)',
    hint: 'Open 2-post: border routers, firewalls, fiber, VPN/IDS',
    racks: [
      {
        name: 'Edge', rackPresetId: 'open-42u', devices: [
          d('patch-48', 41, 'patch-01', undefined, 'panduit-48'), d('patch-48', 39, 'patch-02', undefined, 'panduit-48'), d('fiber', 38, 'fiber-01', undefined, 'panduit-24'), d('cable-mgr', 37, 'cm-01'),
          d('router', 36, 'border-01', undefined, 'cisco-asr1001x'), d('router', 35, 'border-02', undefined, 'juniper-mx204'), d('firewall', 34, 'fw-01', undefined, 'palo-pa3220'), d('firewall', 33, 'fw-02', undefined, 'forti-100f'),
          d('sw-core', 31, 'core-01', undefined, 'cisco-n9336c'), d('lb', 30, 'lb-01', undefined, 'f5-i2800'), d('server-1u', 29, 'vpn-01', undefined, 'dell-r650'), d('server-1u', 28, 'ids-01', undefined, 'hpe-dl360-g11'),
          d('ups', 1, 'ups-a', undefined, 'apc-srt2200'), d('pdu', 1, 'pdu-a', 'rear'),
        ],
      },
    ],
  },
] as const;

export const RACK_TIERS: readonly RackTier[] = ['home', 'office', 'enterprise'];

export const TIER_LABEL: Record<RackTier, string> = {
  home: 'Home',
  office: 'Office',
  enterprise: 'Enterprise',
};

export function templatesByTier(tier: RackTier): RackTemplate[] {
  return RACK_TEMPLATES.filter((t) => t.tier === tier);
}

export function templateById(id: string): RackTemplate | undefined {
  return RACK_TEMPLATES.find((t) => t.id === id);
}
