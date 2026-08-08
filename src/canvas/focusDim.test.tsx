/**
 * Focus dimming (W4b). Selecting something demotes everything else so a dense
 * diagram reads at a glance.
 *
 * These assert the RULES, which are easy to regress silently because dimming is
 * purely presentational:
 *  - nothing selected → nothing dimmed (no permanent visual tax)
 *  - the selection itself is never dimmed
 *  - a link stays lit when either endpoint is selected (the context that makes the
 *    selection meaningful), and dims only when unrelated
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { Canvas } from './Canvas';
import { useProjectStore } from '@/store/projectStore';

// jsdom elements measure 0×0 and the canvas culls everything at size 0 — give every
// element a viewport-sized box so devices actually render (same trick as the perf pins).
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

/** A—B and C—D: two independent pairs, so "unrelated" is meaningful. */
function twoPairs() {
  const a = s().addDeviceAt('router', 100, 100);
  const b = s().addDeviceAt('switch', 400, 100);
  const c = s().addDeviceAt('server', 100, 400);
  const d = s().addDeviceAt('server', 400, 400);
  const ab = s().connect(a, b)!;
  const cd = s().connect(c, d)!;
  return { a, b, c, d, ab, cd };
}

const dimmed = (container: HTMLElement) =>
  [...container.querySelectorAll('[class*="dimmed"]')];

const dimmedDeviceIds = (container: HTMLElement) =>
  dimmed(container)
    .map((n) => n.getAttribute('data-id'))
    .filter((id): id is string => id != null);

beforeEach(() => {
  s().newProject(NOW);
});

describe('focus dimming', () => {
  it('dims nothing while nothing is selected', () => {
    twoPairs();
    const { container } = render(<Canvas />);
    expect(dimmed(container)).toHaveLength(0);
  });

  it('dims the other devices but never the selected one', () => {
    const { a, b, c, d } = twoPairs();
    const { container } = render(<Canvas />);
    act(() => s().select([a]));

    const ids = dimmedDeviceIds(container);
    expect(ids).not.toContain(a);
    expect(ids).toContain(b);
    expect(ids).toContain(c);
    expect(ids).toContain(d);
  });

  it('keeps a link lit when one of its endpoints is selected', () => {
    const { a } = twoPairs();
    const { container } = render(<Canvas />);
    act(() => s().select([a]));

    // Exactly one of the two link groups dims: C—D. The A—B link touching the
    // selection stays lit.
    const dimmedLinkGroups = dimmed(container).filter(
      (n) => n.tagName.toLowerCase() === 'g' && n.getAttribute('data-id') == null,
    );
    expect(dimmedLinkGroups).toHaveLength(1);
  });

  it('dims both links when a device with no links is selected', () => {
    twoPairs();
    const lone = s().addDeviceAt('printer', 700, 700);
    const { container } = render(<Canvas />);
    act(() => s().select([lone]));

    const dimmedLinkGroups = dimmed(container).filter(
      (n) => n.tagName.toLowerCase() === 'g' && n.getAttribute('data-id') == null,
    );
    expect(dimmedLinkGroups).toHaveLength(2);
  });

  it('a multi-selection keeps every selected device lit', () => {
    const { a, b, c } = twoPairs();
    const { container } = render(<Canvas />);
    act(() => s().select([a, b]));

    const ids = dimmedDeviceIds(container);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
    expect(ids).toContain(c);
  });

  it('clearing the selection removes all dimming', () => {
    const { a } = twoPairs();
    const { container } = render(<Canvas />);
    act(() => s().select([a]));
    expect(dimmed(container).length).toBeGreaterThan(0);
    act(() => s().clearSelection());
    expect(dimmed(container)).toHaveLength(0);
  });

  it('dims text notes and zones too, not just devices', () => {
    const { a } = twoPairs();
    const note = s().addText(600, 200);
    const { container } = render(<Canvas />);
    act(() => s().select([a]));
    expect(dimmedDeviceIds(container)).toContain(note);
  });

  it('works in isometric projection as well as flat', () => {
    const { a, b } = twoPairs();
    const { container } = render(<Canvas />);
    act(() => s().setProjection('iso'));
    act(() => s().select([a]));

    const ids = dimmedDeviceIds(container);
    expect(ids).not.toContain(a);
    expect(ids).toContain(b);
  });
});
