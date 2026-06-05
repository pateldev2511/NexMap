/**
 * Build an SVG document from the model (spec Export — "export from the internal
 * model, not screenshot"). Pure string output so it's unit-testable and is the
 * shared source for SVG download AND the PNG/JPG/PDF raster paths.
 *
 * Security (DA-S1): we EMIT our own SVG from trusted model data — no user SVG is
 * echoed back — and we escape all text, so the output carries no scripts or
 * external references by construction. Object IDs are preserved for round-trip.
 */
import { deviceVisual, deviceIconGroup } from '@/canvas/deviceVisuals';
import { isoProjectPx, DEFAULT_TILE } from '@/canvas/iso';
import type { CanvasObject, Device, Link } from '@/model/types';

export interface ExportSvgOptions {
  background: string | null; // null = transparent
  includeLabels: boolean;
  padding?: number;
  /** Text notes + shapes/zones to include (shapes render under devices). */
  objects?: CanvasObject[];
  /** Render the isometric projection instead of the flat scene (Phase 9.6). */
  projection?: 'flat' | 'iso';
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
    const x1 = a.x + a.width / 2,
      y1 = a.y + a.height / 2;
    const x2 = t.x + t.width / 2,
      y2 = t.y + t.height / 2;
    parts.push(
      `<line data-id="${escapeXml(l.id)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" stroke-width="1.5"/>`,
    );
  }

  // Devices.
  for (const d of devices) {
    const v = deviceVisual(d.type);
    parts.push(`<g data-id="${escapeXml(d.id)}" transform="translate(${d.x} ${d.y})">`);
    parts.push(
      `<rect width="${d.width}" height="${d.height}" rx="6" fill="${escapeXml(d.fill ?? '#ffffff')}" stroke="#cbd5e1" stroke-width="1.5"/>`,
    );
    parts.push(
      `<rect x="4" y="4" width="18" height="${d.height - 8}" rx="3" fill="${escapeXml(v.accent)}"/>`,
    );
    parts.push(deviceIconGroup(d.type, 13, d.height / 2, 15));
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
    parts.push(
      `<text data-id="${escapeXml(o.id)}" x="${o.x + 4}" y="${o.y + (o.fontSize ?? 14)}" font-size="${o.fontSize ?? 14}" fill="${escapeXml(o.color ?? '#1c2733')}">${escapeXml(o.text)}</text>`,
    );
  }

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
    parts.push(
      `<line x1="${s.x + s.width / 2}" y1="${s.y + s.height / 2}" x2="${t.x + t.width / 2}" y2="${t.y + t.height / 2}" stroke="#94a3b8" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
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
    const v = deviceVisual(d.type);
    const tl = P(d.x, d.y);
    const tr = P(d.x + d.width, d.y);
    const br = P(d.x + d.width, d.y + d.height);
    const bl = P(d.x, d.y + d.height);
    const c = P(d.x + d.width / 2, d.y + d.height / 2);
    const accent = escapeXml(v.accent);
    const top = `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`;
    const skirtL = `${bl.x},${bl.y} ${br.x},${br.y} ${br.x},${br.y + ISO_DEPTH} ${bl.x},${bl.y + ISO_DEPTH}`;
    const skirtR = `${tr.x},${tr.y} ${br.x},${br.y} ${br.x},${br.y + ISO_DEPTH} ${tr.x},${tr.y + ISO_DEPTH}`;
    parts.push(`<polygon points="${skirtL}" fill="${accent}" fill-opacity="0.55"/>`);
    parts.push(`<polygon points="${skirtR}" fill="${accent}" fill-opacity="0.72"/>`);
    parts.push(
      `<polygon points="${top}" fill="${escapeXml(d.fill ?? '#ffffff')}" stroke="#cbd5e1" stroke-width="1.5" stroke-linejoin="round"/>`,
    );
    const bs = 20;
    parts.push(
      `<rect x="${c.x - bs / 2}" y="${c.y - bs / 2 - 2}" width="${bs}" height="${bs}" rx="4" fill="${accent}"/>`,
    );
    parts.push(deviceIconGroup(d.type, c.x, c.y - 2, bs - 3));
    if (opts.includeLabels) {
      parts.push(
        `<text x="${c.x}" y="${br.y + ISO_DEPTH + 12}" fill="#1c2733" font-size="11" text-anchor="middle">${escapeXml(d.name)}</text>`,
      );
    }
  }

  // --- Text notes (upright, projected). ---
  for (const o of objects) {
    if (o.kind !== 'text') continue;
    const p = P(o.x, o.y);
    parts.push(
      `<text x="${p.x}" y="${p.y + (o.fontSize ?? 14)}" font-size="${o.fontSize ?? 14}" fill="${escapeXml(o.color ?? '#1c2733')}">${escapeXml(o.text)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join('');
}
