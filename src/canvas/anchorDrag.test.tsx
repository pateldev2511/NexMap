/**
 * #71: the callout anchor drag has a cancel path. An interrupted drag (pointer
 * cancel, lost capture, window blur, Escape) drops the dashed leader instead of
 * leaving it stuck to the cursor, and never throws on capture/release.
 *
 * (ResizeObserver is stubbed globally in src/test/setup.ts; jsdom has no
 * setPointerCapture at all, so every capture call here is the throwing case.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { Canvas } from './Canvas';
import styles from './Canvas.module.css';
import { useProjectStore } from '@/store/projectStore';
import { keyboardRouter } from '@/input/router';

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });

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

const s = () => useProjectStore.getState();
let detach: () => void = () => {};
let dev = '';
let note = '';
beforeEach(() => {
  detach = keyboardRouter.install();
  s().newProject('2026-01-01T00:00:00.000Z');
  s().setFlowMode(false);
  s().setProjection('flat');
  dev = s().addDeviceAt('router', 500, 300);
  note = s().addText(100, 100);
  s().select([note]);
});
afterEach(() => detach());

const handle = (c: HTMLElement) => c.querySelector(`.${styles.anchorHandle}`)!;
/** The live dashed leader only exists while an anchor drag is in flight. */
const leader = (c: HTMLElement) => c.querySelector('line[stroke="var(--accent)"]');

function startDrag(c: HTMLElement) {
  const h = handle(c);
  expect(h).not.toBeNull();
  fireEvent.pointerDown(h, { button: 0, buttons: 1, pointerId: 7, clientX: 300, clientY: 120 });
  fireEvent.pointerMove(h, { buttons: 1, pointerId: 7, clientX: 380, clientY: 200 });
  expect(leader(c)).not.toBeNull();
  return h;
}

describe('callout anchor drag can always be ended (#71)', () => {
  it('pointercancel drops the leader and attaches nothing', () => {
    const { container } = render(<Canvas />);
    const h = startDrag(container);
    fireEvent.pointerCancel(h, { pointerId: 7 });
    expect(leader(container)).toBeNull();
    // A late pointerup is a no-op, not an attach.
    const d = s().getDevice(dev)!;
    fireEvent.pointerUp(h, { pointerId: 7, clientX: d.x + 5, clientY: d.y + 5 });
    expect(s().getObject(note)).toMatchObject({ kind: 'text' });
    expect((s().getObject(note) as { anchor?: unknown }).anchor ?? null).toBeNull();
  });

  it('lostpointercapture drops the leader', () => {
    const { container } = render(<Canvas />);
    const h = startDrag(container);
    fireEvent.lostPointerCapture(h, { pointerId: 7 });
    expect(leader(container)).toBeNull();
  });

  it('window blur drops the leader', () => {
    const { container } = render(<Canvas />);
    startDrag(container);
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(leader(container)).toBeNull();
  });

  it('Escape drops the leader and keeps the selection (one layer per press)', () => {
    const { container } = render(<Canvas />);
    startDrag(container);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(leader(container)).toBeNull();
    expect([...s().selection]).toEqual([note]);
  });

  it('a completed drag onto a device still attaches, without throwing on release', () => {
    const { container } = render(<Canvas />);
    const h = startDrag(container);
    const d = s().getDevice(dev)!;
    fireEvent.pointerUp(h, { pointerId: 7, clientX: d.x + d.width / 2, clientY: d.y + d.height / 2 });
    expect(leader(container)).toBeNull();
    expect((s().getObject(note) as { anchor?: unknown }).anchor).toEqual({ type: 'device', id: dev });
  });
});
