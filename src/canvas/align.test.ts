import { describe, it, expect } from 'vitest';
import { computeAlignSnap } from './align';

describe('computeAlignSnap', () => {
  it('snaps a moving right edge onto a nearby static left edge', () => {
    const r = computeAlignSnap(
      { x: 0, y: 0, width: 10, height: 10 },
      [{ x: 12, y: 100, width: 10, height: 10 }],
      3,
    );
    expect(r.adjX).toBe(2); // 12 - 10
    expect(r.adjY).toBeNull();
    expect(r.guides.some((g) => g.axis === 'x' && g.pos === 12)).toBe(true);
  });

  it('reports no snap when every edge is beyond threshold', () => {
    const r = computeAlignSnap(
      { x: 0, y: 0, width: 10, height: 10 },
      [{ x: 40, y: 40, width: 10, height: 10 }],
      3,
    );
    expect(r.adjX).toBeNull();
    expect(r.adjY).toBeNull();
    expect(r.guides).toHaveLength(0);
  });

  it('snaps centers and both axes independently', () => {
    // moving center (5,5); static center (5,5) exactly → adj 0 on both.
    const r = computeAlignSnap(
      { x: 0, y: 0, width: 10, height: 10 },
      [{ x: 0, y: 0, width: 10, height: 10 }],
      3,
    );
    expect(r.adjX).toBe(0);
    expect(r.adjY).toBe(0);
    expect(r.guides).toHaveLength(2);
  });

  it('picks the closest of several candidate edges', () => {
    const r = computeAlignSnap(
      { x: 0, y: 0, width: 10, height: 10 },
      [
        { x: 13, y: 100, width: 10, height: 10 }, // left edge 13 → moving right 10 → d 3
        { x: 11, y: 100, width: 10, height: 10 }, // left edge 11 → moving right 10 → d 1 (closer)
      ],
      4,
    );
    expect(r.adjX).toBe(1);
  });

  it('returns nothing with no static boxes', () => {
    const r = computeAlignSnap({ x: 0, y: 0, width: 10, height: 10 }, [], 5);
    expect(r.adjX).toBeNull();
    expect(r.adjY).toBeNull();
  });
});
