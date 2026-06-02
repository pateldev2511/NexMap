import { describe, it, expect } from 'vitest';
import { SpatialIndex, boxesIntersect, pointInBox } from './spatial-index';

const box = (x: number, y: number, w = 50, h = 30) => ({ x, y, width: w, height: h });

describe('SpatialIndex', () => {
  it('inserts and hit-tests points', () => {
    const idx = new SpatialIndex();
    idx.insert('a', box(0, 0));
    idx.insert('b', box(200, 200));
    expect(idx.hit(10, 10)).toEqual(['a']);
    expect(idx.hit(210, 210)).toEqual(['b']);
    expect(idx.hit(1000, 1000)).toEqual([]);
  });

  it('queries an intersecting region', () => {
    const idx = new SpatialIndex();
    idx.insert('a', box(0, 0));
    idx.insert('b', box(60, 0));
    idx.insert('c', box(500, 500));
    const hits = idx.query(box(-10, -10, 200, 200)).sort();
    expect(hits).toEqual(['a', 'b']);
  });

  it('updates an entry across cell boundaries', () => {
    const idx = new SpatialIndex(64);
    idx.insert('a', box(0, 0));
    expect(idx.hit(10, 10)).toEqual(['a']);
    idx.update('a', box(500, 500));
    expect(idx.hit(10, 10)).toEqual([]);
    expect(idx.hit(510, 510)).toEqual(['a']);
  });

  it('removes entries and cleans up empty cells', () => {
    const idx = new SpatialIndex();
    idx.insert('a', box(0, 0));
    idx.remove('a');
    expect(idx.hit(10, 10)).toEqual([]);
    expect(idx.size).toBe(0);
  });

  it('insert on existing id updates instead of duplicating', () => {
    const idx = new SpatialIndex();
    idx.insert('a', box(0, 0));
    idx.insert('a', box(300, 300));
    expect(idx.size).toBe(1);
    expect(idx.hit(10, 10)).toEqual([]);
    expect(idx.hit(310, 310)).toEqual(['a']);
  });

  it('handles entries spanning multiple cells without double-counting', () => {
    const idx = new SpatialIndex(32);
    idx.insert('big', box(0, 0, 200, 200)); // spans many cells
    const hits = idx.query(box(0, 0, 200, 200));
    expect(hits).toEqual(['big']);
  });

  // Property: a freshly inserted box is always hit at its own center.
  it('property: every inserted box is hit at its center', () => {
    const idx = new SpatialIndex();
    const rng = (n: number) => ((n * 1103515245 + 12345) >>> 0) % 2000;
    for (let i = 0; i < 300; i++) {
      const b = box(rng(i), rng(i + 7), 40, 24);
      idx.insert(`n${i}`, b);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      expect(idx.hit(cx, cy)).toContain(`n${i}`);
    }
  });
});

describe('geometry helpers', () => {
  it('boxesIntersect', () => {
    expect(boxesIntersect(box(0, 0), box(10, 10))).toBe(true);
    expect(boxesIntersect(box(0, 0), box(100, 100))).toBe(false);
  });
  it('pointInBox', () => {
    expect(pointInBox(5, 5, box(0, 0))).toBe(true);
    expect(pointInBox(100, 5, box(0, 0))).toBe(false);
  });
});
