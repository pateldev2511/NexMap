import { describe, it, expect } from 'vitest';
import { portAt, portCenter, type PortTarget } from './portHit';

const p = (over: Partial<PortTarget>): PortTarget => ({ deviceId: 'd', ifaceId: 'i', x: 0, y: 0, w: 10, h: 10, ...over });

describe('portCenter', () => {
  it('returns the rect center', () => {
    expect(portCenter(p({ x: 10, y: 20, w: 8, h: 4 }))).toEqual({ x: 14, y: 22 });
  });
});

describe('portAt', () => {
  const ports = [
    p({ ifaceId: 'a', x: 0, y: 0, w: 10, h: 10 }),
    p({ ifaceId: 'b', x: 100, y: 0, w: 10, h: 10 }),
  ];

  it('hits a port inside its rect', () => {
    expect(portAt(ports, 5, 5)?.ifaceId).toBe('a');
    expect(portAt(ports, 105, 5)?.ifaceId).toBe('b');
  });

  it('hits within the pad margin', () => {
    expect(portAt(ports, -2, 5)?.ifaceId).toBe('a'); // 2px left of rect, within pad=3
  });

  it('misses when outside the padded rect', () => {
    expect(portAt(ports, 50, 50)).toBeNull();
    expect(portAt(ports, -10, 5)).toBeNull(); // beyond pad
  });

  it('resolves to the nearest center when padded rects overlap', () => {
    const dense = [p({ ifaceId: 'L', x: 0, y: 0, w: 10, h: 10 }), p({ ifaceId: 'R', x: 11, y: 0, w: 10, h: 10 })];
    // x=11 is inside R and within pad of L; center of R (16) is closer than center of L (5).
    expect(portAt(dense, 13, 5)?.ifaceId).toBe('R');
  });

  it('empty port list → null', () => {
    expect(portAt([], 5, 5)).toBeNull();
  });
});
