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

/**
 * Point on the visible 3D icon boundary facing `toward`. The model still stores
 * links between device IDs; this helper trims rendered lines so they meet the
 * icon object instead of visually running into the device center.
 */
export function iconEdgePoint(device: Device, toward: Pt): Pt {
  const c = center(device);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const rx = Math.max(10, Math.min(device.width * 0.34, 22));
  const ry = Math.max(8, Math.min(device.height * 0.38, 18));
  const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Full ordered point list of a connector. */
export function connectorPoints(link: Link, source: Device, target: Device): Pt[] {
  return [center(source), ...(link.waypoints ?? []), center(target)];
}

/** Render points with endpoints trimmed to the visible 3D icon boundary. */
export function connectorIconPoints(link: Link, source: Device, target: Device): Pt[] {
  const waypoints = link.waypoints ?? [];
  const sourceToward = waypoints[0] ?? center(target);
  const targetToward = waypoints[waypoints.length - 1] ?? center(source);
  return [
    iconEdgePoint(source, sourceToward),
    ...waypoints,
    iconEdgePoint(target, targetToward),
  ];
}

/** Unordered device-pair key for grouping parallel links. */
export function pairKey(link: Link): string {
  return [link.sourceId, link.targetId].sort().join('|');
}

// ── Semantic stroke (Stage: connectors) ─────────────────────────────────────

export const DEFAULT_LINK_WIDTH = 1.5;
/** Allowed manual stroke-width range (the inspector slider bounds). */
export const MIN_LINK_WIDTH = 1;
export const MAX_LINK_WIDTH = 8;

/** Minimal health context for stroke derivation (subset of HealthReport). */
export interface StrokeHealth {
  criticalLinkPairs: string[];
  conflictLinkIds: string[];
}

export interface LinkStroke {
  /** Explicit stroke color, or null to use the surface default (theme grey in-app, #94a3b8 in export). */
  color: string | null;
  dashed: boolean;
  width: number;
}

export const HEALTH_AMBER = '#d97706';
export const HEALTH_RED = '#dc2626';
/** Concrete default used where CSS vars don't resolve (SVG/PNG/HTML export). */
export const EXPORT_DEFAULT_STROKE = '#94a3b8';

/**
 * Resolve a link's stroke from manual overrides + topology health. ONE source of truth
 * shared by flat render, iso render, and SVG export so they never drift.
 *
 * Color precedence: manual `link.color` wins; else conflict→red, critical bridge→amber,
 * else default grey. Dash is INDEPENDENT: inferred (scan-derived) → dashed; else honor
 * `link.style`. Width: manual `link.width` (inspector slider) or the default — bandwidth
 * no longer drives thickness (it stays a data/label field).
 */
export function deriveLinkStroke(
  link: Link,
  health: StrokeHealth | null,
  /** Whether this link is the sole member of its device pair (parallel members aren't critical). */
  soleMember: boolean,
): LinkStroke {
  const conflict = health?.conflictLinkIds.includes(link.id) ?? false;
  const critical =
    soleMember && (health?.criticalLinkPairs.includes(pairKey(link)) ?? false);

  let color: string | null;
  if (link.color) color = link.color;
  else if (conflict) color = HEALTH_RED;
  else if (critical) color = HEALTH_AMBER;
  else color = null; // surface default (theme grey in-app, EXPORT_DEFAULT_STROKE in export)

  const dashed = link.inferred === true || link.style === 'dashed';
  const width = link.width ?? DEFAULT_LINK_WIDTH;
  return { color, dashed, width };
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

/** Parallel-link render points with endpoints attached to icon boundaries. */
export function parallelIconPoints(
  link: Link,
  source: Device,
  target: Device,
  indexInGroup: number,
  groupSize: number,
  spacing = 18,
): Pt[] {
  if ((link.waypoints?.length ?? 0) > 0 || groupSize <= 1) {
    return connectorIconPoints(link, source, target);
  }
  const a = center(source);
  const b = center(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const offset = (indexInGroup - (groupSize - 1) / 2) * spacing;
  const mid = { x: (a.x + b.x) / 2 + px * offset, y: (a.y + b.y) / 2 + py * offset };
  return [iconEdgePoint(source, mid), mid, iconEdgePoint(target, mid)];
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

/** Orthogonal render points trimmed to icon boundaries. */
export function orthogonalIconPoints(source: Device, target: Device): Pt[] {
  const centerRun = orthogonalPoints(center(source), center(target));
  if (centerRun.length === 2) {
    return [iconEdgePoint(source, center(target)), iconEdgePoint(target, center(source))];
  }
  return [
    iconEdgePoint(source, centerRun[1]!),
    ...centerRun.slice(1, -1),
    iconEdgePoint(target, centerRun[centerRun.length - 2]!),
  ];
}

/** Coerce a possibly-non-string field to a trimmed string (tolerant of numbers
 *  from imports). Returns '' for null/undefined so the renderer never crashes on
 *  unexpected data — a render-time throw would blank the whole canvas. */
function field(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

/** The connector's stacked label lines (multi-label: name, bandwidth, VLANs, etc.). */
export function connectorLabelLines(link: Link): string[] {
  const lines: string[] = [];
  if (field(link.name)) lines.push(field(link.name));
  if (field(link.bandwidth)) lines.push(field(link.bandwidth));
  if (field(link.vlan)) lines.push(`VLAN ${field(link.vlan)}`);
  if (field(link.nativeVlan)) lines.push(`native ${field(link.nativeVlan)}`);
  if (field(link.lacp)) lines.push(`LACP ${field(link.lacp)}`);
  if (field(link.circuitId)) lines.push(`circuit ${field(link.circuitId)}`);
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
    mids.push({
      x: (points[i]!.x + points[i + 1]!.x) / 2,
      y: (points[i]!.y + points[i + 1]!.y) / 2,
    });
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
  return field(link.name) || field(link.bandwidth) || '';
}
