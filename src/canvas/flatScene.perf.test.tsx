/**
 * Perf pin (review 2026-07-05): pan/zoom-PAN frames on the FLAT canvas must
 * not re-render the device nodes.
 *
 * The nodes live under a transform group, so a pan only changes the parent
 * transform — but that guarantee held only as long as every prop kept
 * identity. The regression this pins: toFlat depended on [viewport], so each
 * pan frame minted a new startLinkFrom → onDevicePointerDown → every node's
 * onPointerDown prop, and React.memo re-rendered all N devices per frame.
 * toFlat now reads viewport+projection through refs (identity-stable).
 * DeviceNode bumps globalThis.__deviceNodeRenders in test mode.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { Canvas } from './Canvas';
import { useProjectStore } from '@/store/projectStore';

// (ResizeObserver is stubbed globally in src/test/setup.ts.)
// jsdom elements measure 0×0, and the canvas culls everything at size 0 —
// give every element a viewport-sized box so devices are visible.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const renders = () => (globalThis as { __deviceNodeRenders?: number }).__deviceNodeRenders ?? 0;

describe('flat canvas node memoization', () => {
  beforeEach(() => {
    (globalThis as { __deviceNodeRenders?: number }).__deviceNodeRenders = 0;
    s().newProject(NOW);
    s().addDeviceAt('router', 100, 100);
    s().addDeviceAt('switch', 400, 200);
    s().addDeviceAt('server', 250, 450);
  });

  it('wheel-pan frames move the viewport WITHOUT re-rendering device nodes', () => {
    const { container } = render(<Canvas />);
    expect(renders()).toBeGreaterThan(0); // nodes rendered at least once

    const surface = container.querySelector('[data-canvas-surface]') ?? container.firstElementChild!;
    const group = container.querySelector('g[transform]')!;
    const before = renders();
    const tfBefore = group.getAttribute('transform');

    for (let i = 0; i < 30; i++) {
      fireEvent.wheel(surface, { deltaX: 4, deltaY: 6, deltaMode: 0 });
    }
    // The pan really happened (not a vacuous pass)…
    expect(container.querySelector('g[transform]')!.getAttribute('transform')).not.toBe(tfBefore);
    // …and no device node re-rendered for it.
    expect(renders()).toBe(before);
  });

  it('a model change DOES re-render nodes (memo is not stuck)', () => {
    render(<Canvas />);
    const before = renders();
    // Store change → rev bump → Canvas re-renders with a fresh devices array.
    act(() => void s().addDeviceAt('firewall', 500, 500));
    expect(renders()).toBeGreaterThan(before);
  });
});

const linkRenders = () =>
  (globalThis as { __linkLayerRenders?: number }).__linkLayerRenders ?? 0;

describe('flat canvas LinkLayer memoization (W1c)', () => {
  beforeEach(() => {
    (globalThis as { __linkLayerRenders?: number }).__linkLayerRenders = 0;
    s().newProject(NOW);
    const a = s().addDeviceAt('router', 100, 100);
    const b = s().addDeviceAt('switch', 400, 200);
    s().connect(a, b); // a visible link so LinkLayer has work
  });

  it('wheel-pan frames do NOT re-render the link layer', () => {
    const { container } = render(<Canvas />);
    expect(linkRenders()).toBeGreaterThan(0);
    const surface =
      container.querySelector('[data-canvas-surface]') ?? container.firstElementChild!;
    const group = container.querySelector('g[transform]')!;
    const tfBefore = group.getAttribute('transform');
    const before = linkRenders();

    for (let i = 0; i < 30; i++) {
      fireEvent.wheel(surface, { deltaX: 4, deltaY: 6, deltaMode: 0 });
    }
    expect(container.querySelector('g[transform]')!.getAttribute('transform')).not.toBe(tfBefore);
    expect(linkRenders()).toBe(before); // the culled-but-content-stable links array holds the memo
  });

  it('adding a link DOES re-render the layer (memo not stuck)', () => {
    render(<Canvas />);
    const before = linkRenders();
    act(() => {
      const c = s().addDeviceAt('server', 250, 450);
      s().connect(s().devicesAll()[0]!.id, c);
    });
    expect(linkRenders()).toBeGreaterThan(before);
  });
});
