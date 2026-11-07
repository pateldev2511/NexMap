/**
 * Canvas keyboard stage: clipboard keys hand off to the browser's clipboard events
 * (#52), and a read-only (presentation) canvas ignores every editing key while
 * zoom and copy still work (#35).
 *
 * (ResizeObserver is stubbed globally in src/test/setup.ts.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Canvas } from './Canvas';
import { useProjectStore } from '@/store/projectStore';
import { keyboardRouter } from '@/input/router';

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const mod = { ctrlKey: true };
/** keyDown on the body (the router listens on window); true = default NOT prevented. */
const key = (k: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(document.body, { key: k, ...init });

let detach: () => void = () => {};
let a = '';
beforeEach(() => {
  detach = keyboardRouter.install();
  s().newProject(NOW);
  a = s().addDeviceAt('router', 200, 200);
  const b = s().addDeviceAt('switch', 500, 200);
  s().connect(a, b);
  s().select([a]);
});
afterEach(() => detach());

describe('clipboard keys on the editable canvas (#52)', () => {
  it('⌘V is left to the browser: no preventDefault, no paste from the keydown', () => {
    render(<Canvas />);
    s().copySelection();
    expect(key('v', mod)).toBe(true);
    expect(s().devicesAll()).toHaveLength(2); // the paste EVENT pastes, not the key
  });

  it('⌘C copies without blocking the native copy event', () => {
    render(<Canvas />);
    expect(key('c', mod)).toBe(true);
    expect(s().hasClipboard()).toBe(true);
  });

  it('⌘X cuts without blocking the native cut event', () => {
    render(<Canvas />);
    expect(key('x', mod)).toBe(true);
    expect(s().getDevice(a)).toBeUndefined();
    expect(s().hasClipboard()).toBe(true);
  });
});

describe('presentation canvas is read-only (#35)', () => {
  it('ignores every editing key', () => {
    render(<Canvas readOnly />);
    const before = JSON.stringify(s().getDocument().devices);
    const rev = s().rev;
    key('Delete');
    key('Backspace');
    key('ArrowRight');
    key('ArrowDown', { shiftKey: true });
    key('d', mod);
    key('x', mod);
    key('g', mod);
    key(']', mod);
    key('l', { ...mod, shiftKey: true });
    key('c'); // connect tool
    key('t'); // text tool
    expect(s().rev).toBe(rev);
    expect(JSON.stringify(s().getDocument().devices)).toBe(before);
    expect(s().mode).toBe('select');
  });

  it('swallows the canvas editing combos instead of handing them to the browser', () => {
    render(<Canvas readOnly />);
    expect(key('d', mod)).toBe(false); // not the browser's bookmark shortcut
  });

  it('zoom keys still zoom', () => {
    const { container } = render(<Canvas readOnly />);
    const tf = () => container.querySelector('g[transform]')!.getAttribute('transform');
    const t0 = tf();
    key('=', mod);
    expect(tf()).not.toBe(t0);
    const t1 = tf();
    key('-', mod);
    expect(tf()).not.toBe(t1);
    key('0', mod); // fit
  });

  it('copy still copies', () => {
    // Empty the (session-wide) canvas clipboard first.
    s().clearSelection();
    s().copySelection();
    s().select([a]);
    render(<Canvas readOnly />);
    expect(s().hasClipboard()).toBe(false);
    key('c', mod);
    expect(s().hasClipboard()).toBe(true);
  });
});
