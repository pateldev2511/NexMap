import { describe, it, expect } from 'vitest';
import { pointInPolygon, polylineIntersectsBox, segmentIntersectsBox, simplifyPath } from './geometry';

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

describe('segmentIntersectsBox', () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  it('hits a segment crossing the box with both ends outside', () => {
    expect(segmentIntersectsBox({ x: -100, y: 5 }, { x: 100, y: 5 }, box)).toBe(true);
    expect(segmentIntersectsBox({ x: 5, y: -100 }, { x: 5, y: 100 }, box)).toBe(true);
    expect(segmentIntersectsBox({ x: -10, y: -10 }, { x: 20, y: 20 }, box)).toBe(true);
  });
  it('hits a segment wholly inside, and one touching an edge or corner', () => {
    expect(segmentIntersectsBox({ x: 2, y: 2 }, { x: 3, y: 3 }, box)).toBe(true);
    expect(segmentIntersectsBox({ x: -5, y: 10 }, { x: 15, y: 10 }, box)).toBe(true);
    expect(segmentIntersectsBox({ x: -5, y: 5 }, { x: 5, y: 15 }, box)).toBe(true); // through (0,10)
  });
  it('misses a segment whose bounds overlap the box but whose line passes by', () => {
    // Diagonal past the top-right corner: bounding boxes overlap, the line does not.
    expect(segmentIntersectsBox({ x: 5, y: -10 }, { x: 25, y: 10 }, box)).toBe(false);
    expect(segmentIntersectsBox({ x: -100, y: 11 }, { x: 100, y: 11 }, box)).toBe(false);
    expect(segmentIntersectsBox({ x: 20, y: 0 }, { x: 30, y: 10 }, box)).toBe(false);
  });
  it('handles a zero-length segment as a point', () => {
    expect(segmentIntersectsBox({ x: 5, y: 5 }, { x: 5, y: 5 }, box)).toBe(true);
    expect(segmentIntersectsBox({ x: 50, y: 5 }, { x: 50, y: 5 }, box)).toBe(false);
  });
});

describe('polylineIntersectsBox', () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  it('hits when any leg crosses, and honors the pad', () => {
    // First leg runs above the box; the second drops straight through it.
    const detour = [
      { x: -50, y: -50 },
      { x: 5, y: -50 },
      { x: 5, y: 50 },
    ];
    expect(polylineIntersectsBox(detour, box)).toBe(true);
    const beside = [
      { x: -50, y: 14 },
      { x: 50, y: 14 },
    ];
    expect(polylineIntersectsBox(beside, box)).toBe(false);
    expect(polylineIntersectsBox(beside, box, 4)).toBe(true);
  });
});
