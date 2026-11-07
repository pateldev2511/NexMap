/**
 * Topology interchange imports (Phase 3): GraphML and draw.io (mxGraph) XML, plus
 * generic JSON. Each produces the same ImportResult shape as the CSV importer so
 * the dialog + transactional commit are reused. Pure-ish (uses DOMParser, which
 * jsdom provides) so the parsers are unit-tested.
 */
import { createDevice, createLink } from '@/model/schema';
import type { Device, DeviceType, Link } from '@/model/types';
import { describeAmbiguous, deviceNameResolver, parseDeviceType } from './csvImport';

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
  ['laptop', 'laptop'],
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
  return createDevice(inferType(label), pos.x, pos.y, layerId, {
    name: label || `node-${i}`,
  });
}

function bestGraphmlLabel(
  node: Element,
  fallback: string,
  keyNames: Map<string, string>,
): string {
  const data = [...node.querySelectorAll('data')]
    .map((d) => ({
      key: d.getAttribute('key') ?? '',
      name: keyNames.get(d.getAttribute('key') ?? '') ?? '',
      text: d.textContent?.trim() ?? '',
    }))
    .filter((d) => d.text.length > 0);
  const labelish = data.find((d) =>
    /label|name|title|hostname/i.test(`${d.key} ${d.name}`),
  );
  return labelish?.text ?? data[0]?.text ?? fallback;
}

function isExternalSvgReference(value: string): boolean {
  const v = value.trim().replace(/^url\(\s*['"]?|['"]?\s*\)$/g, '');
  if (v.startsWith('#')) return false;
  if (/^(https?:)?\/\//i.test(v)) return true;
  if (/^(file|ftp|blob):/i.test(v)) return true;
  if (/^data:/i.test(v) && !/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(v))
    return true;
  return false;
}

/**
 * Remove external fetch references from sanitized SVG underlays. DOMPurify handles
 * scripts/unsafe markup; this extra pass protects the local-first privacy promise
 * by preventing imported SVGs from loading remote images, filters, masks, etc.
 */
export function stripExternalSvgReferences(svg: string): {
  svg: string;
  stripped: number;
} {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return { svg, stripped: 0 };
  let stripped = 0;
  doc.querySelectorAll('script,foreignObject,iframe,object,embed').forEach((el) => {
    stripped++;
    el.remove();
  });
  const attrs = [
    'href',
    'xlink:href',
    'src',
    'filter',
    'clip-path',
    'mask',
    'marker-start',
    'marker-mid',
    'marker-end',
    'fill',
    'stroke',
  ];
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (value && isExternalSvgReference(value)) {
        el.removeAttribute(attr);
        stripped++;
      }
    }
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
        stripped++;
      }
    }
  });
  return { svg: new XMLSerializer().serializeToString(doc.documentElement), stripped };
}

/** Parse GraphML: <node id> → device, <edge source target> → link. */
export function parseGraphml(text: string, layerId: string): ImportResult {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return { devices: [], links: [], warnings: ['File is not valid XML.'], skipped: 0 };
  }
  const keyNames = new Map<string, string>();
  doc.querySelectorAll('key').forEach((key) => {
    const id = key.getAttribute('id');
    if (id)
      keyNames.set(
        id,
        key.getAttribute('attr.name') ?? key.getAttribute('yfiles.type') ?? '',
      );
  });
  const idToDevice = new Map<string, Device>();
  const devices: Device[] = [];
  doc.querySelectorAll('node').forEach((node, i) => {
    const gid = node.getAttribute('id') ?? `n${i}`;
    const device = deviceFromLabel(bestGraphmlLabel(node, gid, keyNames), i, layerId);
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

/**
 * Parse draw.io (mxGraph) XML: vertex cells → devices, edge cells → links. A
 * multi-page file repeats cell ids on every page ("2", "3", …), so each <diagram>
 * page gets its own id map and an edge only ever resolves within its own page —
 * a document-wide map let the last page's cells win. Pages are merged, each
 * starting on a fresh layout row.
 */
export function parseDrawio(text: string, layerId: string): ImportResult {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return { devices: [], links: [], warnings: ['File is not valid XML.'], skipped: 0 };
  }
  const compressedHint =
    'If this is a compressed draw.io file, re-export as uncompressed XML (Extras → Edit Diagram, or uncheck "Compressed").';
  const diagrams = [...doc.querySelectorAll('diagram')];
  const pages =
    diagrams.length > 0
      ? diagrams.map((d, i) => ({
          name: d.getAttribute('name') || `Page-${i + 1}`,
          cells: [...d.querySelectorAll('mxCell')],
        }))
      : [{ name: '', cells: [...doc.querySelectorAll('mxCell')] }];
  const readable = pages.filter((p) => p.cells.length > 0);
  if (readable.length === 0) {
    return {
      devices: [],
      links: [],
      warnings: [`No mxCell elements found. ${compressedHint}`],
      skipped: 0,
    };
  }
  const multi = pages.length > 1;
  for (const p of pages)
    if (p.cells.length === 0)
      warnings.push(
        `Page "${p.name}" has no readable cells and was skipped. ${compressedHint}`,
      );
  if (readable.length > 1)
    warnings.push(
      `Merged ${readable.length} draw.io pages (${readable.map((p) => p.name).join(', ')}); links are matched within each page.`,
    );

  const devices: Device[] = [];
  const links: Link[] = [];
  let skipped = 0;
  const stripHtml = (s: string) =>
    s
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[^;]+;/g, ' ')
      .trim();
  let slot = 0;
  for (const page of readable) {
    if (slot % COLS !== 0) slot += COLS - (slot % COLS);
    const idToDevice = new Map<string, Device>();
    page.cells.forEach((cell, i) => {
      if (cell.getAttribute('vertex') !== '1') return;
      const gid = cell.getAttribute('id') ?? `v${i}`;
      const label = stripHtml(cell.getAttribute('value') ?? '');
      const device = deviceFromLabel(label, slot++, layerId);
      idToDevice.set(gid, device);
      devices.push(device);
    });

    let pageSkipped = 0;
    page.cells.forEach((cell) => {
      if (cell.getAttribute('edge') !== '1') return;
      const src = idToDevice.get(cell.getAttribute('source') ?? '');
      const tgt = idToDevice.get(cell.getAttribute('target') ?? '');
      if (!src || !tgt) {
        pageSkipped++;
        return;
      }
      const label = (cell.getAttribute('value') ?? '').trim();
      links.push(
        createLink(src.id, tgt.id, layerId, label ? { name: stripHtml(label) } : {}),
      );
    });
    if (pageSkipped > 0)
      warnings.push(
        `${multi ? `Page "${page.name}": ` : ''}${pageSkipped} edge(s) had unmapped endpoints and were skipped.`,
      );
    skipped += pageSkipped;
  }
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
    return {
      devices: [],
      links: [],
      warnings: ['Not a valid Nmap XML scan.'],
      skipped: 0,
    };
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

/** A JSON object (not null, not an array) — the only row shape a parser may read. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A usable name/endpoint value: a non-blank string, or a number (`"name": 7`). */
function nameText(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Parse a NetBox device-list JSON export (`results[]`). Links aren't included. Every
 * row is checked before any field is read: a null/non-object row is skipped with a
 * row-level warning instead of throwing and aborting the whole file.
 */
export function parseNetboxJson(text: string, layerId: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { devices: [], links: [], warnings: ['File is not valid JSON.'], skipped: 0 };
  }
  if (!isRecord(data) || !Array.isArray(data.results)) {
    return {
      devices: [],
      links: [],
      warnings: ['NetBox JSON has no "results" array of devices.'],
      skipped: 0,
    };
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const nested = (o: unknown, ...path: string[]): string | undefined => {
    let cur: unknown = o;
    for (const k of path) cur = isRecord(cur) ? cur[k] : undefined;
    return str(cur);
  };
  const warnings: string[] = [];
  let skipped = 0;
  const devices: Device[] = [];
  data.results.forEach((d, i) => {
    if (!isRecord(d)) {
      skipped++;
      warnings.push(`Device ${i + 1}: not a device object — skipped.`);
      return;
    }
    const name = str(d.name) || str(d.display) || `device-${i}`;
    const roleLabel = nested(d.device_role, 'name') ?? nested(d.role, 'name') ?? '';
    const pos = layout(devices.length);
    devices.push(
      createDevice(inferType(roleLabel || name), pos.x, pos.y, layerId, {
        name,
        role: roleLabel || undefined,
        model: nested(d.device_type, 'model'),
        vendor: nested(d.device_type, 'manufacturer', 'name'),
        location: nested(d.site, 'name'),
        managementIp: nested(d.primary_ip, 'address') ?? nested(d.primary_ip4, 'address'),
      }),
    );
  });
  return { devices, links: [], warnings, skipped };
}

/**
 * Parse a generic topology JSON: `{ devices: [...], links: [...] }` (NexMap-ish).
 * Full `.nexmap` documents (with schemaVersion) are handled by the open flow, not
 * here — this is the merge-into-current path. The root and every device/link row
 * are shape-checked before any field is read; bad rows are skipped with a warning
 * naming them, so a partly-broken file still previews instead of throwing.
 */
export function parseTopologyJson(text: string, layerId: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { devices: [], links: [], warnings: ['File is not valid JSON.'], skipped: 0 };
  }
  if (!isRecord(data) || !Array.isArray(data.devices)) {
    return {
      devices: [],
      links: [],
      warnings: ['JSON has no "devices" array. For full .nexmap files use Open instead.'],
      skipped: 0,
    };
  }
  const warnings: string[] = [];
  const devices: Device[] = [];
  let skipped = 0;
  data.devices.forEach((d, i) => {
    if (!isRecord(d)) {
      skipped++;
      warnings.push(`Device ${i + 1}: not a device object — skipped.`);
      return;
    }
    const name = nameText(d.name) ?? nameText(d.hostname) ?? `node-${i}`;
    const { type } = parseDeviceType(typeof d.type === 'string' ? d.type : undefined);
    const pos = layout(devices.length);
    const device = createDevice(type, pos.x, pos.y, layerId, {
      name,
      managementIp:
        typeof d.managementIp === 'string'
          ? d.managementIp
          : typeof d.ip === 'string'
            ? d.ip
            : undefined,
      vendor: typeof d.vendor === 'string' ? d.vendor : undefined,
      notes: typeof d.notes === 'string' ? d.notes : undefined,
    });
    devices.push(device);
  });

  // Same order-independent matching as the CSV link import: a duplicated name is
  // ambiguous and skipped, never resolved to whichever device came last.
  const resolve = deviceNameResolver(devices);
  const links: Link[] = [];
  let unknown = 0;
  if (data.links !== undefined && !Array.isArray(data.links))
    warnings.push('"links" is not an array — no links imported.');
  const rawLinks = Array.isArray(data.links) ? data.links : [];
  rawLinks.forEach((l, i) => {
    if (!isRecord(l)) {
      skipped++;
      warnings.push(`Link ${i + 1}: not a link object — skipped.`);
      return;
    }
    const srcName = nameText(l.source);
    const tgtName = nameText(l.target);
    const src = srcName ? resolve(srcName) : null;
    const tgt = tgtName ? resolve(tgtName) : null;
    if (src?.kind === 'found' && tgt?.kind === 'found') {
      links.push(createLink(src.device.id, tgt.device.id, layerId));
      return;
    }
    skipped++;
    const ambiguous = [
      src?.kind === 'ambiguous' ? describeAmbiguous(srcName!, src.matches) : null,
      tgt?.kind === 'ambiguous' ? describeAmbiguous(tgtName!, tgt.matches) : null,
    ].filter(Boolean);
    if (ambiguous.length > 0)
      warnings.push(`Link ${i + 1}: ${ambiguous.join('; ')} — skipped.`);
    else unknown++;
  });
  if (unknown > 0)
    warnings.push(`${unknown} link(s) referenced unknown devices and were skipped.`);
  return { devices, links, warnings, skipped };
}
