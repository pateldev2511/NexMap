/**
 * Build an SVG document from the model (spec Export — "export from the internal
 * model, not screenshot"). Pure string output so it's unit-testable and is the
 * shared source for SVG download AND the PNG/JPG/PDF raster paths.
 *
 * Security (DA-S1): we EMIT our own SVG from trusted model data — no user SVG is
 * echoed back — and we escape all text, so the output carries no scripts or
 * external references by construction. Object IDs are preserved for round-trip.
 */
import {
  connectorIconPoints,
  orthogonalIconPoints,
  pathD,
  deriveLinkStroke,
  bandwidthToWidth,
  pairKey,
  EXPORT_DEFAULT_STROKE,
  type StrokeHealth,
} from '@/canvas/connector';
import { deviceIsoGroup } from '@/canvas/deviceIso';
import { isoProjectPx, DEFAULT_TILE } from '@/canvas/iso';
import type { CanvasObject, Device, Link, TextObject } from '@/model/types';

export interface ExportSvgOptions {
  background: string | null; // null = transparent
  includeLabels: boolean;
  padding?: number;
  /** Text notes + shapes/zones to include (shapes render under devices). */
  objects?: CanvasObject[];
  /** Render the isometric projection instead of the flat scene (Phase 9.6). */
  projection?: 'flat' | 'iso';
  /** Topology-health context to tint risky links (SPOF/conflict). Null = no tint. */
  health?: StrokeHealth | null;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bounds(
  boxes: { x: number; y: number; width: number; height: number }[],
  padding: number,
): Bounds | null {
  if (boxes.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height + 16 /* label headroom */);
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

/**
 * Stroke attributes for a link in static export. Honors manual color/width + bandwidth
 * thickness + inferred/style dash (health auto-tint is live-only, omitted from exports).
 */
function countPairs(links: Link[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    const k = pairKey(l);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function linkStrokeAttrs(l: Link, health: StrokeHealth | null, sole: boolean): string {
  const s = deriveLinkStroke(l, health, sole);
  const dash = s.dashed ? ' stroke-dasharray="6 4"' : '';
  return `stroke="${escapeXml(s.color ?? EXPORT_DEFAULT_STROKE)}" stroke-width="${s.width}"${dash}`;
}

/** Bandwidth→thickness key, anchored bottom-left, only when a link carries a bandwidth. */
function bandwidthLegendSvg(links: Link[], x: number, yBottom: number): string {
  if (!links.some((l) => l.bandwidth)) return '';
  const samples = ['1G', '10G', '100G'];
  const lh = 14;
  let y = yBottom - samples.length * lh;
  const parts = [`<text x="${x}" y="${y}" font-size="9" font-weight="700" fill="#64748b">BANDWIDTH</text>`];
  for (const bw of samples) {
    y += lh;
    parts.push(
      `<line x1="${x}" y1="${y - 3}" x2="${x + 26}" y2="${y - 3}" stroke="${EXPORT_DEFAULT_STROKE}" stroke-width="${bandwidthToWidth(bw)}" stroke-linecap="round"/>`,
      `<text x="${x + 32}" y="${y}" font-size="9" fill="#64748b">${bw}</text>`,
    );
  }
  return parts.join('');
}

/**
 * Annotation card → stacked, escaped SVG text (heading / subheading / body). Absent
 * fields collapse. Used by both flat and iso export so they match the canvas.
 */
function textObjectSvg(o: TextObject, baseX: number, baseY: number): string {
  const fs = o.fontSize ?? 14;
  const fill = escapeXml(o.color ?? '#1c2733');
  const rows: { t: string; size: number; weight: number; fill: string }[] = [];
  if (o.heading) rows.push({ t: o.heading, size: Math.round(fs * 1.3), weight: 700, fill });
  if (o.subheading)
    rows.push({ t: o.subheading, size: Math.round(fs * 0.95), weight: 500, fill: '#64748b' });
  if (o.text) rows.push({ t: o.text, size: fs, weight: 400, fill });
  let y = baseY;
  return rows
    .map((r) => {
      y += r.size * 1.25;
      return `<text x="${baseX}" y="${y}" font-size="${r.size}" font-weight="${r.weight}" fill="${r.fill}">${escapeXml(r.t)}</text>`;
    })
    .join('');
}

export function buildSvg(
  devices: Device[],
  links: Link[],
  opts: ExportSvgOptions,
): string {
  if (opts.projection === 'iso') return buildSvgIso(devices, links, opts);
  const padding = opts.padding ?? 40;
  const objects = opts.objects ?? [];
  const b = bounds([...devices, ...objects], padding) ?? {
    minX: 0,
    minY: 0,
    maxX: 400,
    maxY: 300,
  };
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const byId = new Map(devices.map((d) => [d.id, d]));
  const health = opts.health ?? null;
  const pairCount = countPairs(links);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
      `viewBox="${b.minX} ${b.minY} ${w} ${h}" font-family="sans-serif">`,
  );
  if (opts.background) {
    parts.push(
      `<rect x="${b.minX}" y="${b.minY}" width="${w}" height="${h}" fill="${escapeXml(opts.background)}"/>`,
    );
  }

  // Image underlays render at the very back.
  for (const o of objects) {
    if (o.kind !== 'image') continue;
    parts.push(
      `<image href="${escapeXml(o.href)}" x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" opacity="${o.opacity ?? 1}" preserveAspectRatio="none"/>`,
    );
  }

  // Shapes/zones render under links/devices.
  for (const o of objects) {
    if (o.kind !== 'shape') continue;
    const fill = escapeXml(o.fill ?? '#e8effb');
    const stroke = escapeXml(o.stroke ?? '#2563eb');
    if (o.shape === 'ellipse') {
      parts.push(
        `<ellipse data-id="${escapeXml(o.id)}" cx="${o.x + o.width / 2}" cy="${o.y + o.height / 2}" rx="${o.width / 2}" ry="${o.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
      );
    } else {
      parts.push(
        `<rect data-id="${escapeXml(o.id)}" x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
      );
    }
    if (o.label)
      parts.push(
        `<text x="${o.x + 8}" y="${o.y + 16}" fill="#64748b" font-size="11">${escapeXml(o.label)}</text>`,
      );
  }

  // Links (under devices).
  for (const l of links) {
    const a = byId.get(l.sourceId);
    const t = byId.get(l.targetId);
    if (!a || !t) continue;
    const pts =
      l.routing === 'orthogonal' && (l.waypoints?.length ?? 0) === 0
        ? orthogonalIconPoints(a, t)
        : connectorIconPoints(l, a, t);
    parts.push(
      `<path data-id="${escapeXml(l.id)}" d="${pathD(pts)}" fill="none" ${linkStrokeAttrs(l, health, (pairCount.get(pairKey(l)) ?? 0) === 1)} stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }

  // Devices.
  for (const d of devices) {
    parts.push(`<g data-id="${escapeXml(d.id)}" transform="translate(${d.x} ${d.y})">`);
    const iconSize = Math.max(22, Math.min(d.width * 0.72, d.height * 0.82));
    parts.push(
      deviceIsoGroup(d.type, d.width / 2, d.height / 2 - 1, iconSize),
    );
    if (opts.includeLabels) {
      parts.push(
        `<text x="${d.width / 2}" y="${d.height + 12}" fill="#1c2733" font-size="11" text-anchor="middle">${escapeXml(d.name)}</text>`,
      );
    }
    parts.push(`</g>`);
  }

  // Text notes render on top.
  for (const o of objects) {
    if (o.kind !== 'text') continue;
    parts.push(`<g data-id="${escapeXml(o.id)}">${textObjectSvg(o, o.x + 4, o.y)}</g>`);
  }

  parts.push(bandwidthLegendSvg(links, b.minX + 12, b.maxY - 8));
  parts.push(`</svg>`);
  return parts.join('');
}

const ISO_GRID = 16;
const ISO_DEPTH = 12;

/**
 * Isometric variant of {@link buildSvg} (Phase 9.6). Floor elements (images,
 * shapes, links) render inside one matrix group that shears flat coords onto the
 * iso plane; device tiles and all labels render UPRIGHT at projected coordinates
 * (outside the matrix group), so glyphs/text stay readable — matching the editor.
 */
function buildSvgIso(devices: Device[], links: Link[], opts: ExportSvgOptions): string {
  const padding = opts.padding ?? 40;
  const objects = opts.objects ?? [];
  const tile = DEFAULT_TILE;
  const P = (x: number, y: number) => isoProjectPx(x, y, ISO_GRID, tile);
  const a = tile.w / (2 * ISO_GRID);
  const b = tile.h / (2 * ISO_GRID);
  const matrix = `matrix(${a} ${b} ${-a} ${b} 0 0)`;
  const byId = new Map(devices.map((d) => [d.id, d]));

  // Projected bounds: project the four corners of every box and both link ends.
  const pts: { x: number; y: number }[] = [];
  const addBox = (x: number, y: number, w: number, h: number) => {
    pts.push(P(x, y), P(x + w, y), P(x, y + h), P(x + w, y + h));
  };
  for (const d of devices) addBox(d.x, d.y, d.width, d.height);
  for (const o of objects) addBox(o.x, o.y, o.width, o.height);
  for (const l of links) {
    const s = byId.get(l.sourceId);
    const t = byId.get(l.targetId);
    if (s) pts.push(P(s.x + s.width / 2, s.y + s.height / 2));
    if (t) pts.push(P(t.x + t.width / 2, t.y + t.height / 2));
  }
  if (pts.length === 0) pts.push({ x: 0, y: 0 }, { x: 400, y: 300 });
  const minX = Math.min(...pts.map((p) => p.x)) - padding;
  const minY = Math.min(...pts.map((p) => p.y)) - padding;
  const maxX = Math.max(...pts.map((p) => p.x)) + padding;
  // Extra headroom for tile depth + the label that sits below each tile.
  const maxY = Math.max(...pts.map((p) => p.y)) + padding + ISO_DEPTH + 16;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const health = opts.health ?? null;
  const pairCount = countPairs(links);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
      `viewBox="${minX} ${minY} ${w} ${h}" font-family="sans-serif">`,
  );
  if (opts.background) {
    parts.push(
      `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="${escapeXml(opts.background)}"/>`,
    );
  }

  // --- Floor layer (sheared by the iso matrix): images, shapes, links. ---
  parts.push(`<g transform="${matrix}">`);
  for (const o of objects) {
    if (o.kind !== 'image') continue;
    parts.push(
      `<image href="${escapeXml(o.href)}" x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" opacity="${o.opacity ?? 1}" preserveAspectRatio="none"/>`,
    );
  }
  for (const o of objects) {
    if (o.kind !== 'shape') continue;
    const fill = escapeXml(o.fill ?? '#e8effb');
    const stroke = escapeXml(o.stroke ?? '#2563eb');
    if (o.shape === 'ellipse') {
      parts.push(
        `<ellipse cx="${o.x + o.width / 2}" cy="${o.y + o.height / 2}" rx="${o.width / 2}" ry="${o.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
      );
    } else {
      parts.push(
        `<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
      );
    }
  }
  for (const l of links) {
    const s = byId.get(l.sourceId);
    const t = byId.get(l.targetId);
    if (!s || !t) continue;
    const pts =
      l.routing === 'orthogonal' && (l.waypoints?.length ?? 0) === 0
        ? orthogonalIconPoints(s, t)
        : connectorIconPoints(l, s, t);
    parts.push(
      `<path d="${pathD(pts)}" fill="none" ${linkStrokeAttrs(l, health, (pairCount.get(pairKey(l)) ?? 0) === 1)} stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`,
    );
  }
  parts.push(`</g>`);

  // --- Upright shape labels (at projected anchors). ---
  for (const o of objects) {
    if (o.kind !== 'shape' || !o.label) continue;
    const p = P(o.x + 8, o.y + 16);
    parts.push(
      `<text x="${p.x}" y="${p.y}" fill="#64748b" font-size="11">${escapeXml(o.label)}</text>`,
    );
  }

  // --- Device tiles (upright, painter's order by x+y). ---
  const sorted = [...devices].sort((d1, d2) => d1.x + d1.y - (d2.x + d2.y));
  for (const d of sorted) {
    const br = P(d.x + d.width, d.y + d.height);
    const c = P(d.x + d.width / 2, d.y + d.height / 2);
    const iconSize = Math.max(24, Math.min(d.width * 0.55, d.height * 0.76));
    const iconCy = c.y - 2;
    parts.push(deviceIsoGroup(d.type, c.x, iconCy, iconSize));
    if (opts.includeLabels) {
      const labelY = Math.max(br.y + 8, iconCy + iconSize * 0.72);
      parts.push(
        `<text x="${c.x}" y="${labelY + 8}" fill="#1c2733" font-size="11" text-anchor="middle">${escapeXml(d.name)}</text>`,
      );
    }
  }

  // --- Text notes (upright, projected). ---
  for (const o of objects) {
    if (o.kind !== 'text') continue;
    const p = P(o.x, o.y);
    parts.push(textObjectSvg(o, p.x, p.y));
  }

  parts.push(bandwidthLegendSvg(links, minX + 12, maxY - 8));
  parts.push(`</svg>`);
  return parts.join('');
}
