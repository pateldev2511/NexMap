/**
 * Port hit-testing for drag-to-cable (Milestone D). Ports are small jack rects drawn inside
 * each device. To pull a cable, a pointerdown must resolve to a port BEFORE the device body
 * (the gesture-arbiter priority: port > device > bay > empty). Kept pure so the geometry is
 * unit-tested without a DOM; coordinates are the canvas's SVG user space.
 */
export interface PortTarget {
  deviceId: string;
  ifaceId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Extra pixels around a jack rect that still count as a hit (jacks are tiny). */
export const PORT_HIT_PAD = 3;

/** Center of a port rect (cable endpoints anchor here). */
export function portCenter(p: PortTarget): { x: number; y: number } {
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
}

/**
 * The port whose padded rect contains (x, y), or null. When rects overlap, the nearest
 * center wins so dense jack rows resolve to the intended port.
 */
export function portAt(ports: PortTarget[], x: number, y: number, pad = PORT_HIT_PAD): PortTarget | null {
  let best: PortTarget | null = null;
  let bestDist = Infinity;
  for (const p of ports) {
    if (x >= p.x - pad && x <= p.x + p.w + pad && y >= p.y - pad && y <= p.y + p.h + pad) {
      const c = portCenter(p);
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
  }
  return best;
}
