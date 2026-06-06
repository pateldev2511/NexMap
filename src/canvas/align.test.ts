import { describe, it, expect } from 'vitest';
import { computeAlignSnap, computeSpacingSnap } from './align';

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

describe('computeSpacingSnap', () => {
  // Two statics at x=0..10 and x=30..40 → gap of 20. A third box dragged to ~57
  // should snap to 60 (40 + gap 20), continuing the sequence.
  it('extends an equal gap to the outside of a sequence (x axis)', () => {
    const r = computeSpacingSnap(
      { x: 57, y: 0, width: 10, height: 10 },
      [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 30, y: 0, width: 10, height: 10 },
      ],
      4,
    );
    expect(r.adjX).toBe(3); // 60 - 57
  });

  it('extends before the first box too', () => {
    // gap 20; before-left target lo = 0 - 20 - 10 = -30. Drag near -28 → snap to -30.
    const r = computeSpacingSnap(
      { x: -28, y: 0, width: 10, height: 10 },
      [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 30, y: 0, width: 10, height: 10 },
      ],
      4,
    );
    expect(r.adjX).toBe(-2);
  });

  it('centers a box between two flanking statics (equal gaps)', () => {
    // left 0..10, right 90..100, moving width 10 → equalGap = (90-10-10)/2 = 35 → lo 45.
    const r = computeSpacingSnap(
      { x: 47, y: 0, width: 10, height: 10 },
      [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 90, y: 0, width: 10, height: 10 },
      ],
      4,
    );
    expect(r.adjX).toBe(-2); // 45 - 47
  });

  it('snaps the y axis the same way', () => {
    const r = computeSpacingSnap(
      { x: 0, y: 57, width: 10, height: 10 },
      [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 0, y: 30, width: 10, height: 10 },
      ],
      4,
    );
    expect(r.adjY).toBe(3);
  });

  it('returns null when nothing is within threshold', () => {
    const r = computeSpacingSnap(
      { x: 100, y: 0, width: 10, height: 10 },
      [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 30, y: 0, width: 10, height: 10 },
      ],
      4,
    );
    expect(r.adjX).toBeNull();
  });

  it('needs at least two reference boxes', () => {
    const r = computeSpacingSnap(
      { x: 57, y: 0, width: 10, height: 10 },
      [{ x: 0, y: 0, width: 10, height: 10 }],
      4,
    );
    expect(r.adjX).toBeNull();
    expect(r.adjY).toBeNull();
  });
});
