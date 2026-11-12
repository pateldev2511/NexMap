import { describe, it, expect } from 'vitest';
import { MAX_ENTRY_CELLS, SpatialIndex, boxesIntersect, pointInBox } from './spatial-index';

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

  it('does not blow up on a pathologically huge query box', () => {
    const idx = new SpatialIndex();
    idx.insert('a', box(0, 0));
    idx.insert('b', box(1000, 1000));
    // A box spanning millions of cells must still resolve via the entry-scan guard.
    const hits = idx.query({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 }).sort();
    expect(hits).toEqual(['a', 'b']);
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

describe('SpatialIndex — oversized entries (#78)', () => {
  it('never materialises more than MAX_ENTRY_CELLS cells for one entry', () => {
    const idx = new SpatialIndex();
    // 157 x 157 cells: cheap enough to index naively, so this fails fast on the old code.
    idx.insert('zone', { x: 0, y: 0, width: 20_000, height: 20_000 });
    expect(idx.cellCount).toBeLessThanOrEqual(MAX_ENTRY_CELLS);
    expect(idx.cellCount).toBe(0);
    expect(idx.hit(10_000, 10_000)).toEqual(['zone']);
  });

  it('inserts a 1e9-sized box promptly and still finds it', () => {
    const idx = new SpatialIndex();
    idx.insert('small', box(0, 0));
    const t0 = performance.now();
    idx.insert('huge', { x: -10, y: -10, width: 1e9, height: 1e9 });
    expect(performance.now() - t0).toBeLessThan(250);
    expect(idx.size).toBe(2);
    expect(idx.cellCount).toBeLessThan(10);
    expect(idx.query(box(5000, 5000)).sort()).toEqual(['huge']);
    expect(idx.query(box(0, 0)).sort()).toEqual(['huge', 'small']);
    expect(idx.hit(123_456, 654_321)).toEqual(['huge']);
    expect(idx.hit(-500, -500)).toEqual([]);
  });

  it('finds an oversized entry on the cell-walk path too (many entries, small query)', () => {
    const idx = new SpatialIndex();
    for (let i = 0; i < 50; i++) idx.insert(`n${i}`, box(i * 300, 0));
    idx.insert('huge', { x: 0, y: 0, width: 1e9, height: 1e9 });
    expect(idx.query(box(40_000, 40_000, 10, 10))).toEqual(['huge']);
    expect(idx.query(box(0, 0, 10, 10)).sort()).toEqual(['huge', 'n0']);
  });

  it('re-indexes when updated back to a small box, and oversizes on growth', () => {
    const idx = new SpatialIndex();
    for (let i = 0; i < 20; i++) idx.insert(`n${i}`, box(5000 + i * 300, 5000));
    idx.insert('a', { x: 0, y: 0, width: 1e9, height: 1e9 });
    idx.update('a', box(0, 0));
    expect(idx.hit(10, 10)).toEqual(['a']);
    expect(idx.hit(9000, 9000)).toEqual([]);
    expect(idx.query(box(0, 0, 10, 10))).toEqual(['a']);
    const cells = idx.cellCount;
    idx.update('a', { x: 0, y: 0, width: 1e9, height: 1e9 });
    expect(idx.cellCount).toBeLessThan(cells);
    expect(idx.hit(9000, 9000)).toEqual(['a']);
    // Same-size update while oversized keeps it findable at the new place.
    idx.update('a', { x: 1e6, y: 1e6, width: 1e9, height: 1e9 });
    expect(idx.hit(9000, 9000)).toEqual([]);
    expect(idx.hit(2e6, 2e6)).toEqual(['a']);
  });

  it('removes and clears oversized entries', () => {
    const idx = new SpatialIndex();
    idx.insert('a', { x: 0, y: 0, width: 1e9, height: 1e9 });
    idx.insert('b', { x: 0, y: 0, width: 1e9, height: 1e9 });
    idx.remove('a');
    expect(idx.hit(10, 10)).toEqual(['b']);
    idx.clear();
    expect(idx.size).toBe(0);
    for (let i = 0; i < 20; i++) idx.insert(`n${i}`, box(i * 300, 0));
    expect(idx.query(box(0, 0, 10, 10))).toEqual(['n0']);
  });

  it('does not throw on a NaN or infinite box, and can recover it', () => {
    const idx = new SpatialIndex();
    expect(() => idx.insert('nan', { x: NaN, y: 0, width: NaN, height: 10 })).not.toThrow();
    expect(() => idx.insert('inf', { x: 0, y: 0, width: Infinity, height: 10 })).not.toThrow();
    expect(() => idx.query(box(0, 0))).not.toThrow();
    expect(() => idx.hit(1, 1)).not.toThrow();
    expect(idx.query(box(0, 0))).not.toContain('nan');
    idx.update('nan', box(0, 0));
    expect(idx.hit(10, 10)).toContain('nan');
    idx.remove('nan');
    idx.remove('inf');
    expect(idx.size).toBe(0);
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
