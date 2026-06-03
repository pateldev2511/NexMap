/**
 * CSV → NexMap model mapping (spec Import / DA-import). Auto-detects common header
 * names, builds devices/links via the model factories, and reports warnings rather
 * than throwing — a malformed row degrades gracefully instead of aborting the lot.
 *
 * The actual application is transactional (one undo entry) and lives in the store
 * (importObjects); this module only produces candidate objects + warnings so the
 * import preview can show them before the user commits.
 */
import { createDevice, createLink } from '@/model/schema';
import type { Device, DeviceType, Link } from '@/model/types';

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
    aliases: ['management_ip', 'mgmt_ip', 'ip', 'ip_address', 'address', 'primary_ip', 'primary_ip4'],
  },
  { key: 'notes', aliases: ['notes', 'description', 'comment', 'comments'] },
];

export const LINK_FIELDS: FieldDef[] = [
  { key: 'name', aliases: ['name', 'link', 'link_name'] },
  { key: 'source', aliases: ['source', 'from', 'a', 'src', 'device_a'] },
  { key: 'sourceInterface', aliases: ['source_interface', 'src_interface', 'a_interface', 'src_iface'] },
  { key: 'target', aliases: ['target', 'to', 'b', 'dst', 'destination', 'device_b'] },
  { key: 'targetInterface', aliases: ['target_interface', 'dst_interface', 'b_interface', 'dst_iface'] },
  { key: 'linkType', aliases: ['type', 'link_type', 'media', 'cable'] },
  { key: 'bandwidth', aliases: ['bandwidth', 'speed', 'rate'] },
];

const TYPE_ALIASES: Record<string, DeviceType> = {
  router: 'router', rtr: 'router',
  switch: 'switch', sw: 'switch', l2switch: 'switch', l3switch: 'switch',
  firewall: 'firewall', fw: 'firewall',
  ap: 'access-point', accesspoint: 'access-point', 'access-point': 'access-point', wap: 'access-point',
  wlc: 'wireless-controller',
  server: 'server', srv: 'server',
  storage: 'storage', nas: 'storage', san: 'storage',
  loadbalancer: 'load-balancer', lb: 'load-balancer',
  pc: 'end-user', workstation: 'end-user', laptop: 'end-user', enduser: 'end-user',
  printer: 'printer',
  iot: 'iot',
  isp: 'isp', internet: 'isp',
  cloud: 'cloud',
  vm: 'vm',
  container: 'container',
  rack: 'rack',
  ups: 'ups',
  camera: 'camera',
};

function normalize(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Auto-map CSV headers to canonical fields. Returns field → headerName | null. */
export function autoMap(headers: string[], fields: FieldDef[]): Record<string, string | null> {
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

export function parseDeviceType(value: string | undefined): { type: DeviceType; known: boolean } {
  if (!value) return { type: 'generic', known: false };
  const t = TYPE_ALIASES[normalize(value)];
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
      createDevice(type, origin.x + (idx % COLS) * STEP, origin.y + Math.floor(idx / COLS) * STEP, layerId, {
        name,
        vendor: get(row, 'vendor'),
        model: get(row, 'model'),
        role: get(row, 'role'),
        location: get(row, 'location'),
        managementIp: get(row, 'managementIp'),
        notes: get(row, 'notes'),
      }),
    );
  });

  return { devices, links: [], warnings, skipped };
}

/**
 * Build links from rows, resolving source/target by device NAME against the
 * existing project (case-insensitive). Unresolved endpoints are warned and the
 * link skipped — never creates a dangling link (handles the links-before-devices
 * and unknown-endpoint edge cases).
 */
export function buildLinks(
  rows: Record<string, string>[],
  mapping: Record<string, string | null>,
  existingDevices: Device[],
  layerId: string,
): ImportResult {
  const byName = new Map<string, string>();
  for (const d of existingDevices) byName.set(d.name.trim().toLowerCase(), d.id);

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
    const srcId = srcName ? byName.get(srcName.toLowerCase()) : undefined;
    const tgtId = tgtName ? byName.get(tgtName.toLowerCase()) : undefined;
    if (!srcId || !tgtId) {
      skipped++;
      const missing = [!srcId ? srcName || '(blank source)' : null, !tgtId ? tgtName || '(blank target)' : null]
        .filter(Boolean)
        .join(', ');
      warnings.push(`Row ${i + 1}: device not found: ${missing} — link skipped.`);
      return;
    }
    links.push(
      createLink(srcId, tgtId, layerId, {
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
