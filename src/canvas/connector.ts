/**
 * Connector geometry (Phase 2). Pure helpers shared by rendering, hit-handles,
 * and tests. A connector runs source-center → waypoints → target-center.
 */
import type { Device, Link } from '@/model/types';

export interface Pt {
  x: number;
  y: number;
}

export function center(d: Device): Pt {
  return { x: d.x + d.width / 2, y: d.y + d.height / 2 };
}

/** Full ordered point list of a connector. */
export function connectorPoints(link: Link, source: Device, target: Device): Pt[] {
  return [center(source), ...(link.waypoints ?? []), center(target)];
}

/** Unordered device-pair key for grouping parallel links. */
export function pairKey(link: Link): string {
  return [link.sourceId, link.targetId].sort().join('|');
}

/**
 * Points for a link that may be one of several parallel links between the same
 * pair. With no explicit waypoints and a group size > 1, insert a midpoint offset
 * perpendicular to the line so parallel links fan out instead of overlapping.
 */
export function parallelPoints(
  link: Link,
  source: Device,
  target: Device,
  indexInGroup: number,
  groupSize: number,
  spacing = 18,
): Pt[] {
  if ((link.waypoints?.length ?? 0) > 0 || groupSize <= 1) {
    return connectorPoints(link, source, target);
  }
  const a = center(source);
  const b = center(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Unit perpendicular.
  const px = -dy / len;
  const py = dx / len;
  const offset = (indexInGroup - (groupSize - 1) / 2) * spacing;
  const mid = { x: (a.x + b.x) / 2 + px * offset, y: (a.y + b.y) / 2 + py * offset };
  return [a, mid, b];
}

/**
 * Convert a 2-point straight run into an orthogonal Z-elbow (horizontal-first
 * via the mid-x). Applied only to the source→target run when routing is
 * orthogonal and there are no explicit waypoints.
 */
export function orthogonalPoints(a: Pt, b: Pt): Pt[] {
  if (a.x === b.x || a.y === b.y) return [a, b]; // already straight
  const midX = (a.x + b.x) / 2;
  return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
}

/** The connector's stacked label lines (multi-label: name, bandwidth, VLANs, etc.). */
export function connectorLabelLines(link: Link): string[] {
  const lines: string[] = [];
  if (link.name?.trim()) lines.push(link.name.trim());
  if (link.bandwidth?.trim()) lines.push(link.bandwidth.trim());
  if (link.vlan?.trim()) lines.push(`VLAN ${link.vlan.trim()}`);
  if (link.nativeVlan?.trim()) lines.push(`native ${link.nativeVlan.trim()}`);
  if (link.lacp?.trim()) lines.push(`LACP ${link.lacp.trim()}`);
  if (link.circuitId?.trim()) lines.push(`circuit ${link.circuitId.trim()}`);
  return lines;
}

/** A point a short distance from `from` toward `to` (for endpoint labels). */
export function alongFrom(from: Pt, to: Pt, dist: number): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
}

/** SVG path data for a polyline through the points. */
export function pathD(points: Pt[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
}

/** Midpoints of each segment (insertion points for new waypoints). */
export function segmentMidpoints(points: Pt[]): Pt[] {
  const mids: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    mids.push({ x: (points[i]!.x + points[i + 1]!.x) / 2, y: (points[i]!.y + points[i + 1]!.y) / 2 });
  }
  return mids;
}

/** The point to anchor a connector's label (middle segment's midpoint). */
export function labelAnchor(points: Pt[]): Pt {
  const mids = segmentMidpoints(points);
  return mids[Math.floor(mids.length / 2)] ?? points[0] ?? { x: 0, y: 0 };
}

/** Short text shown on the connector: name, else bandwidth, else ''. */
export function connectorLabel(link: Link): string {
  return link.name?.trim() || link.bandwidth?.trim() || '';
}
