/**
 * Build an SVG document from the model (spec Export — "export from the internal
 * model, not screenshot"). Pure string output so it's unit-testable and is the
 * shared source for SVG download AND the PNG/JPG/PDF raster paths.
 *
 * Security (DA-S1): we EMIT our own SVG from trusted model data — no user SVG is
 * echoed back — and we escape all text, so the output carries no scripts or
 * external references by construction. Object IDs are preserved for round-trip.
 */
import { deviceVisual } from '@/canvas/deviceVisuals';
import type { CanvasObject, Device, Link } from '@/model/types';

export interface ExportSvgOptions {
  background: string | null; // null = transparent
  includeLabels: boolean;
  padding?: number;
  /** Text notes + shapes/zones to include (shapes render under devices). */
  objects?: CanvasObject[];
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
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height + 16 /* label headroom */);
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

export function buildSvg(devices: Device[], links: Link[], opts: ExportSvgOptions): string {
  const padding = opts.padding ?? 40;
  const objects = opts.objects ?? [];
  const b = bounds([...devices, ...objects], padding) ?? { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const byId = new Map(devices.map((d) => [d.id, d]));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
      `viewBox="${b.minX} ${b.minY} ${w} ${h}" font-family="sans-serif">`,
  );
  if (opts.background) {
    parts.push(`<rect x="${b.minX}" y="${b.minY}" width="${w}" height="${h}" fill="${escapeXml(opts.background)}"/>`);
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
      parts.push(`<ellipse data-id="${escapeXml(o.id)}" cx="${o.x + o.width / 2}" cy="${o.y + o.height / 2}" rx="${o.width / 2}" ry="${o.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    } else {
      parts.push(`<rect data-id="${escapeXml(o.id)}" x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    }
    if (o.label) parts.push(`<text x="${o.x + 8}" y="${o.y + 16}" fill="#64748b" font-size="11">${escapeXml(o.label)}</text>`);
  }

  // Links (under devices).
  for (const l of links) {
    const a = byId.get(l.sourceId);
    const t = byId.get(l.targetId);
    if (!a || !t) continue;
    const x1 = a.x + a.width / 2, y1 = a.y + a.height / 2;
    const x2 = t.x + t.width / 2, y2 = t.y + t.height / 2;
    parts.push(`<line data-id="${escapeXml(l.id)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" stroke-width="1.5"/>`);
  }

  // Devices.
  for (const d of devices) {
    const v = deviceVisual(d.type);
    parts.push(`<g data-id="${escapeXml(d.id)}" transform="translate(${d.x} ${d.y})">`);
    parts.push(`<rect width="${d.width}" height="${d.height}" rx="6" fill="${escapeXml(d.fill ?? '#ffffff')}" stroke="#cbd5e1" stroke-width="1.5"/>`);
    parts.push(`<rect x="4" y="4" width="18" height="${d.height - 8}" rx="3" fill="${escapeXml(v.accent)}"/>`);
    parts.push(`<text x="13" y="${d.height / 2}" fill="#fff" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeXml(v.glyph)}</text>`);
    if (opts.includeLabels) {
      parts.push(`<text x="${d.width / 2}" y="${d.height + 12}" fill="#1c2733" font-size="11" text-anchor="middle">${escapeXml(d.name)}</text>`);
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
