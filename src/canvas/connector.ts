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
