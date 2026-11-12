/**
 * Flow (stress-test) is an interaction MODE (#87): while it is on, no editing chrome
 * renders and no pointer or key edits the document. A click on a device pulls or
 * restores it — on release, without movement — and never selects or drags.
 *
 * (ResizeObserver is stubbed globally in src/test/setup.ts.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { Canvas } from './Canvas';
import styles from './Canvas.module.css';
import { useProjectStore } from '@/store/projectStore';
import { keyboardRouter } from '@/input/router';

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });

// jsdom has no PointerEvent, so fireEvent.pointer* would drop button / clientX /
// pointerId. A MouseEvent subclass carrying the pointer fields is all Canvas reads.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventStub extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
}

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const key = (k: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(document.body, { key: k, ...init });

let detach: () => void = () => {};
let a = '';
let b = '';
let link = '';
beforeEach(() => {
  detach = keyboardRouter.install();
  s().newProject(NOW);
  s().setFlowMode(false);
  s().setProjection('flat');
  a = s().addDeviceAt('router', 200, 200);
  b = s().addDeviceAt('switch', 500, 200);
  link = s().connect(a, b)!;
});
afterEach(() => {
  detach();
  act(() => s().setFlowMode(false));
});

const centre = (id: string) => {
  const d = s().getDevice(id)!;
  return { clientX: d.x + d.width / 2, clientY: d.y + d.height / 2 };
};
const svgOf = (c: HTMLElement) => c.querySelector('svg')!;
const nodeOf = (c: HTMLElement, id: string) => c.querySelector(`[data-id="${id}"]`)!;
const hitOf = (c: HTMLElement, id: string) => c.querySelector(`[data-flow-hit="${id}"]`)!;
const handles = (c: HTMLElement) => c.querySelectorAll(`.${styles.connectHandle}`);
const toolbar = () => screen.queryByRole('toolbar', { name: 'Selection actions' });
const counts = () => ({ devices: s().devicesAll().length, links: s().linksAll().length });
const doc = () => JSON.stringify(s().getDocument());

/** A press and release at one point (the machine resolves it as a click). */
function click(target: Element, svg: Element, at: { clientX: number; clientY: number }) {
  fireEvent.pointerDown(target, { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', ...at });
  fireEvent.pointerUp(svg, { button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', ...at });
}

describe('Flow locks the editing chrome (#87)', () => {
  it('shows connect handles and the selection toolbar outside Flow, neither inside it', () => {
    const { container } = render(<Canvas />);
    act(() => s().select([a]));
    fireEvent.pointerMove(svgOf(container), { pointerId: 1, ...centre(a) });
    // Not vacuous: the chrome this test is about really renders when editing.
    expect(handles(container).length).toBe(4);
    expect(toolbar()).not.toBeNull();

    act(() => s().setFlowMode(true));
    fireEvent.pointerMove(svgOf(container), { pointerId: 1, ...centre(b) });
    expect(handles(container).length).toBe(0);
    expect(toolbar()).toBeNull();

    // Even if something selects while the lens is on (search, a side panel).
    act(() => s().select([a, link]));
    fireEvent.pointerMove(svgOf(container), { pointerId: 1, ...centre(a) });
    expect(handles(container).length).toBe(0);
    expect(toolbar()).toBeNull();
    expect(container.querySelector(`.${styles.relinkHandle}`)).toBeNull();
  });

  it('shows no connect handles in isometric Flow either', () => {
    act(() => s().setProjection('iso'));
    const { container } = render(<Canvas />);
    act(() => s().setFlowMode(true));
    fireEvent.pointerMove(svgOf(container), { pointerId: 1, clientX: 0, clientY: 0 });
    expect(handles(container).length).toBe(0);
  });

  it('entering Flow clears the selection and returns to the select tool', () => {
    render(<Canvas />);
    act(() => {
      s().select([a, link]);
      s().setMode('connect');
    });
    const before = doc();
    act(() => s().setFlowMode(true));
    expect(s().selection.size).toBe(0);
    expect(s().mode).toBe('select');
    act(() => s().setFlowMode(false));
    expect(doc()).toBe(before); // in and out of Flow never touched the diagram
  });
});

describe('Flow device clicks (#87)', () => {
  it('a click on the device node toggles its failure — no selection, nothing added or removed', () => {
    const { container } = render(<Canvas />);
    act(() => s().setFlowMode(true));
    const before = counts();
    const svg = svgOf(container);

    click(nodeOf(container, a), svg, centre(a));
    expect(s().flowFailed).toEqual([a]);
    expect(s().selection.size).toBe(0);
    expect(counts()).toEqual(before);
    expect(nodeOf(container, a).getAttribute('aria-pressed')).toBe('true');
    expect(nodeOf(container, b).getAttribute('aria-pressed')).toBe('false');

    click(nodeOf(container, a), svg, centre(a)); // again restores
    expect(s().flowFailed).toEqual([]);
    expect(s().selection.size).toBe(0);
  });

  it('a click on the Flow hit circle toggles on release, not on press', () => {
    const { container } = render(<Canvas />);
    act(() => s().setFlowMode(true));
    const svg = svgOf(container);
    const at = centre(a);
    fireEvent.pointerDown(hitOf(container, a), { button: 0, buttons: 1, pointerId: 1, ...at });
    expect(s().flowFailed).toEqual([]); // nothing yet: this could still become a pan
    fireEvent.pointerUp(svg, { button: 0, buttons: 0, pointerId: 1, ...at });
    expect(s().flowFailed).toEqual([a]);
  });

  it('a drag that starts on a device pans instead of failing or moving it', () => {
    const { container } = render(<Canvas />);
    act(() => s().setFlowMode(true));
    const svg = svgOf(container);
    const group = () => container.querySelector('g[transform]')!.getAttribute('transform');
    const tf = group();
    const { x, y } = s().getDevice(a)!;
    const at = centre(a);

    fireEvent.pointerDown(nodeOf(container, a), { button: 0, buttons: 1, pointerId: 1, ...at });
    fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, clientX: at.clientX + 40, clientY: at.clientY + 25 });
    fireEvent.pointerUp(svg, { buttons: 0, pointerId: 1, clientX: at.clientX + 40, clientY: at.clientY + 25 });

    expect(s().flowFailed).toEqual([]);
    expect(group()).not.toBe(tf); // the canvas panned…
    expect(s().getDevice(a)).toMatchObject({ x, y }); // …the device did not move
    expect(s().selection.size).toBe(0);
  });

  it('a background drag only pans: no marquee selection', () => {
    const { container } = render(<Canvas />);
    act(() => s().setFlowMode(true));
    const svg = svgOf(container);
    fireEvent.pointerDown(svg, { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, clientX: 700, clientY: 400 });
    fireEvent.pointerUp(svg, { buttons: 0, pointerId: 1, clientX: 700, clientY: 400 });
    expect(s().selection.size).toBe(0);
    expect(container.querySelector(`.${styles.marquee}`)).toBeNull();
  });

  it('Enter / Space on a focused device toggles its failure', () => {
    const { container } = render(<Canvas />);
    act(() => s().setFlowMode(true));
    fireEvent.keyDown(nodeOf(container, b), { key: 'Enter' });
    expect(s().flowFailed).toEqual([b]);
    expect(s().selection.size).toBe(0);
    fireEvent.keyDown(nodeOf(container, b), { key: ' ' });
    expect(s().flowFailed).toEqual([]);
  });

  it('outside Flow a device click still selects (the lock is Flow-only)', () => {
    const { container } = render(<Canvas />);
    click(nodeOf(container, a), svgOf(container), centre(a));
    expect([...s().selection]).toEqual([a]);
    expect(s().flowFailed).toEqual([]);
    expect(nodeOf(container, a).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Flow keys (#87)', () => {
  it('ignores every editing key; the diagram is byte-identical afterwards', () => {
    render(<Canvas />);
    act(() => s().setFlowMode(true));
    act(() => s().select([a, link])); // a selection that arrived from elsewhere
    const before = doc();
    const mod = { ctrlKey: true };
    for (const k of ['Delete', 'Backspace', 'ArrowRight', 't', 'r', 'c', 'q', 'h']) key(k);
    for (const k of ['d', 'x', 'g', ']', '[', 'a']) key(k, mod);
    key('l', { ...mod, shiftKey: true });
    expect(doc()).toBe(before);
    expect(counts()).toEqual({ devices: 2, links: 1 });
    expect(s().mode).toBe('select');
    expect(s().flowMode).toBe(true);
  });

  it('Escape leaves Flow through the router', () => {
    render(<Canvas />);
    act(() => s().setFlowMode(true));
    act(() => void key('Escape'));
    expect(s().flowMode).toBe(false);
  });

  it('Escape under an overlay (a dialog, a menu) closes that, not Flow', () => {
    render(<Canvas />);
    act(() => s().setFlowMode(true));
    let closed = 0;
    const off = keyboardRouter.registerOverlay((e) => {
      if (e.key === 'Escape') closed++;
      return true; // a modal swallows every key
    });
    act(() => void key('Escape'));
    off();
    expect(closed).toBe(1);
    expect(s().flowMode).toBe(true);
  });
});
