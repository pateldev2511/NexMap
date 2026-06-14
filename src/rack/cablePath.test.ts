import { describe, expect, it } from 'vitest';
import { cablePath } from './cablePath';

describe('cablePath', () => {
  it('bows intra-rack cables with stable precision', () => {
    expect(cablePath({ x: 10, y: 20 }, { x: 50, y: 60 }, 0, false)).toEqual({
      control: { x: 30, y: 42.25 },
      c1: { x: 44, y: 12.4 },
      c2: { x: 16, y: 73.6 },
      d: 'M 10.0 20.0 C 44.0 12.4 16.0 73.6 50.0 60.0',
    });
  });

  it('routes cross-rack cables overhead', () => {
    const p = cablePath({ x: 100, y: 80 }, { x: 260, y: 90 }, 2, true);
    expect(p.control).toEqual({ x: 180, y: 15.25 });
    expect(p.c1).toEqual({ x: 170, y: -20 });
    expect(p.c2).toEqual({ x: 190, y: 4 });
    expect(p.d).toBe('M 100.0 80.0 C 170.0 -20.0 190.0 4.0 260.0 90.0');
  });
});
