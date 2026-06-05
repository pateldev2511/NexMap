import { describe, it, expect } from 'vitest';
import {
  screenToCanvas,
  canvasToScreen,
  zoomAt,
  pan,
  snap,
  visibleBox,
  clampScale,
  fitToBox,
  initialViewport,
  MAX_SCALE,
  MIN_SCALE,
} from './viewport';

describe('viewport transforms', () => {
  it('screen<->canvas round-trips', () => {
    const v = { tx: 30, ty: -10, scale: 2 };
    const screen = canvasToScreen(v, 100, 50);
    const canvas = screenToCanvas(v, screen.x, screen.y);
    expect(canvas.x).toBeCloseTo(100);
    expect(canvas.y).toBeCloseTo(50);
  });

  it('pan moves the translation opposite the drag', () => {
    const v = pan(initialViewport, 20, 5);
    expect(v.tx).toBe(-20);
    expect(v.ty).toBe(-5);
  });

  it('zoomAt keeps the cursor-anchored canvas point fixed', () => {
    const v = initialViewport;
    const before = screenToCanvas(v, 200, 150);
    const zoomed = zoomAt(v, 2, 200, 150);
    const after = screenToCanvas(zoomed, 200, 150);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomed.scale).toBe(2);
  });

  it('clampScale respects bounds', () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0.0001)).toBe(MIN_SCALE);
  });

  it('zoomAt does not exceed bounds', () => {
    let v = initialViewport;
    for (let i = 0; i < 50; i++) v = zoomAt(v, 2, 0, 0);
    expect(v.scale).toBe(MAX_SCALE);
  });

  it('visibleBox reflects pan and zoom', () => {
    const box = visibleBox({ tx: 0, ty: 0, scale: 1 }, 800, 600);
    expect(box).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    const zoomed = visibleBox({ tx: 0, ty: 0, scale: 2 }, 800, 600);
    expect(zoomed.width).toBe(400);
  });

  it('snap rounds to grid unless suspended', () => {
    expect(snap(10, false)).toBe(16);
    expect(snap(7, false)).toBe(0);
    expect(snap(10, true)).toBe(10);
  });

  it('fitToBox centers content', () => {
    const v = fitToBox({ x: 0, y: 0, width: 400, height: 300 }, 800, 600);
    const center = canvasToScreen(v, 200, 150);
    expect(center.x).toBeCloseTo(400);
    expect(center.y).toBeCloseTo(300);
  });

  it('fitToBox handles empty content', () => {
    expect(fitToBox({ x: 0, y: 0, width: 0, height: 0 }, 800, 600)).toEqual(
      initialViewport,
    );
  });
});
