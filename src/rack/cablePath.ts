/**
 * Shared SVG path math for physical rack cables.
 *
 * The row canvas and export renderer both need the same bowed/overhead cable curves.
 * Keeping the curve in one pure helper prevents visual drift between live SVG, PNG/PDF,
 * and exported schedule diagrams.
 */

export interface CablePoint {
  x: number;
  y: number;
}

export interface CablePath {
  d: string;
  control: CablePoint;
  c1: CablePoint;
  c2: CablePoint;
}

const n = (v: number) => v.toFixed(1);
const r = (v: number) => Number(v.toFixed(2));
const point = (p: CablePoint): CablePoint => ({ x: r(p.x), y: r(p.y) });

export function cablePath(
  a: CablePoint,
  b: CablePoint,
  index: number,
  crossRack = false,
): CablePath {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const side = dx >= 0 ? 1 : -1;
  const lane = (index % 5) - 2;
  const reach = Math.max(34, Math.min(150, Math.abs(dx) * 0.38 + Math.abs(dy) * 0.18));
  const sag = 10 + (index % 4) * 5;

  const c1 = crossRack
    ? {
        x: a.x + side * Math.max(70, Math.abs(dx) * 0.32),
        y: Math.min(a.y, b.y) - 72 - (index % 5) * 14,
      }
    : {
        x: a.x + side * reach,
        y: a.y + dy * 0.16 + lane * 7,
      };

  const c2 = crossRack
    ? {
        x: b.x - side * Math.max(70, Math.abs(dx) * 0.32),
        y: Math.min(a.y, b.y) - 54 - (index % 5) * 11,
      }
    : {
        x: b.x - side * reach,
        y: b.y - dy * 0.16 + sag - lane * 5,
      };

  const control = {
    x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
    y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
  };

  return {
    control: point(control),
    c1: point(c1),
    c2: point(c2),
    d: `M ${n(a.x)} ${n(a.y)} C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(b.x)} ${n(b.y)}`,
  };
}
