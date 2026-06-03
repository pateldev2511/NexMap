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
