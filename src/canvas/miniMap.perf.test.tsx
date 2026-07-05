/**
 * M4f perf pin: panning the flat canvas must NOT re-render the MiniMap's
 * device-dot layer.
 *
 * Every pan frame hands MiniMap a fresh viewRect. As long as the viewport
 * stays inside the scene's device bounds, the fitted projection (k/offX/offY)
 * and the rev-memoized devices array are identical — so the memoized MiniDots
 * layer (N rects) must skip. Only a model change or a viewport that drags the
 * fitted bounds outward may re-render it. MiniDots bumps
 * globalThis.__miniDotsRenders in test mode.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MiniMap } from './MiniMap';
import { useProjectStore } from '@/store/projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const renders = () => (globalThis as { __miniDotsRenders?: number }).__miniDotsRenders ?? 0;

describe('MiniDots memoization (M4f)', () => {
  beforeEach(() => {
    (globalThis as { __miniDotsRenders?: number }).__miniDotsRenders = 0;
    s().newProject(NOW);
    // A spread-out scene so a small viewport fits INSIDE the device bounds.
    s().addDeviceAt('router', 0, 0);
    s().addDeviceAt('switch', 900, 700);
    s().addDeviceAt('server', 400, 300);
  });

  it('viewRect-only changes inside the scene bounds do not re-render the dots', () => {
    const view = render(
      <MiniMap viewRect={{ x: 300, y: 250, width: 200, height: 150 }} onJump={() => {}} />,
    );
    expect(renders()).toBeGreaterThan(0);
    const before = renders();

    // 30 simulated pan frames, all inside the device bounds.
    for (let i = 1; i <= 30; i++) {
      view.rerender(
        <MiniMap viewRect={{ x: 300 + i, y: 250 + i, width: 200, height: 150 }} onJump={() => {}} />,
      );
    }
    expect(renders()).toBe(before);
  });

  it('a model change DOES re-render the dots (memo is not stuck)', () => {
    const view = render(
      <MiniMap viewRect={{ x: 300, y: 250, width: 200, height: 150 }} onJump={() => {}} />,
    );
    const before = renders();
    act(() => void s().addDeviceAt('firewall', 600, 500)); // store rev bumps → MiniMap re-renders itself
    view.rerender(
      <MiniMap viewRect={{ x: 300, y: 250, width: 200, height: 150 }} onJump={() => {}} />,
    );
    expect(renders()).toBeGreaterThan(before);
  });

  it('a viewport dragged OUTSIDE the bounds re-fits the projection (dots move)', () => {
    const view = render(
      <MiniMap viewRect={{ x: 300, y: 250, width: 200, height: 150 }} onJump={() => {}} />,
    );
    const before = renders();
    view.rerender(
      <MiniMap viewRect={{ x: -2000, y: -1500, width: 200, height: 150 }} onJump={() => {}} />,
    );
    expect(renders()).toBeGreaterThan(before); // scale really changed — must redraw
  });
});
