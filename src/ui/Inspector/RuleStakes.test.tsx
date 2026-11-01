/**
 * The Inspector's Rules group: what the declared rules make of the selected
 * device. Rendered through the real Inspector so selection → stakes is under test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Inspector } from './Inspector';
import { useProjectStore } from '@/store/projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('Inspector · Rules', () => {
  it('is absent until the design declares a rule', () => {
    const fw = s().addDeviceAt('firewall', 0, 0);
    s().select([fw]);
    render(<Inspector />);
    expect(screen.queryByLabelText('Declared rules')).toBeNull();
  });

  it('shows what the device holds up, and what it breaks', () => {
    const fw1 = s().addDeviceAt('firewall', 0, 0);
    s().addDeviceAt('firewall', 200, 0);
    s().addCustomRule('count', 'firewall', '', 2);
    s().toggleInvariant('every-device-named');
    s().updateDevice(fw1, { name: s().devicesAll().find((d) => d.id === fw1)!.name }, { name: '' });
    s().select([fw1]);
    render(<Inspector />);
    const group = within(screen.getByLabelText('Declared rules'));
    expect(group.getByText(/Holds up At least 2 “firewall”/)).toBeTruthy();
    expect(group.getByText('Delete it and the rule breaks (1 short).')).toBeTruthy();
    expect(group.getByText(/Breaks Every device is named/)).toBeTruthy();
    expect(group.getByText('blank name')).toBeTruthy();
  });

  it('says so when nothing depends on the device', () => {
    const fws = [0, 1, 2].map((i) => s().addDeviceAt('firewall', i * 200, 0));
    s().addCustomRule('count', 'firewall', '', 2);
    s().select([fws[0]!]);
    render(<Inspector />);
    expect(screen.getByText('Meets every declared rule, and none depends on it.')).toBeTruthy();
  });
});

describe('Inspector · Rules · enforced', () => {
  it('says the delete will be blocked when the held rule is enforced', () => {
    const fw1 = s().addDeviceAt('firewall', 0, 0);
    s().addDeviceAt('firewall', 200, 0);
    s().addCustomRule('count', 'firewall', '', 2);
    s().toggleEnforced(s().customRules[0]!.id);
    s().select([fw1]);
    render(<Inspector />);
    const group = within(screen.getByLabelText('Declared rules'));
    expect(group.getByText('· enforced')).toBeTruthy();
    expect(group.getByText('Deleting it would break the rule (1 short), so the delete will be blocked.')).toBeTruthy();
  });
});

describe('Inspector · Rules · deleting a selection', () => {
  it('a multi-selection shows what deleting it breaks, and when only the group holds it up', () => {
    const fw1 = s().addDeviceAt('firewall', 0, 0);
    const fw2 = s().addDeviceAt('firewall', 200, 0);
    s().addCustomRule('count', 'firewall', '', 1);
    s().toggleEnforced(s().customRules[0]!.id);
    s().select([fw1, fw2]);
    render(<Inspector />);
    const group = within(screen.getByLabelText('Declared rules'));
    expect(group.getByText(/Deleting these breaks At least 1 “firewall”/)).toBeTruthy();
    expect(
      group.getByText('1 short — none of them alone holds it up; together they do. The delete will be blocked.'),
    ).toBeTruthy();
  });

  it('a link shows what deleting it breaks — or that it breaks nothing', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const l = s().connect(a, b)!;
    s().toggleInvariant('every-device-named');
    s().select([l]);
    render(<Inspector />);
    expect(screen.getByText('Deleting this link breaks no declared rule.')).toBeTruthy();
  });
});

describe('Inspector · Rules · locked objects', () => {
  it('the preview counts only what Delete would remove', () => {
    const fw1 = s().addDeviceAt('firewall', 0, 0);
    const fw2 = s().addDeviceAt('firewall', 200, 0);
    s().addCustomRule('count', 'firewall', '', 1);
    s().updateDevice(fw2, {}, { locked: true });
    s().select([fw1, fw2]);
    render(<Inspector />);
    const group = within(screen.getByLabelText('Declared rules'));
    expect(group.getByText('1 locked — Delete leaves it; this counts only the rest.')).toBeTruthy();
    expect(group.getByText('Deleting these breaks no declared rule.')).toBeTruthy();
  });
});

describe('Inspector · Rules · quick fix', () => {
  it('a device short of a rule gets “Connect to …” under the rule it breaks', () => {
    const add = (role: string, name: string, x: number) => {
      const id = s().addDeviceAt('switch', x, 0);
      s().updateDevice(id, {}, { role, name });
      return id;
    };
    const c1 = add('core', 'C1', 0);
    add('core', 'C2', 200);
    const a = add('access', 'A1', 400);
    s().connect(a, c1);
    s().addCustomRule('connectivity', 'access', 'core', 2);
    s().select([a]);
    render(<Inspector />);
    fireEvent.click(within(screen.getByLabelText('Declared rules')).getByRole('button', { name: 'Connect to C2' }));
    expect(s().linksAll()).toHaveLength(2);
    expect(s().flash).toBe('Connected A1 to C2. ⌘Z takes the link back.');
  });
});
