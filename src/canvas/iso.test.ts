import { describe, it, expect } from 'vitest';
import {
  isoProject,
  isoUnproject,
  isoDepth,
  isoProjectPx,
  isoUnprojectPx,
  DEFAULT_TILE,
} from './iso';

describe('isoProject', () => {
  it('maps the origin to the origin', () => {
    expect(isoProject(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('maps +gx to the lower-right and +gy to the lower-left', () => {
    const right = isoProject(1, 0);
    const left = isoProject(0, 1);
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(0);
    expect(left.y).toBeGreaterThan(0);
    // Symmetric about the vertical axis.
    expect(right.x).toBe(-left.x);
    expect(right.y).toBe(left.y);
  });

  it('uses a 2:1 ratio with the default tile', () => {
    expect(DEFAULT_TILE.w).toBe(2 * DEFAULT_TILE.h);
    const p = isoProject(2, 0);
    // Pure +gx moves twice as far horizontally as vertically (2:1).
    expect(Math.abs(p.x)).toBe(2 * Math.abs(p.y));
  });
});

describe('isoUnproject round-trip', () => {
  const cases: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [3, 7],
    [-5, 2],
    [12.5, -4.25],
  ];
  for (const [gx, gy] of cases) {
    it(`recovers (${gx}, ${gy})`, () => {
      const p = isoProject(gx, gy);
      const back = isoUnproject(p.x, p.y);
      expect(back.gx).toBeCloseTo(gx, 9);
      expect(back.gy).toBeCloseTo(gy, 9);
    });
  }

  it('honors a custom tile size', () => {
    const tile = { w: 100, h: 40 };
    const p = isoProject(4, -2, tile);
    const back = isoUnproject(p.x, p.y, tile);
    expect(back.gx).toBeCloseTo(4, 9);
    expect(back.gy).toBeCloseTo(-2, 9);
  });
});

describe('isoDepth', () => {
  it('orders nearer tiles (larger gx+gy) after farther ones', () => {
    expect(isoDepth(0, 0)).toBeLessThan(isoDepth(1, 1));
    expect(isoDepth(2, 3)).toBe(5);
  });
});

describe('pixel helpers', () => {
  it('round-trips flat pixel coordinates through the grid', () => {
    const grid = 16;
    const p = isoProjectPx(160, 80, grid); // grid (10, 5)
    const back = isoUnprojectPx(p.x, p.y, grid);
    expect(back.x).toBeCloseTo(160, 6);
    expect(back.y).toBeCloseTo(80, 6);
  });
});
