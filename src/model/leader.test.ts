import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEADER,
  leaderDashArray,
  leaderGeometry,
  resolveLeaderTarget,
  type LeaderRect,
} from './leader';

const box = (x: number, y: number, w = 40, h = 20): LeaderRect => ({ x, y, width: w, height: h });

describe('leaderGeometry — boundary exit points', () => {
  it('target to the right: leaves box right face, enters target left face', () => {
    const g = leaderGeometry(box(0, 0, 40, 20), box(200, 0, 40, 20))!;
    // box center (20,10) → right face x=40; target center (220,10) → left face x=200
    expect(g.x1).toBeCloseTo(40, 5);
    expect(g.y1).toBeCloseTo(10, 5);
    expect(g.x2).toBeCloseTo(200, 5);
    expect(g.y2).toBeCloseTo(10, 5);
  });

  it('target straight below: leaves bottom face, enters top face', () => {
    const g = leaderGeometry(box(0, 0, 40, 20), box(0, 200, 40, 20))!;
    expect(g.x1).toBeCloseTo(20, 5);
    expect(g.y1).toBeCloseTo(20, 5); // box bottom
    expect(g.x2).toBeCloseTo(20, 5);
    expect(g.y2).toBeCloseTo(200, 5); // target top
  });

  it('target up-and-left: exits through the correct quadrant faces', () => {
    // box centered (120,120); target centered (0,0) → direction (-1,-1)
    const g = leaderGeometry(box(100, 100, 40, 40), box(-20, -20, 40, 40))!;
    // 45° diagonal: exits the corner region — for a square, both faces at once
    expect(g.x1).toBeLessThan(120);
    expect(g.y1).toBeLessThan(120);
    expect(g.x2).toBeGreaterThan(0);
    expect(g.y2).toBeGreaterThan(0);
    // symmetric squares → endpoints mirror around the midpoint (60,60)
    expect((g.x1 + g.x2) / 2).toBeCloseTo(60, 5);
    expect((g.y1 + g.y2) / 2).toBeCloseTo(60, 5);
  });

  it('a point target (0×0) resolves the far endpoint to the exact point', () => {
    const g = leaderGeometry(box(0, 0, 40, 20), { x: 300, y: 10, width: 0, height: 0 })!;
    expect(g.x2).toBeCloseTo(300, 5);
    expect(g.y2).toBeCloseTo(10, 5);
  });

  it('concentric boxes are degenerate → null', () => {
    expect(leaderGeometry(box(0, 0, 40, 20), box(0, 0, 40, 20))).toBeNull();
  });
});

describe('resolveLeaderTarget', () => {
  const lookup = (id: string) => (id === 'd1' ? box(500, 500) : null);

  it('null anchor → no target', () => {
    expect(resolveLeaderTarget(null, lookup)).toBeNull();
    expect(resolveLeaderTarget(undefined, lookup)).toBeNull();
  });

  it('point anchor → a zero-size rect at the point', () => {
    expect(resolveLeaderTarget({ type: 'point', x: 12, y: 34 }, lookup)).toEqual({
      x: 12,
      y: 34,
      width: 0,
      height: 0,
    });
  });

  it('device anchor resolves via lookup; dangling id → null (lazy, no leader)', () => {
    expect(resolveLeaderTarget({ type: 'device', id: 'd1' }, lookup)).toEqual(box(500, 500));
    expect(resolveLeaderTarget({ type: 'device', id: 'gone' }, lookup)).toBeNull();
  });
});

describe('leaderDashArray', () => {
  it('solid has no dash array; dotted/dashed do', () => {
    expect(leaderDashArray({ ...DEFAULT_LEADER, dash: 'solid' })).toBeUndefined();
    expect(leaderDashArray({ ...DEFAULT_LEADER, dash: 'dotted' })).toBeTruthy();
    expect(leaderDashArray({ ...DEFAULT_LEADER, dash: 'dashed' })).toBeTruthy();
  });
});
