/**
 * CSV → NexMap model mapping (spec Import / DA-import). Auto-detects common header
 * names, builds devices/links via the model factories, and reports warnings rather
 * than throwing — a malformed row degrades gracefully instead of aborting the lot.
 *
 * The actual application is transactional (one undo entry) and lives in the store
 * (importObjects); this module only produces candidate objects + warnings so the
 * import preview can show them before the user commits.
 */
import {
  createDevice,
  createLink,
  createSubnet,
  createVlan,
  defaultDeviceName,
  DEVICE_TYPES,
} from '@/model/schema';
import type { Device, DeviceType, Link, Subnet, Vlan } from '@/model/types';

export type ImportKind = 'devices' | 'links';

interface FieldDef {
  key: string;
  aliases: string[];
}

export const DEVICE_FIELDS: FieldDef[] = [
  { key: 'name', aliases: ['name', 'device', 'hostname', 'host'] },
  { key: 'type', aliases: ['type', 'device_type', 'device_role', 'role', 'kind'] },
  { key: 'vendor', aliases: ['vendor', 'manufacturer', 'make'] },
  { key: 'model', aliases: ['model', 'device_type'] },
  { key: 'role', aliases: ['role', 'device_role', 'function'] },
  { key: 'location', aliases: ['location', 'site', 'room', 'rack'] },
  {
    key: 'managementIp',
    aliases: [
      'management_ip',
      'mgmt_ip',
      'ip',
      'ip_address',
      'address',
      'primary_ip',
      'primary_ip4',
    ],
  },
  { key: 'notes', aliases: ['notes', 'description', 'comment', 'comments'] },
];

export const LINK_FIELDS: FieldDef[] = [
  { key: 'name', aliases: ['name', 'link', 'link_name'] },
  { key: 'source', aliases: ['source', 'from', 'a', 'src', 'device_a'] },
  {
    key: 'sourceInterface',
    aliases: ['source_interface', 'src_interface', 'a_interface', 'src_iface'],
  },
  { key: 'target', aliases: ['target', 'to', 'b', 'dst', 'destination', 'device_b'] },
  {
    key: 'targetInterface',
    aliases: ['target_interface', 'dst_interface', 'b_interface', 'dst_iface'],
  },
  { key: 'linkType', aliases: ['type', 'link_type', 'media', 'cable'] },
  { key: 'bandwidth', aliases: ['bandwidth', 'speed', 'rate'] },
];

// Shorthands and vendor-neutral synonyms. Every type's own id and export label
// ("patch-panel", "Patch Panel", "VPC / VNet") resolve without being listed here.
const TYPE_ALIASES: Record<string, DeviceType> = {
  router: 'router',
  rtr: 'router',
  switch: 'switch',
  sw: 'switch',
  l2switch: 'switch',
  l3switch: 'switch',
  firewall: 'firewall',
  fw: 'firewall',
  ap: 'access-point',
  accesspoint: 'access-point',
  'access-point': 'access-point',
  wap: 'access-point',
  wlc: 'wireless-controller',
  server: 'server',
  srv: 'server',
  storage: 'storage',
  nas: 'nas',
  san: 'storage',
  loadbalancer: 'load-balancer',
  lb: 'load-balancer',
  pc: 'end-user',
  workstation: 'end-user',
  laptop: 'laptop',
  notebook: 'laptop',
  ip_phone: 'ip-phone',
  phone: 'ip-phone',
  voip: 'ip-phone',
  mobile: 'mobile',
  smartphone: 'mobile',
  tablet: 'mobile',
  modem: 'modem',
  ont: 'modem',
  enduser: 'end-user',
  printer: 'printer',
  iot: 'iot',
  isp: 'isp',
  internet: 'isp',
  cloud: 'cloud',
  vm: 'vm',
  container: 'container',
  rack: 'rack',
  ups: 'ups',
  camera: 'camera',
  vnet: 'vpc',
  igw: 'internet-gateway',
  nat: 'nat-gateway',
  vpn: 'vpn-gateway',
  bucket: 'object-storage',
};

/** Type-cell lookup key: case, spaces, dashes, underscores and slashes don't matter. */
function typeKey(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Built from DEVICE_TYPES so the label the inventory export writes always reads back
// as the same type; a new DeviceType can't silently round-trip to generic. Canonical
// ids and labels go in last so an alias can never shadow one.
const TYPE_LOOKUP = new Map<string, DeviceType>();
for (const [alias, type] of Object.entries(TYPE_ALIASES))
  TYPE_LOOKUP.set(typeKey(alias), type);
for (const type of DEVICE_TYPES) {
  TYPE_LOOKUP.set(typeKey(type), type);
  TYPE_LOOKUP.set(typeKey(defaultDeviceName(type)), type);
}

function normalize(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

const SUBNET_FIELDS: FieldDef[] = [
  { key: 'cidr', aliases: ['cidr', 'subnet', 'prefix', 'network'] },
  { key: 'name', aliases: ['name', 'description'] },
  { key: 'gateway', aliases: ['gateway', 'gw'] },
  { key: 'vlanId', aliases: ['vlan_id', 'vlan', 'vlanid'] },
  { key: 'zone', aliases: ['zone', 'site'] },
  { key: 'notes', aliases: ['notes', 'comment'] },
];
const VLAN_FIELDS: FieldDef[] = [
  { key: 'vlanId', aliases: ['vlan_id', 'vlan', 'vlanid', 'id'] },
  { key: 'name', aliases: ['name', 'vlan_name', 'description'] },
  { key: 'zone', aliases: ['zone', 'site'] },
  { key: 'notes', aliases: ['notes', 'comment'] },
];

/** Header detection so the dialog can route a CSV to the right importer. */
export function detectCsvKind(headers: string[]): ImportKind | 'subnets' | 'vlans' {
  const n = headers.map(normalize);
  if (n.includes('cidr') || n.includes('subnet') || n.includes('prefix'))
    return 'subnets';
  const linkMap = autoMap(headers, LINK_FIELDS);
  if (linkMap.source && linkMap.target) return 'links';
  if (
    (n.includes('vlan_id') || n.includes('vlan')) &&
    !n.includes('management_ip') &&
    !n.includes('ip')
  )
    return 'vlans';
  return 'devices';
}

export function buildSubnets(
  rows: Record<string, string>[],
  headers: string[],
): Subnet[] {
  const m = autoMap(headers, SUBNET_FIELDS);
  const get = (r: Record<string, string>, k: string) =>
    m[k] ? r[m[k]!]?.trim() : undefined;
  return rows
    .map((r) => {
      const cidr = get(r, 'cidr');
      if (!cidr) return null;
      const vlanRaw = get(r, 'vlanId');
      return createSubnet(cidr, {
        name: get(r, 'name'),
        gateway: get(r, 'gateway'),
        vlanId: vlanRaw ? Number(vlanRaw) : undefined,
        zone: get(r, 'zone'),
        notes: get(r, 'notes'),
      });
    })
    .filter((s): s is Subnet => s !== null);
}

export function buildVlans(rows: Record<string, string>[], headers: string[]): Vlan[] {
  const m = autoMap(headers, VLAN_FIELDS);
  const get = (r: Record<string, string>, k: string) =>
    m[k] ? r[m[k]!]?.trim() : undefined;
  return rows
    .map((r, i) => {
      const idRaw = get(r, 'vlanId');
      if (!idRaw) return null;
      return createVlan(Number(idRaw), get(r, 'name') || `VLAN ${idRaw || i}`, {
        zone: get(r, 'zone'),
        notes: get(r, 'notes'),
      });
    })
    .filter((v): v is Vlan => v !== null);
}

/** Auto-map CSV headers to canonical fields. Returns field → headerName | null. */
export function autoMap(
  headers: string[],
  fields: FieldDef[],
): Record<string, string | null> {
  const norm = headers.map((h) => ({ raw: h, n: normalize(h) }));
  const used = new Set<string>();
  const mapping: Record<string, string | null> = {};
  for (const f of fields) {
    const hit = norm.find((h) => !used.has(h.raw) && f.aliases.includes(h.n));
    mapping[f.key] = hit?.raw ?? null;
    if (hit) used.add(hit.raw);
  }
  return mapping;
}

export function parseDeviceType(value: string | undefined): {
  type: DeviceType;
  known: boolean;
} {
  if (!value) return { type: 'generic', known: false };
  const t = TYPE_LOOKUP.get(typeKey(value));
  return t ? { type: t, known: true } : { type: 'generic', known: false };
}

export interface ImportResult {
  devices: Device[];
  links: Link[];
  warnings: string[];
  skipped: number;
}

const COLS = 8;
const STEP = 120;

/** Build devices from rows. `originX/Y` lays them out in a grid (CSV has no coords). */
export function buildDevices(
  rows: Record<string, string>[],
  mapping: Record<string, string | null>,
  layerId: string,
  origin = { x: 80, y: 80 },
): ImportResult {
  const devices: Device[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const get = (row: Record<string, string>, key: string) => {
    const header = mapping[key];
    return header ? row[header]?.trim() : undefined;
  };

  rows.forEach((row, i) => {
    const name = get(row, 'name');
    if (!name) {
      skipped++;
      warnings.push(`Row ${i + 1}: no name — skipped.`);
      return;
    }
    const { type, known } = parseDeviceType(get(row, 'type'));
    if (get(row, 'type') && !known) {
      warnings.push(`Row ${i + 1}: unknown type "${get(row, 'type')}" → generic.`);
    }
    const idx = devices.length;
    devices.push(
      createDevice(
        type,
        origin.x + (idx % COLS) * STEP,
        origin.y + Math.floor(idx / COLS) * STEP,
        layerId,
        {
          name,
          vendor: get(row, 'vendor'),
          model: get(row, 'model'),
          role: get(row, 'role'),
          location: get(row, 'location'),
          managementIp: get(row, 'managementIp'),
          notes: get(row, 'notes'),
        },
      ),
    );
  });

  return { devices, links: [], warnings, skipped };
}

/** Loose name key: case and runs of whitespace don't matter ("Core  SW" = "core sw"). */
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export type NameMatch =
  | { kind: 'found'; device: Device }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; matches: Device[] };

/**
 * Resolve link endpoints by device name, independent of device order. A unique exact
 * (trimmed) name wins; otherwise the case/space-insensitive match must be unique. Two
 * or more candidates are ambiguous and the caller skips the row rather than guess, so
 * reordering devices can never re-point a link at a different physical box.
 */
export function deviceNameResolver(devices: Device[]): (name: string) => NameMatch {
  const exact = new Map<string, Device[]>();
  const loose = new Map<string, Device[]>();
  const add = (m: Map<string, Device[]>, k: string, d: Device) => {
    const list = m.get(k);
    if (list) list.push(d);
    else m.set(k, [d]);
  };
  for (const d of devices) {
    add(exact, d.name.trim(), d);
    add(loose, nameKey(d.name), d);
  }
  return (name) => {
    const byExact = exact.get(name.trim()) ?? [];
    const candidates = byExact.length > 0 ? byExact : (loose.get(nameKey(name)) ?? []);
    if (candidates.length === 0) return { kind: 'missing' };
    if (candidates.length === 1) return { kind: 'found', device: candidates[0]! };
    return { kind: 'ambiguous', matches: candidates };
  };
}

/** `"core" matches 2 devices: core (Router, HQ, 10.0.0.1); CORE (Switch)` */
export function describeAmbiguous(name: string, matches: Device[]): string {
  const each = matches.map((d) => {
    const detail = [defaultDeviceName(d.type), d.location, d.managementIp];
    return `${d.name} (${detail.filter(Boolean).join(', ')})`;
  });
  return `"${name}" matches ${matches.length} devices: ${each.join('; ')}`;
}

/**
 * Build links from rows, resolving source/target by device NAME against the
 * existing project (see deviceNameResolver). Unresolved or ambiguous endpoints are
 * warned and the link skipped — never creates a dangling or guessed link (handles
 * the links-before-devices, unknown-endpoint and duplicate-name edge cases).
 */
export function buildLinks(
  rows: Record<string, string>[],
  mapping: Record<string, string | null>,
  existingDevices: Device[],
  layerId: string,
): ImportResult {
  const resolve = deviceNameResolver(existingDevices);

  const links: Link[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const get = (row: Record<string, string>, key: string) => {
    const header = mapping[key];
    return header ? row[header]?.trim() : undefined;
  };

  rows.forEach((row, i) => {
    const srcName = get(row, 'source');
    const tgtName = get(row, 'target');
    const src: NameMatch = srcName ? resolve(srcName) : { kind: 'missing' };
    const tgt: NameMatch = tgtName ? resolve(tgtName) : { kind: 'missing' };
    if (src.kind !== 'found' || tgt.kind !== 'found') {
      skipped++;
      const missing = [
        src.kind === 'missing' ? srcName || '(blank source)' : null,
        tgt.kind === 'missing' ? tgtName || '(blank target)' : null,
      ].filter(Boolean);
      const problems = [
        missing.length > 0 ? `device not found: ${missing.join(', ')}` : null,
        src.kind === 'ambiguous' ? describeAmbiguous(srcName!, src.matches) : null,
        tgt.kind === 'ambiguous' ? describeAmbiguous(tgtName!, tgt.matches) : null,
      ].filter(Boolean);
      const ambiguous = src.kind === 'ambiguous' || tgt.kind === 'ambiguous';
      const hint = ambiguous ? ' Rename devices so names are unique.' : '';
      warnings.push(`Row ${i + 1}: ${problems.join('; ')} — link skipped.${hint}`);
      return;
    }
    links.push(
      createLink(src.device.id, tgt.device.id, layerId, {
        name: get(row, 'name'),
        sourceInterface: get(row, 'sourceInterface'),
        targetInterface: get(row, 'targetInterface'),
        linkType: get(row, 'linkType'),
        bandwidth: get(row, 'bandwidth'),
      }),
    );
  });

  return { devices: [], links, warnings, skipped };
}
