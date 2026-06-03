import { describe, it, expect } from 'vitest';
import { pointInPolygon, simplifyPath } from './geometry';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('pointInPolygon', () => {
  it('detects inside and outside', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
  });
  it('returns false for degenerate polygons', () => {
    expect(pointInPolygon(0, 0, [{ x: 0, y: 0 }])).toBe(false);
  });
  it('handles a concave polygon (right-pointing arrow with a left notch)', () => {
    const arrow = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 10 },
      { x: 3, y: 5 },
    ];
    expect(pointInPolygon(6, 5, arrow)).toBe(true); // inside the body
    expect(pointInPolygon(1, 5, arrow)).toBe(false); // in the notch (left of x=3)
    expect(pointInPolygon(20, 5, arrow)).toBe(false); // outside
  });
});

describe('simplifyPath', () => {
  it('drops near-duplicate points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 }, // within minDist 4 → dropped
      { x: 10, y: 0 },
    ];
    expect(simplifyPath(pts, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });
});
