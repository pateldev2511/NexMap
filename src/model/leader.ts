/**
 * Leader-line geometry (schema v4 callouts). One pure, scene-space function drives
 * every leader everywhere — flat canvas, iso scene, and all SVG exporters — so a
 * leader can never be drawn two different ways. Endpoints are the points where the
 * center-to-center segment crosses each box's boundary, which keeps the line from
 * disappearing under either the callout or its target.
 */
import type { CalloutAnchor, LeaderStyle } from './types';

/** Any axis-aligned box in scene space. */
export interface LeaderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LeaderLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Default leader look when a callout has an anchor but no explicit style. */
export const DEFAULT_LEADER: LeaderStyle = { color: '#2563eb', dash: 'dotted', width: 1.5 };

/** SVG stroke-dasharray for a dash style at a given stroke width. */
export function leaderDashArray(style: LeaderStyle): string | undefined {
  switch (style.dash) {
    case 'dotted':
      return `${Math.max(0.5, style.width)} ${style.width * 2.5}`;
    case 'dashed':
      return `${style.width * 4} ${style.width * 3}`;
    default:
      return undefined; // solid
  }
}

function center(r: LeaderRect) {
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}

/**
 * The point on `rect`'s boundary in direction (dx, dy) from its center. A zero-size
 * rect (a "point" target) returns its center. The direction need not be normalized.
 */
function edgePoint(rect: LeaderRect, dx: number, dy: number): { x: number; y: number } {
  const { cx, cy } = center(rect);
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  if (hw === 0 && hh === 0) return { x: cx, y: cy };
  // Scale the direction so it lands on the nearest face.
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Compute a leader from `box` (the callout) to `target`. Returns the boundary-to-
 * boundary segment, or null when the two centers coincide (nothing sensible to draw).
 */
export function leaderGeometry(box: LeaderRect, target: LeaderRect): LeaderLine | null {
  const b = center(box);
  const t = center(target);
  const dx = t.cx - b.cx;
  const dy = t.cy - b.cy;
  if (dx === 0 && dy === 0) return null; // fully concentric — degenerate
  const p1 = edgePoint(box, dx, dy); // leave the box toward the target
  const p2 = edgePoint(target, -dx, -dy); // enter the target toward the box
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

/** Look up a device/object bbox by id (returns null if it no longer exists). */
export interface TargetLookup {
  (id: string): LeaderRect | null;
}

/**
 * Resolve an anchor to a target rect in scene space. `device` ids are looked up
 * lazily (dangling ⇒ null ⇒ no leader); `point` becomes a zero-size rect; null ⇒
 * no leader.
 */
export function resolveLeaderTarget(
  anchor: CalloutAnchor | undefined,
  lookup: TargetLookup,
): LeaderRect | null {
  if (!anchor) return null;
  if (anchor.type === 'point') return { x: anchor.x, y: anchor.y, width: 0, height: 0 };
  return lookup(anchor.id);
}
