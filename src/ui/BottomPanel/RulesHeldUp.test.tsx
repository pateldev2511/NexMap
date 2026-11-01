/**
 * Rules tab · "held up by N": a met rule names the devices it can't lose.
 * Rendered through the real BottomPanel (click the Rules tab) so the store wiring
 * and the select-on-open behaviour are under test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BottomPanel } from './BottomPanel';
import { useProjectStore } from '@/store/projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

const openRules = () => {
  render(<BottomPanel />);
  fireEvent.click(screen.getByRole('button', { name: /^Rules/ }));
};

describe('Rules tab · held up by', () => {
  it('lists and selects the devices a met rule depends on', () => {
    const fw1 = s().addDeviceAt('firewall', 0, 0);
    const fw2 = s().addDeviceAt('firewall', 200, 0);
    s().addCustomRule('count', 'firewall', '', 2);
    s().runValidation();
    openRules();
    const held = screen.getByRole('button', { name: /held up by 2/ });
    expect(held.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(held);
    expect(new Set(s().selection)).toEqual(new Set([fw1, fw2]));
    const list = within(screen.getByLabelText('Devices this rule depends on'));
    expect(list.getAllByText('Delete it and the rule breaks (1 short)')).toHaveLength(2);
  });

  it('a met rule with slack shows just "met"', () => {
    [0, 1, 2].forEach((i) => s().addDeviceAt('firewall', i * 200, 0));
    s().addCustomRule('count', 'firewall', '', 2);
    s().runValidation();
    openRules();
    expect(screen.getByText('met')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /held up by/ })).toBeNull();
  });
});

describe('Rules tab · − / + on a minimum', () => {
  it('raises and lowers a count rule, and can’t go below 1', () => {
    s().addCustomRule('count', 'firewall', '', 1);
    s().runValidation();
    openRules();
    expect((screen.getByRole('button', { name: 'Lower the minimum to 0' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Raise the minimum to 2' }));
    expect(s().customRules[0]!.min).toBe(2);
    expect(screen.getByText('At least 2 “firewall”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lower the minimum to 1' }));
    expect(s().customRules[0]!.min).toBe(1);
  });

  it('no stepper on rules without a minimum', () => {
    s().addCustomRule('isolation', 'guest', 'core', 0);
    openRules();
    expect(screen.queryByRole('button', { name: /minimum/ })).toBeNull();
  });
});

describe('Rules tab · enforce', () => {
  it('a lock on each declared rule toggles enforcement and reads pressed', () => {
    s().addCustomRule('count', 'firewall', '', 2);
    openRules();
    const lock = screen.getByRole('button', { name: 'Enforce At least 2 “firewall”' });
    expect(lock.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(lock);
    expect(s().rulesEnforced.has(s().customRules[0]!.id)).toBe(true);
    expect(screen.getByRole('button', { name: 'Enforce At least 2 “firewall”' }).getAttribute('aria-pressed')).toBe('true');
    // Undeclared built-ins have no lock.
    expect(screen.queryByRole('button', { name: 'Enforce Every device is named' })).toBeNull();
  });
});

describe('Rules tab · why-list quick fix', () => {
  it('“Connect to C2” draws the missing uplink and the rule is met', () => {
    const named = (type: 'switch', role: string, name: string, x: number) => {
      const id = s().addDeviceAt(type, x, 0);
      s().updateDevice(id, {}, { role, name });
      return id;
    };
    const c1 = named('switch', 'core', 'C1', 0);
    named('switch', 'core', 'C2', 200);
    const a = named('switch', 'access', 'A1', 400);
    s().connect(a, c1);
    s().addCustomRule('connectivity', 'access', 'core', 2);
    s().runValidation();
    openRules();
    fireEvent.click(screen.getByRole('button', { name: /1 to fix/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect to C2' }));
    expect(s().linksAll()).toHaveLength(2);
    expect(s().invariantViolations).toEqual([]);
    expect(s().flash).toBe('Connected A1 to C2. ⌘Z takes the link back.');
  });
});

describe('Rules tab · why-list cut', () => {
  it('“Cut G–C” deletes the link that lets guest reach access, and the rule holds', () => {
    const named = (role: string, name: string, x: number) => {
      const id = s().addDeviceAt('switch', x, 0);
      s().updateDevice(id, {}, { role, name });
      return id;
    };
    const g = named('guest', 'G', 0);
    const c = named('core', 'C', 200);
    const a = named('access', 'A', 400);
    s().connect(g, c);
    s().connect(c, a);
    s().addCustomRule('isolation', 'guest', 'access', 0);
    s().runValidation();
    openRules();
    fireEvent.click(screen.getByRole('button', { name: /1 to fix/ }));
    expect(screen.getByText('reaches “access” A via C')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cut G–C' }));
    expect(s().linksAll()).toHaveLength(1);
    expect(s().invariantViolations).toEqual([]);
    expect(s().flash).toBe('Cut G–C. ⌘Z puts the link back.');
  });
});

describe('Rules tab · naming form', () => {
  it('"is named like" declares a naming rule from the form', () => {
    s().addDeviceAt('firewall', 0, 0);
    openRules();
    fireEvent.change(screen.getByLabelText('rule kind'), { target: { value: 'naming' } });
    fireEvent.change(screen.getByLabelText('from role'), { target: { value: 'firewall' } });
    fireEvent.change(screen.getByLabelText('name pattern'), { target: { value: 'FW-#' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(s().customRules).toEqual([expect.objectContaining({ kind: 'naming', fromRole: 'firewall', pattern: 'FW-#' })]);
    expect(screen.getByText('Every “firewall” is named “FW-#”')).toBeTruthy();
  });
});
