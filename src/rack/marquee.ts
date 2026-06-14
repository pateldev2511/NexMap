/**
 * Pure geometry for rubber-band (marquee) selection on the rack canvas. Kept separate from
 * the React component so the hit-testing is unit-tested without a DOM. All coordinates are
 * in the canvas's SVG user space.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixels the pointer must travel before a press becomes a marquee (vs a plain click). */
export const MARQUEE_THRESHOLD = 6;

/** Build a normalized (non-negative w/h) box from two corner points. */
export function normalizeRect(sx: number, sy: number, ex: number, ey: number): Box {
  return {
    x: Math.min(sx, ex),
    y: Math.min(sy, ey),
    w: Math.abs(ex - sx),
    h: Math.abs(ey - sy),
  };
}

/** Axis-aligned overlap test (touching edges do NOT count as intersecting). */
export function rectsIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Ids of devices whose rect overlaps the marquee box, in input order. */
export function devicesInMarquee(rects: { id: string; box: Box }[], marquee: Box): string[] {
  // A zero-area marquee (no real drag) selects nothing.
  if (marquee.w <= 0 || marquee.h <= 0) return [];
  return rects.filter((r) => rectsIntersect(r.box, marquee)).map((r) => r.id);
}
