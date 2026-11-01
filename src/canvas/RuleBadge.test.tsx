/**
 * Devices that break a declared rule carry the rule badge on the canvas (and say
 * so to screen readers); devices that don't, don't. Rendered through the real
 * Canvas so the store → violations → badge wiring is what's under test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from './Canvas';
import { useProjectStore } from '@/store/projectStore';

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });

const s = () => useProjectStore.getState();
const node = (c: HTMLElement, id: string) => c.querySelector(`[data-id="${id}"]`)!;

beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('rule badge on the canvas', () => {
  it('badges only the offenders of a declared rule, and clears when the rule is met', () => {
    const named = s().addDeviceAt('switch', 100, 100);
    const blank = s().addDeviceAt('switch', 300, 100);
    s().updateDevice(blank, { name: s().devicesAll().find((d) => d.id === blank)!.name }, { name: '' });
    s().toggleInvariant('every-device-named');

    const { container, rerender } = render(<Canvas />);
    expect(node(container, blank).querySelector('title')?.textContent).toMatch(/Breaks a declared rule/);
    expect(node(container, blank).getAttribute('aria-label')).toMatch(/breaks a declared rule$/);
    expect(node(container, named).querySelector('title')).toBeNull();

    s().restoreInvariant('every-device-named');
    rerender(<Canvas />);
    expect(node(container, blank).querySelector('title')).toBeNull();
  });

  it('shows nothing when no rule is declared', () => {
    const blank = s().addDeviceAt('switch', 100, 100);
    s().updateDevice(blank, { name: s().devicesAll()[0]!.name }, { name: '' });
    s().runValidation();
    const { container } = render(<Canvas />);
    expect(node(container, blank).querySelector('title')).toBeNull();
  });
});

describe('load-bearing mark on the canvas', () => {
  it('marks the devices a met rule can’t lose, and unmarks them once there’s slack', () => {
    const fw1 = s().addDeviceAt('firewall', 100, 100);
    const fw2 = s().addDeviceAt('firewall', 300, 100);
    const sw = s().addDeviceAt('switch', 500, 100);
    s().addCustomRule('count', 'firewall', '', 2);
    s().runValidation();

    const { container, rerender } = render(<Canvas />);
    for (const id of [fw1, fw2]) {
      expect(node(container, id).querySelector('title')?.textContent).toBe(
        'Holds up a declared rule — delete it and it breaks',
      );
      expect(node(container, id).getAttribute('aria-label')).toMatch(/holds up a declared rule$/);
    }
    expect(node(container, sw).querySelector('title')).toBeNull();

    s().addDeviceAt('firewall', 700, 100); // a third: no single firewall is load-bearing now
    s().runValidation();
    rerender(<Canvas />);
    expect(node(container, fw1).querySelector('title')).toBeNull();
  });
});

describe('load-bearing mark · enforced', () => {
  it('says a delete will be blocked when the rule it holds up is enforced', () => {
    const fw1 = s().addDeviceAt('firewall', 100, 100);
    s().addDeviceAt('firewall', 300, 100);
    s().addCustomRule('count', 'firewall', '', 2);
    s().toggleEnforced(s().customRules[0]!.id);
    s().runValidation();
    const { container } = render(<Canvas />);
    expect(node(container, fw1).querySelector('title')?.textContent).toBe(
      'Holds up an enforced rule — deleting it will be blocked',
    );
    expect(node(container, fw1).getAttribute('aria-label')).toMatch(/holds up an enforced rule$/);
  });
});
