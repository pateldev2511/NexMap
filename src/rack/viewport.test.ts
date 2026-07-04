import { describe, it, expect } from 'vitest';
import { zoomAt, panBy, zoomTo, fit, toWorld, IDENTITY, MIN_SCALE, MAX_SCALE } from './viewport';

describe('zoomAt — cursor stays pinned', () => {
  it('keeps the world point under the cursor fixed when zooming', () => {
    const vp = { scale: 1, tx: 50, ty: 20 };
    const before = toWorld(vp, 200, 150);
    const after = zoomAt(vp, 1.5, 200, 150);
    const afterWorld = toWorld(after, 200, 150);
    expect(afterWorld.x).toBeCloseTo(before.x, 6);
    expect(afterWorld.y).toBeCloseTo(before.y, 6);
    expect(after.scale).toBeCloseTo(1.5, 6);
  });

  it('clamps scale to [MIN, MAX] and adjusts translate by the effective factor', () => {
    expect(zoomAt(IDENTITY, 100, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt(IDENTITY, 0.001, 0, 0).scale).toBe(MIN_SCALE);
  });

  it('floor matches the flat canvas (0.1) — one zoom range app-wide', () => {
    expect(MIN_SCALE).toBe(0.1);
  });
});

describe('panBy', () => {
  it('shifts translate, leaves scale', () => {
    expect(panBy({ scale: 2, tx: 10, ty: 5 }, 7, -3)).toEqual({ scale: 2, tx: 17, ty: 2 });
  });
});

describe('zoomTo — centered explicit zoom', () => {
  it('reaches the requested scale', () => {
    expect(zoomTo(IDENTITY, 2, 800, 600).scale).toBeCloseTo(2, 6);
  });
});

describe('fit', () => {
  it('scales content to fit with padding, centered, never above 1', () => {
    const vp = fit(1000, 500, 800, 600, 20);
    expect(vp.scale).toBeCloseTo((800 - 40) / 1000, 6); // width-constrained
    expect(vp.tx).toBeCloseTo((800 - 1000 * vp.scale) / 2, 6);
  });
  it('does not upscale a small rack', () => {
    expect(fit(100, 100, 800, 600).scale).toBe(1);
  });
  it('returns identity for degenerate sizes', () => {
    expect(fit(0, 0, 800, 600)).toEqual(IDENTITY);
  });
});
