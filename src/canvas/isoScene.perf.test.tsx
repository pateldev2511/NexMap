/**
 * Perf pin (W1c): panning in ISO mode must not rebuild the grid every frame.
 *
 * IsoGrid used to receive a fresh `flat` box object built inline on every
 * render, so it regenerated all its <line>s per pan frame — a named cause of
 * the reported iso lag. It now takes quantized cell-edge bounds (primitives)
 * and is memoized, so a pan WITHIN a grid cell re-renders zero lines; only
 * crossing a cell boundary re-renders. IsoGrid bumps globalThis.__isoGridRenders
 * in test mode.
 *
 * (ResizeObserver is stubbed globally in src/test/setup.ts.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { Canvas } from './Canvas';
import { useProjectStore } from '@/store/projectStore';

// jsdom measures 0×0 and the canvas culls at size 0 — give it a viewport.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const renders = () => (globalThis as { __isoGridRenders?: number }).__isoGridRenders ?? 0;

describe('IsoGrid memoization (W1c)', () => {
  beforeEach(() => {
    (globalThis as { __isoGridRenders?: number }).__isoGridRenders = 0;
    s().newProject(NOW);
    s().addDeviceAt('router', 100, 100);
    s().addDeviceAt('switch', 400, 200);
    act(() => s().setProjection('iso'));
  });

  it('wheel-pans re-render the grid far less than once per frame', () => {
    const { container } = render(<Canvas />);
    expect(renders()).toBeGreaterThan(0); // grid rendered at least once

    const surface = container.querySelector('[data-canvas-surface]')!;
    const before = renders();
    // 30 small pan frames. Pre-fix this rebuilt the grid on every frame (~30);
    // quantized + memoized, it only re-renders when the pan crosses a cell
    // boundary — a large, stable reduction. (Not exactly 0: the iso
    // unprojection means 30px of pan crosses a few buckets.)
    for (let i = 0; i < 30; i++) {
      fireEvent.wheel(surface, { deltaX: 1, deltaY: 1, deltaMode: 0 });
    }
    expect(renders() - before).toBeLessThan(8);
  });

  it('a large pan that crosses cell boundaries DOES re-render (memo not stuck)', () => {
    const { container } = render(<Canvas />);
    const before = renders();
    const surface = container.querySelector('[data-canvas-surface]')!;
    // One big pan, several cells' worth — the quantized bounds must change.
    fireEvent.wheel(surface, { deltaX: 600, deltaY: 600, deltaMode: 0 });
    expect(renders()).toBeGreaterThan(before);
  });
});
