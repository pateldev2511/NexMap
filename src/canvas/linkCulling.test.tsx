/**
 * Issue #34: a cable whose two endpoint devices are both off-screen must still
 * draw where it crosses the viewport — in flat AND iso. The canvas culls links
 * through store.visibleLinks(box); this pins that the rendered LinkLayer gets
 * the crossing link and still drops a genuinely off-screen one.
 *
 * (ResizeObserver is stubbed globally in src/test/setup.ts.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { Canvas } from './Canvas';
import { useProjectStore, type Projection } from '@/store/projectStore';

// jsdom measures 0×0 and the canvas culls at size 0 — give it a viewport.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

/** Rendered connector strokes (the visible path carries the arrow marker). */
const strokes = (root: HTMLElement) => root.querySelectorAll('path[marker-end]').length;

/** Mount the canvas and read back the flat point at the center of its view. */
function mountAndFindCenter(projection: Projection) {
  let center: { x: number; y: number } | null = null;
  const report = s().reportViewCenter;
  useProjectStore.setState({
    reportViewCenter: (p) => {
      if (p) center = p;
      report(p);
    },
  });
  act(() => s().setProjection(projection));
  const view = render(<Canvas />);
  expect(center).not.toBeNull();
  return { ...view, center: center! };
}

/** A device whose CENTER sits at (x, y). */
function deviceCenteredAt(type: 'router' | 'switch', x: number, y: number) {
  const id = s().addDeviceAt(type, x, y);
  const d = s().getDevice(id)!;
  s().updateDevice(id, { x: d.x, y: d.y }, { x: x - d.width / 2, y: y - d.height / 2 });
  return id;
}

describe.each<Projection>(['flat', 'iso'])('link culling on the %s canvas', (projection) => {
  beforeEach(() => s().newProject(NOW));

  it('draws a link crossing the view whose endpoints are both off-screen', () => {
    const { container, center } = mountAndFindCenter(projection);
    expect(strokes(container)).toBe(0);
    act(() => {
      const a = deviceCenteredAt('router', center.x - 6000, center.y);
      const b = deviceCenteredAt('switch', center.x + 6000, center.y);
      s().connect(a, b);
    });
    // Neither endpoint is mounted…
    expect(container.querySelectorAll('g[data-id]').length).toBe(0);
    // …but the cable through the middle of the view is drawn.
    expect(strokes(container)).toBe(1);
  });

  it('draws an orthogonal route whose elbow crosses the view', () => {
    const { container, center } = mountAndFindCenter(projection);
    act(() => {
      // Vertical leg of the elbow runs through the view's center column.
      const a = deviceCenteredAt('router', center.x - 6000, center.y - 6000);
      const b = deviceCenteredAt('switch', center.x + 6000, center.y + 6000);
      const l = s().connect(a, b)!;
      s().updateLink(l, { routing: undefined }, { routing: 'orthogonal' });
    });
    expect(strokes(container)).toBe(1);
  });

  it('still culls a link that runs entirely off-screen', () => {
    const { container, center } = mountAndFindCenter(projection);
    act(() => {
      const a = deviceCenteredAt('router', center.x - 6000, center.y + 20000);
      const b = deviceCenteredAt('switch', center.x + 6000, center.y + 20000);
      s().connect(a, b);
    });
    expect(strokes(container)).toBe(0);
  });
});
