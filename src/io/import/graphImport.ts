/**
 * Topology interchange imports (Phase 3): GraphML and draw.io (mxGraph) XML, plus
 * generic JSON. Each produces the same ImportResult shape as the CSV importer so
 * the dialog + transactional commit are reused. Pure-ish (uses DOMParser, which
 * jsdom provides) so the parsers are unit-tested.
 */
import { createDevice, createLink } from '@/model/schema';
import type { Device, DeviceType, Link } from '@/model/types';
import { stripDangerousKeys } from '@/model/migrate';
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

const CSS_URL = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi;

/** Whether any `url(...)` inside an attribute value points outside the file. */
function hasExternalUrl(value: string): boolean {
  return (value.match(CSS_URL) ?? []).some(isExternalSvgReference);
}

function isExternalSvgReference(value: string): boolean {
  const v = value
    .trim()
    .replace(/^url\(\s*['"]?|['"]?\s*\)$/g, '')
    // Browsers ignore whitespace/control characters inside a scheme ("java\nscript:").
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0020]/g, '');
  if (v.startsWith('#')) return false;
  if (/^(https?:)?\/\//i.test(v)) return true;
  if (/^(file|ftp|blob|wss?|javascript|vbscript):/i.test(v)) return true;
  if (/^data:/i.test(v) && !/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(v))
    return true;
  return false;
}

/**
 * Split CSS into top-level chunks: whole rules (`sel { … }`, `@media { … }`) and,
 * outside any block, single declarations / at-statements ending in `;`. Quotes
 * and parentheses are respected, so `url(data:…;base64,…)` stays in one piece.
 * Every character of the input lands in exactly one chunk.
 */
function cssChunks(css: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  let braces = 0;
  let parens = 0;
  let quote = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === '\\') {
      i++; // an escape: skip whatever it escapes
    } else if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      parens++;
    } else if (c === ')') {
      parens = Math.max(0, parens - 1);
    } else if (c === '{') {
      braces++;
    } else if (c === '}') {
      braces = Math.max(0, braces - 1);
      if (braces === 0) {
        chunks.push(css.slice(start, i + 1));
        start = i + 1;
        parens = 0;
      }
    } else if (c === ';' && braces === 0 && parens === 0) {
      chunks.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < css.length) chunks.push(css.slice(start));
  return chunks;
}

/** What may be left in CSS once its url(...) tokens are set aside: no scheme, no `//host`. */
const CSS_REMOTE = /(?:^|[^a-z0-9+.-])(?:https?|ftp|file|blob|data|javascript|wss?):|(?:^|["'(,\s])\/\//i;

/**
 * Make a CSS fragment (a `style` attribute or a `<style>` sheet) reference nothing
 * outside the file, one rule/declaration at a time:
 *  - an `@import` is removed;
 *  - an external `url(...)` target becomes `none` (local `#id` and embedded
 *    `data:image/…` targets are kept);
 *  - a rule/declaration that contains a backslash is removed: CSS escapes
 *    (`\75rl(`, `ht\74ps:`) can spell a URL this cannot see;
 *  - a rule/declaration that still names a remote scheme or a `//host` afterwards
 *    (e.g. `image-set("https://…")`, which takes bare strings) is removed.
 * Everything else — including a harmless `//` inside a string such as
 * `content:"a//b"` — is kept as written.
 */
export function stripExternalCssReferences(css: string): { css: string; stripped: number } {
  let stripped = 0;
  const out: string[] = [];
  for (const chunk of cssChunks(css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    if (chunk.includes('\\') || /^\s*@import\b/i.test(chunk)) {
      stripped++;
      continue;
    }
    const rewritten = chunk.replace(CSS_URL, (m) => {
      if (isExternalSvgReference(m)) {
        stripped++;
        return 'none';
      }
      return m;
    });
    // Judge what is left with the (safe) url() tokens set aside: base64 may contain "//".
    const residue = rewritten.replace(CSS_URL, ' ');
    if (/@import\b/i.test(residue) || CSS_REMOTE.test(residue)) {
      stripped++;
      continue;
    }
    out.push(rewritten);
  }
  const joined = out.join('');
  // Belt and braces: the kept chunks, read as one text, must still be clean.
  if (joined.includes('\\') || CSS_REMOTE.test(joined.replace(CSS_URL, ' '))) {
    return { css: '', stripped: stripped + 1 };
  }
  return { css: joined, stripped };
}

const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const entityCache = new Map<string, string | null>();

/** The text an HTML named entity stands for, or null if there is no such entity. */
function decodeHtmlEntity(entity: string): string | null {
  let hit = entityCache.get(entity);
  if (hit === undefined) {
    const text = new DOMParser().parseFromString(entity, 'text/html').body?.textContent ?? entity;
    // A real entity is one or two characters. Longer means the HTML parser only
    // matched a legacy prefix (`&notanentity;` → "¬anentity;"): not an entity.
    hit = text === entity || [...text].length > 2 ? null : text;
    entityCache.set(entity, hit);
  }
  return hit;
}

/**
 * XML knows five named entities; HTML knows thousands, and an HTML serialiser
 * (DOMPurify's) writes a non-breaking space as `&nbsp;` — which is a fatal error
 * to the XML parser. Rewrite every HTML-only named entity as the numeric
 * reference for the same character (`&nbsp;` → `&#160;`). An unknown name is left
 * alone, so genuinely malformed input still fails to parse.
 */
function htmlEntitiesToNumeric(svg: string): string {
  return svg.replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, name: string) => {
    if (XML_ENTITIES.has(name)) return m;
    const text = decodeHtmlEntity(m);
    if (text === null) return m;
    return [...text].map((ch) => `&#${ch.codePointAt(0)};`).join('');
  });
}

/**
 * Remove external fetch references from sanitized SVG underlays. DOMPurify handles
 * scripts/unsafe markup; this extra pass protects the local-first privacy promise
 * by preventing imported SVGs from loading remote images, filters, masks, fonts,
 * etc. — in attributes, `style` attributes and `<style>` sheets alike.
 *
 * Fails CLOSED: an SVG that does not parse cannot be checked, so it is REJECTED
 * (throws an Error with a user-facing message) rather than passed through as-is.
 */
export function stripExternalSvgReferences(svg: string): {
  svg: string;
  stripped: number;
} {
  const doc = new DOMParser().parseFromString(htmlEntitiesToNumeric(svg), 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement?.localName !== 'svg') {
    throw new Error(
      'this SVG is not well-formed, so it could not be checked for external references',
    );
  }
  let stripped = 0;
  doc.querySelectorAll('script,foreignObject,iframe,object,embed').forEach((el) => {
    stripped++;
    el.remove();
  });
  doc.querySelectorAll('style').forEach((el) => {
    const res = stripExternalCssReferences(el.textContent ?? '');
    if (res.stripped > 0) {
      el.textContent = res.css;
      stripped += res.stripped;
    }
  });
  const linkAttrs = new Set(['href', 'xlink:href', 'src']);
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (/^on/.test(name)) {
        el.removeAttribute(attr.name);
        stripped++;
      } else if (name === 'style') {
        const res = stripExternalCssReferences(attr.value);
        if (res.stripped > 0) {
          if (res.css.trim()) el.setAttribute(attr.name, res.css);
          else el.removeAttribute(attr.name);
          stripped += res.stripped;
        }
      } else if (
        // A link attribute, or ANY presentation attribute carrying a url(...)
        // (fill, stroke, filter, mask, clip-path, marker-*, cursor, …).
        linkAttrs.has(name)
          ? isExternalSvgReference(attr.value)
          : hasExternalUrl(attr.value)
      ) {
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

/** Longest name / longest free-text field an imported JSON row may carry. */
export const MAX_IMPORT_NAME = 256;
export const MAX_IMPORT_TEXT = 10_000;

/** Cut an imported string to `max` characters (a megabyte "name" would wreck layout and export). */
function clip(v: string | undefined, max: number): string | undefined {
  return v !== undefined && v.length > max ? v.slice(0, max) : v;
}

/** A usable name/endpoint value: a non-blank string, or a number (`"name": 7`). */
function nameText(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() ? clip(v.trim(), MAX_IMPORT_NAME) : undefined;
}

/**
 * JSON.parse for an import: prototype-pollution keys are stripped before any field
 * is read. Throws (bad JSON, or nested too deeply to be a topology file) — callers
 * turn that into a "not valid JSON" result.
 */
function parseImportJson(text: string): unknown {
  return stripDangerousKeys(JSON.parse(text) as unknown);
}

/**
 * Parse a NetBox device-list JSON export (`results[]`). Links aren't included. Every
 * row is checked before any field is read: a null/non-object row is skipped with a
 * row-level warning instead of throwing and aborting the whole file.
 */
export function parseNetboxJson(text: string, layerId: string): ImportResult {
  let data: unknown;
  try {
    data = parseImportJson(text);
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
    const name = clip(str(d.name) || str(d.display), MAX_IMPORT_NAME) || `device-${i}`;
    const roleLabel =
      clip(nested(d.device_role, 'name') ?? nested(d.role, 'name'), MAX_IMPORT_NAME) ?? '';
    const pos = layout(devices.length);
    devices.push(
      createDevice(inferType(roleLabel || name), pos.x, pos.y, layerId, {
        name,
        role: roleLabel || undefined,
        model: clip(nested(d.device_type, 'model'), MAX_IMPORT_NAME),
        vendor: clip(nested(d.device_type, 'manufacturer', 'name'), MAX_IMPORT_NAME),
        location: clip(nested(d.site, 'name'), MAX_IMPORT_NAME),
        managementIp: clip(
          nested(d.primary_ip, 'address') ?? nested(d.primary_ip4, 'address'),
          MAX_IMPORT_NAME,
        ),
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
    data = parseImportJson(text);
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
      managementIp: clip(
        typeof d.managementIp === 'string'
          ? d.managementIp
          : typeof d.ip === 'string'
            ? d.ip
            : undefined,
        MAX_IMPORT_NAME,
      ),
      vendor: clip(typeof d.vendor === 'string' ? d.vendor : undefined, MAX_IMPORT_NAME),
      notes: clip(typeof d.notes === 'string' ? d.notes : undefined, MAX_IMPORT_TEXT),
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
