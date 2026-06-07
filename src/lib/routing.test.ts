import { describe, it, expect } from 'vitest';
import { avoidRoute, simplify, type Rect } from './routing';

describe('avoidRoute', () => {
  it('returns a direct (2-point) route when nothing is in the way', () => {
    const route = avoidRoute({ x: 0, y: 0 }, { x: 200, y: 0 }, [], { cell: 14 });
    expect(route).not.toBeNull();
    expect(route!.length).toBe(2);
    // Endpoints snap to the grid, within one cell of the inputs.
    expect(Math.abs(route![0]!.x - 0)).toBeLessThanOrEqual(14);
    expect(Math.abs(route![route!.length - 1]!.x - 200)).toBeLessThanOrEqual(14);
  });

  it('routes around an obstacle on the straight line', () => {
    // Wall blocking the direct horizontal path between the two points.
    const wall: Rect = { x: 90, y: -60, width: 20, height: 120 };
    const route = avoidRoute({ x: 0, y: 0 }, { x: 200, y: 0 }, [wall]);
    expect(route).not.toBeNull();
    // It must bend (more than 2 points) and clear the wall's x-span vertically.
    expect(route!.length).toBeGreaterThan(2);
    const clearsWall = route!.some((p) => Math.abs(p.y) > 60 - 1e-9 || p.x < 90 || p.x > 110);
    expect(clearsWall).toBe(true);
  });

  it('lands endpoints within a cell of the inputs', () => {
    const cell = 14;
    const route = avoidRoute(
      { x: 5, y: 7 },
      { x: 305, y: 207 },
      [{ x: 140, y: 80, width: 40, height: 40 }],
      { cell },
    )!;
    expect(Math.hypot(route[0]!.x - 5, route[0]!.y - 7)).toBeLessThanOrEqual(cell * 1.5);
    const last = route[route.length - 1]!;
    expect(Math.hypot(last.x - 305, last.y - 207)).toBeLessThanOrEqual(cell * 1.5);
  });

  it('returns null when the region exceeds the cell budget', () => {
    const route = avoidRoute({ x: 0, y: 0 }, { x: 100000, y: 100000 }, [], {
      maxCells: 5000,
    });
    expect(route).toBeNull();
  });

  it('produces only right-angle segments', () => {
    const route = avoidRoute({ x: 0, y: 0 }, { x: 240, y: 0 }, [
      { x: 100, y: -50, width: 30, height: 100 },
    ])!;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!;
      const b = route[i]!;
      const axis = a.x === b.x || a.y === b.y;
      expect(axis).toBe(true); // each segment is horizontal or vertical
    }
  });
});

describe('simplify', () => {
  it('merges collinear interior points', () => {
    const out = simplify([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]);
  });
});
