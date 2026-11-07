/**
 * Small geometry helpers. `pointInPolygon` backs lasso/freehand selection.
 */
export interface Point {
  x: number;
  y: number;
}

/** Ray-casting point-in-polygon test. `poly` is an ordered list of vertices. */
export function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersects =
      a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Axis-aligned rectangle, top-left + size (same shape as the spatial index's Box). */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whether segment a→b touches the rectangle (edges inclusive). Liang–Barsky clip:
 * the segment hits iff some t in [0, 1] lies inside all four slabs.
 */
export function segmentIntersectsBox(a: Point, b: Point, box: Rect): boolean {
  return segmentHitsRect(a.x, a.y, b.x, b.y, box.x, box.y, box.x + box.width, box.y + box.height);
}

/**
 * {@link segmentIntersectsBox} on raw coordinates — allocation-free, since viewport
 * culling runs it for every off-screen link on every frame.
 */
export function segmentHitsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  // Cheap reject first: the segment's own bounds miss the box.
  if (
    (ax < minX && bx < minX) ||
    (ax > maxX && bx > maxX) ||
    (ay < minY && by < minY) ||
    (ay > maxY && by > maxY)
  )
    return false;
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dy : dy;
    const q = i === 0 ? ax - minX : i === 1 ? maxX - ax : i === 2 ? ay - minY : maxY - ay;
    if (p === 0) {
      if (q < 0) return false; // parallel to this slab and outside it
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/** Whether any leg of the polyline touches the rectangle grown by `pad` on every side. */
export function polylineIntersectsBox(points: Point[], box: Rect, pad = 0): boolean {
  const grown =
    pad > 0
      ? { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad }
      : box;
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsBox(points[i]!, points[i + 1]!, grown)) return true;
  }
  return false;
}

/** Simplify a freehand path by dropping points closer than `minDist` to the last kept. */
export function simplifyPath(points: Point[], minDist = 4): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1]!;
    const dx = points[i]!.x - last.x;
    const dy = points[i]!.y - last.y;
    if (dx * dx + dy * dy >= minDist * minDist) out.push(points[i]!);
  }
  return out;
}
