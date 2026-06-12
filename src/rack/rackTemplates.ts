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
const d = (presetKey: string, ru: number, name?: string, side?: Side): TemplateDevice => ({ presetKey, ru, name, side });

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
          d('patch-24', 6, 'patch-01'), d('sw-8', 5, 'home-sw'), d('router', 4, 'edge-rtr'),
          d('server-1u', 3, 'nas-01'), d('ups', 1, 'ups-01'),
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
          d('patch-24', 12, 'patch-01'), d('sw-16', 11, 'home-sw'), d('router', 10, 'router-01'),
          d('firewall', 9, 'fw-01'), d('wlc', 8, 'wifi-01'), d('storage', 4, 'nas-01'),
          d('server-1u', 3, 'media-01'), d('ups', 1, 'ups-01'),
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
          d('patch-48', 12, 'patch-01'), d('sw-48', 11, 'access-01'), d('sw-48', 10, 'access-02'),
          d('cable-mgr', 9, 'cm-01'), d('router', 8, 'router-01'), d('firewall', 7, 'fw-01'),
          d('wlc', 6, 'wifi-01'), d('server-1u', 5, 'srv-01'), d('server-1u', 4, 'srv-02'),
          d('ups', 1, 'ups-01'), d('pdu', 1, 'pdu-01', 'rear'),
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
          d('patch-48', 24, 'patch-01'), d('patch-48', 23, 'patch-02'), d('cable-mgr', 22, 'cm-01'),
          d('sw-48', 21, 'access-01'), d('sw-48', 20, 'access-02'), d('sw-core', 18, 'core-01'),
          d('router', 17, 'router-01'), d('firewall', 16, 'fw-01'), d('lb', 15, 'lb-01'),
          d('server-2u', 13, 'esxi-01'), d('server-2u', 11, 'esxi-02'), d('storage', 7, 'san-01'),
          d('ups', 3, 'ups-02'), d('ups', 1, 'ups-01'), d('pdu', 1, 'pdu-01', 'rear'),
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
          d('patch-48', 42, 'patch-01'), d('patch-48', 41, 'patch-02'), d('cable-mgr', 40, 'cm-01'),
          d('sw-core', 38, 'core-01'), d('sw-core', 36, 'core-02'), d('cable-mgr', 35, 'cm-02'),
          d('sw-48', 34, 'dist-01'), d('sw-48', 33, 'dist-02'), d('sw-48', 32, 'dist-03'), d('sw-48', 31, 'dist-04'),
          d('cable-mgr', 30, 'cm-03'), d('router', 29, 'router-01'), d('router', 28, 'router-02'),
          d('firewall', 27, 'fw-01'), d('firewall', 26, 'fw-02'), d('lb', 25, 'lb-01'), d('lb', 24, 'lb-02'),
          d('server-1u', 23, 'mgmt-01'), d('storage', 18, 'san-01'),
          d('ups', 3, 'ups-b'), d('ups', 1, 'ups-a'), d('pdu', 1, 'pdu-a', 'rear'),
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
          d('patch-48', 42, 'patch-01'), d('sw-48', 41, 'tor-01'), d('sw-48', 40, 'tor-02'), d('cable-mgr', 39, 'cm-01'),
          d('blade', 33, 'blade-01'), d('blade', 27, 'blade-02'),
          d('server-2u', 25, 'esxi-01'), d('server-2u', 23, 'esxi-02'), d('server-2u', 21, 'esxi-03'),
          d('storage', 17, 'san-01'), d('storage', 13, 'san-02'),
          d('ups', 3, 'ups-b'), d('ups', 1, 'ups-a'), d('pdu', 1, 'pdu-a', 'rear'),
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
          d('patch-48', 42, 'patch-01'), d('patch-48', 41, 'patch-02'), d('fiber', 40, 'fiber-01'), d('cable-mgr', 39, 'cm-01'),
          d('router', 38, 'border-01'), d('router', 37, 'border-02'), d('firewall', 36, 'fw-01'), d('firewall', 35, 'fw-02'),
          d('sw-core', 33, 'core-01'), d('lb', 32, 'lb-01'), d('server-1u', 31, 'vpn-01'), d('server-1u', 30, 'ids-01'),
          d('ups', 1, 'ups-a'), d('pdu', 1, 'pdu-a', 'rear'),
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
