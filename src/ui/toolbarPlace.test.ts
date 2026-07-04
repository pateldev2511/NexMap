import { describe, it, expect } from 'vitest';
import { placeToolbar, TOOLBAR_GAP, TOOLBAR_INSET } from './toolbarPlace';

const TB = { width: 280, height: 36 };
const VP = { width: 1200, height: 800 };

describe('placeToolbar — flip then clamp', () => {
  it('prefers 8px above, horizontally centered', () => {
    const r = placeToolbar({ x: 500, y: 300, width: 100, height: 60 }, TB, VP);
    expect(r.slot).toBe('above');
    expect(r.top).toBe(300 - TOOLBAR_GAP - TB.height);
    expect(r.left).toBe(500 + 50 - TB.width / 2);
  });

  it('flips below when the selection hugs the top edge', () => {
    const r = placeToolbar({ x: 500, y: 10, width: 100, height: 60 }, TB, VP);
    expect(r.slot).toBe('below');
    expect(r.top).toBe(10 + 60 + TOOLBAR_GAP);
  });

  it('an info card above the selection sends the toolbar below first', () => {
    const r = placeToolbar({ x: 500, y: 300, width: 100, height: 60 }, TB, VP, true);
    expect(r.slot).toBe('below');
  });

  it('card-above falls back to above when below is clipped', () => {
    const r = placeToolbar({ x: 500, y: 700, width: 100, height: 80 }, TB, VP, true);
    expect(r.slot).toBe('above');
  });

  it('clamps horizontally at the viewport edges', () => {
    const left = placeToolbar({ x: -50, y: 300, width: 40, height: 40 }, TB, VP);
    expect(left.left).toBe(TOOLBAR_INSET);
    const right = placeToolbar({ x: 1180, y: 300, width: 40, height: 40 }, TB, VP);
    expect(right.left).toBe(VP.width - TB.width - TOOLBAR_INSET);
  });

  it('select-all at low zoom (bbox bigger than the viewport) clamps, pinned to the nearest edge', () => {
    const giant = { x: -200, y: -300, width: 1600, height: 1600 };
    const r = placeToolbar(giant, TB, VP);
    expect(r.slot).toBe('clamped');
    // Centroid (500) is above the viewport midline (400)? No — 500 > 400,
    // so it pins to the bottom edge.
    expect(r.top).toBe(VP.height - TB.height - TOOLBAR_INSET);
    const giantTop = { x: -200, y: -1000, width: 1600, height: 2600 };
    const rt = placeToolbar(giantTop, TB, VP);
    expect(rt.slot).toBe('clamped');
    expect(rt.top).toBe(TOOLBAR_INSET); // centroid above the midline → top pin
  });
});
