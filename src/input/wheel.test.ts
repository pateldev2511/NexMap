import { describe, it, expect } from 'vitest';
import {
  normalizeWheel,
  resolveWheel,
  MomentumGuard,
  MOMENTUM_QUIET_MS,
  ZOOM_DELTA_CAP,
  ZOOM_PER_PX,
  type WheelLike,
} from './wheel';
import { getWheelAction, setWheelAction } from '../lib/prefs';
import fixtures from './__fixtures__/wheel-synthetic.json';

const ev = (over: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe('normalizeWheel', () => {
  it('converts deltaMode LINE to ×16 px (the Firefox discrete-mouse case)', () => {
    const n = normalizeWheel(ev({ deltaY: 3, deltaMode: 1 }));
    expect(n.dy).toBe(48);
    expect(n.zoomDelta).toBe(48);
  });

  it('converts deltaMode PAGE to ×100 px', () => {
    expect(normalizeWheel(ev({ deltaY: 2, deltaMode: 2 })).dy).toBe(200);
  });

  it('clamps the ZOOM branch to ±120 px per event', () => {
    expect(normalizeWheel(ev({ deltaY: 300 })).zoomDelta).toBe(ZOOM_DELTA_CAP);
    expect(normalizeWheel(ev({ deltaY: -300 })).zoomDelta).toBe(-ZOOM_DELTA_CAP);
  });

  it('leaves the PAN branch unclamped (fast free-spin scrolling stays fast)', () => {
    expect(normalizeWheel(ev({ deltaY: 500 })).dy).toBe(500);
  });

  it('passes pinch-scale deltas through untouched below the cap', () => {
    const n = normalizeWheel(ev({ deltaY: -2.3, ctrlKey: true }));
    expect(n.zoomDelta).toBeCloseTo(-2.3);
    expect(n.ctrl).toBe(true);
  });

  it('classifies the synthetic per-device fixtures as labeled', () => {
    expect(fixtures.synthetic).toBe(true); // provenance rule: label never blurred
    for (const [name, seq] of Object.entries(fixtures.sequences)) {
      for (const e of seq.events) {
        expect(normalizeWheel(e as WheelLike).cls, name).toBe(seq.expectClass);
      }
    }
  });
});

describe('resolveWheel — the contract table', () => {
  it('ctrl/pinch zooms under BOTH prefs', () => {
    const n = normalizeWheel(ev({ deltaY: -120, ctrlKey: true }));
    expect(resolveWheel(n, 'pan').kind).toBe('zoom');
    expect(resolveWheel(n, 'zoom').kind).toBe('zoom');
  });

  it('one mouse notch zooms ≈×1.2', () => {
    const n = normalizeWheel(ev({ deltaY: -120, ctrlKey: true }));
    const r = resolveWheel(n, 'pan');
    if (r.kind !== 'zoom') throw new Error('expected zoom');
    expect(r.factor).toBeCloseTo(Math.pow(ZOOM_PER_PX, 120), 5);
    expect(r.factor).toBeGreaterThan(1.19);
    expect(r.factor).toBeLessThan(1.21);
  });

  it('shift+wheel pans horizontally under both prefs', () => {
    const n = normalizeWheel(ev({ deltaY: 90, shiftKey: true }));
    for (const pref of ['pan', 'zoom'] as const) {
      const r = resolveWheel(n, pref);
      expect(r).toEqual({ kind: 'pan', dx: 90, dy: 0 });
    }
  });

  it("plain wheel follows the pref: 'pan' pans (default contract), 'zoom' zooms", () => {
    const n = normalizeWheel(ev({ deltaX: -3, deltaY: 12 }));
    expect(resolveWheel(n, 'pan')).toEqual({ kind: 'pan', dx: -3, dy: 12 });
    expect(resolveWheel(n, 'zoom').kind).toBe('zoom');
  });
});

describe('MomentumGuard', () => {
  it('swallows same-direction inertial tail, releases on sign change', () => {
    const g = new MomentumGuard();
    g.block(1000);
    expect(g.shouldSwallow(14, 1010)).toBe(true);
    expect(g.shouldSwallow(9, 1040)).toBe(true);
    expect(g.shouldSwallow(-20, 1070)).toBe(false); // reversal = fresh intent
    expect(g.shouldSwallow(-20, 1080)).toBe(false); // and the guard stays off
  });

  it('releases after the quiet window with no events', () => {
    const g = new MomentumGuard();
    g.block(1000);
    expect(g.shouldSwallow(10, 1020)).toBe(true);
    expect(g.shouldSwallow(10, 1020 + MOMENTUM_QUIET_MS + 1)).toBe(false);
  });

  it('is inert until armed', () => {
    expect(new MomentumGuard().shouldSwallow(50, 0)).toBe(false);
  });
});

describe('prefs.wheelAction', () => {
  it("defaults to 'pan' and falls back to 'pan' on garbage stored values", () => {
    localStorage.removeItem('nexmap.wheelAction');
    expect(getWheelAction()).toBe('pan');
    localStorage.setItem('nexmap.wheelAction', 'bananas');
    expect(getWheelAction()).toBe('pan');
  });

  it('round-trips the explicit zoom opt-in', () => {
    setWheelAction('zoom');
    expect(getWheelAction()).toBe('zoom');
    setWheelAction('pan');
    expect(getWheelAction()).toBe('pan');
  });
});
