/**
 * Topology interchange imports (Phase 3): GraphML and draw.io (mxGraph) XML, plus
 * generic JSON. Each produces the same ImportResult shape as the CSV importer so
 * the dialog + transactional commit are reused. Pure-ish (uses DOMParser, which
 * jsdom provides) so the parsers are unit-tested.
 */
import { createDevice, createLink } from '@/model/schema';
import type { Device, DeviceType, Link } from '@/model/types';
import { parseDeviceType } from './csvImport';

// Keyword inference for free-text labels ("Core Router" → router). Order matters:
// more specific keywords first.
const TYPE_KEYWORDS: [string, DeviceType][] = [
  ['firewall', 'firewall'],
  ['router', 'router'],
  ['switch', 'switch'],
  ['access point', 'access-point'],
  ['access-point', 'access-point'],
  ['wireless', 'access-point'],
  ['load bal', 'load-balancer'],
  ['server', 'server'],
  ['storage', 'storage'],
  ['cloud', 'cloud'],
  ['printer', 'printer'],
  ['camera', 'camera'],
  ['laptop', 'end-user'],
  ['workstation', 'end-user'],
  ['pc', 'end-user'],
];

function inferType(label: string): DeviceType {
  const exact = parseDeviceType(label);
  if (exact.known) return exact.type;
  const l = label.toLowerCase();
  for (const [kw, type] of TYPE_KEYWORDS) if (l.includes(kw)) return type;
  return 'generic';
}

export interface ImportResult {
  devices: Device[];
  links: Link[];
  warnings: string[];
  skipped: number;
}

const COLS = 8;
const STEP = 130;

function layout(i: number, origin = { x: 80, y: 80 }) {
  return { x: origin.x + (i % COLS) * STEP, y: origin.y + Math.floor(i / COLS) * STEP };
}

function deviceFromLabel(label: string, i: number, layerId: string): Device {
  const pos = layout(i);
  return createDevice(inferType(label), pos.x, pos.y, layerId, { name: label || `node-${i}` });
}

/** Parse GraphML: <node id> → device, <edge source target> → link. */
export function parseGraphml(text: string, layerId: string): ImportResult {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return { devices: [], links: [], warnings: ['File is not valid XML.'], skipped: 0 };
  }
  const idToDevice = new Map<string, Device>();
  const devices: Device[] = [];
  doc.querySelectorAll('node').forEach((node, i) => {
    const gid = node.getAttribute('id') ?? `n${i}`;
    // Label: a <data> child (common: key="label"/"name"/"d*") or the id.
    const dataLabel = [...node.querySelectorAll('data')]
      .map((d) => d.textContent?.trim())
      .find((t) => t && t.length > 0);
    const device = deviceFromLabel(dataLabel || gid, i, layerId);
    idToDevice.set(gid, device);
    devices.push(device);
  });

  const links: Link[] = [];
  let skipped = 0;
  doc.querySelectorAll('edge').forEach((edge, i) => {
    const src = idToDevice.get(edge.getAttribute('source') ?? '');
    const tgt = idToDevice.get(edge.getAttribute('target') ?? '');
    if (!src || !tgt) {
      skipped++;
      warnings.push(`Edge ${i + 1}: endpoint not found — skipped.`);
      return;
    }
    links.push(createLink(src.id, tgt.id, layerId));
  });
  return { devices, links, warnings, skipped };
}

/** Parse draw.io (mxGraph) XML: vertex cells → devices, edge cells → links. */
export function parseDrawio(text: string, layerId: string): ImportResult {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return { devices: [], links: [], warnings: ['File is not valid XML.'], skipped: 0 };
  }
  const cells = [...doc.querySelectorAll('mxCell')];
  if (cells.length === 0) {
    return {
      devices: [],
      links: [],
      warnings: [
        'No mxCell elements found. If this is a compressed draw.io file, re-export as uncompressed XML (Extras → Edit Diagram, or uncheck "Compressed").',
      ],
      skipped: 0,
    };
  }
  const idToDevice = new Map<string, Device>();
  const devices: Device[] = [];
  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').trim();
  cells.forEach((cell, i) => {
    if (cell.getAttribute('vertex') !== '1') return;
    const gid = cell.getAttribute('id') ?? `v${i}`;
    const label = stripHtml(cell.getAttribute('value') ?? '');
    const device = deviceFromLabel(label, devices.length, layerId);
    idToDevice.set(gid, device);
    devices.push(device);
  });

  const links: Link[] = [];
  let skipped = 0;
  cells.forEach((cell) => {
    if (cell.getAttribute('edge') !== '1') return;
    const src = idToDevice.get(cell.getAttribute('source') ?? '');
    const tgt = idToDevice.get(cell.getAttribute('target') ?? '');
    if (!src || !tgt) {
      skipped++;
      return;
    }
    const label = (cell.getAttribute('value') ?? '').trim();
    links.push(createLink(src.id, tgt.id, layerId, label ? { name: stripHtml(label) } : {}));
  });
  if (skipped > 0) warnings.push(`${skipped} edge(s) had unmapped endpoints and were skipped.`);
  return { devices, links, warnings, skipped };
}

/**
 * Parse an Nmap XML scan (`nmap -oX`). Each <host> with a status="up" becomes a
 * device: management IP from <address addr>, name from <hostname>, type inferred
 * from the OS guess. No links (Nmap has no topology).
 */
export function parseNmapXml(text: string, layerId: string): ImportResult {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('nmaprun')) {
    return { devices: [], links: [], warnings: ['Not a valid Nmap XML scan.'], skipped: 0 };
  }
  const devices: Device[] = [];
  let skipped = 0;
  doc.querySelectorAll('host').forEach((host, i) => {
    const state = host.querySelector('status')?.getAttribute('state');
    if (state && state !== 'up') {
      skipped++;
      return;
    }
    const ip =
      host.querySelector('address[addrtype="ipv4"]')?.getAttribute('addr') ??
      host.querySelector('address[addrtype="ipv6"]')?.getAttribute('addr') ??
      host.querySelector('address')?.getAttribute('addr') ??
      undefined;
    const hostname = host.querySelector('hostname')?.getAttribute('name');
    const osName = host.querySelector('osmatch')?.getAttribute('name') ?? '';
    const name = hostname || ip || `host-${i}`;
    const pos = layout(devices.length);
    devices.push(
      createDevice(inferType(osName || name), pos.x, pos.y, layerId, {
        name,
        managementIp: ip,
        notes: osName || undefined,
      }),
    );
  });
  if (devices.length === 0) warnings.push('No "up" hosts found in the scan.');
  return { devices, links: [], warnings, skipped };
}

/** A NetBox JSON export has a `results` array of device objects. */
export function looksLikeNetbox(text: string): boolean {
  try {
    const d = JSON.parse(text) as { results?: unknown };
    return Array.isArray(d.results);
  } catch {
    return false;
  }
}

/** Parse a NetBox device-list JSON export (`results[]`). Links aren't included. */
export function parseNetboxJson(text: string, layerId: string): ImportResult {
  let data: { results?: unknown[] };
  try {
    data = JSON.parse(text);
  } catch {
    return { devices: [], links: [], warnings: ['File is not valid JSON.'], skipped: 0 };
  }
  const results = Array.isArray(data.results) ? data.results : [];
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const nested = (o: unknown, ...path: string[]): string | undefined => {
    let cur: unknown = o;
    for (const k of path) cur = (cur as Record<string, unknown> | null)?.[k];
    return str(cur);
  };
  const devices: Device[] = results.map((raw, i) => {
    const d = raw as Record<string, unknown>;
    const name = str(d.name) || str(d.display) || `device-${i}`;
    const roleLabel = nested(d.device_role, 'name') ?? nested(d.role, 'name') ?? '';
    const pos = layout(i);
    return createDevice(inferType(roleLabel || name), pos.x, pos.y, layerId, {
      name,
      role: roleLabel || undefined,
      model: nested(d.device_type, 'model'),
      vendor: nested(d.device_type, 'manufacturer', 'name'),
      location: nested(d.site, 'name'),
      managementIp: nested(d.primary_ip, 'address') ?? nested(d.primary_ip4, 'address'),
    });
  });
  return { devices, links: [], warnings: [], skipped: 0 };
}

/**
 * Parse a generic topology JSON: `{ devices: [...], links: [...] }` (NexMap-ish).
 * Full `.nexmap` documents (with schemaVersion) are handled by the open flow, not
 * here — this is the merge-into-current path.
 */
export function parseTopologyJson(text: string, layerId: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { devices: [], links: [], warnings: ['File is not valid JSON.'], skipped: 0 };
  }
  const obj = data as { devices?: unknown[]; links?: unknown[] };
  if (!Array.isArray(obj.devices)) {
    return {
      devices: [],
      links: [],
      warnings: ['JSON has no "devices" array. For full .nexmap files use Open instead.'],
      skipped: 0,
    };
  }
  const warnings: string[] = [];
  const nameToDevice = new Map<string, Device>();
  const devices: Device[] = [];
  obj.devices.forEach((raw, i) => {
    const d = raw as Record<string, unknown>;
    const name = String(d.name ?? d.hostname ?? `node-${i}`);
    const { type } = parseDeviceType(typeof d.type === 'string' ? d.type : undefined);
    const pos = layout(i);
    const device = createDevice(type, pos.x, pos.y, layerId, {
      name,
      managementIp: typeof d.managementIp === 'string' ? d.managementIp : (typeof d.ip === 'string' ? d.ip : undefined),
      vendor: typeof d.vendor === 'string' ? d.vendor : undefined,
      notes: typeof d.notes === 'string' ? d.notes : undefined,
    });
    nameToDevice.set(name.toLowerCase(), device);
    devices.push(device);
  });

  const links: Link[] = [];
  let skipped = 0;
  for (const raw of Array.isArray(obj.links) ? obj.links : []) {
    const l = raw as Record<string, unknown>;
    const src = nameToDevice.get(String(l.source ?? '').toLowerCase());
    const tgt = nameToDevice.get(String(l.target ?? '').toLowerCase());
    if (!src || !tgt) {
      skipped++;
      continue;
    }
    links.push(createLink(src.id, tgt.id, layerId));
  }
  if (skipped > 0) warnings.push(`${skipped} link(s) referenced unknown devices and were skipped.`);
  return { devices, links, warnings, skipped };
}
