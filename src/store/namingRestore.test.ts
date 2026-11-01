/** Restoring a naming rule renames offenders to the template, in one undo step. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

describe('naming rules in the store', () => {
  it('declare, restore to the next free numbers, undo', () => {
    const a = s().addDeviceAt('firewall', 0, 0);
    const b = s().addDeviceAt('firewall', 200, 0);
    s().updateDevice(a, {}, { name: 'FW-1' });
    s().endEdit();
    s().addCustomRule('naming', 'firewall', 'FW-#', 0);
    const id = s().customRules[0]!.id;
    expect(s().flash).toBe('Declared Every “firewall” is named “FW-#” — 1 to fix.');
    expect(s().restoreInvariant(id)).toBe(1);
    expect(s().devicesAll().find((d) => d.id === b)!.name).toBe('FW-2');
    expect(s().flash).toBe('Renamed 1 device to fit “FW-#”: FW-2.');
    expect(s().invariantViolations).toEqual([]);
    s().undo();
    expect(s().devicesAll().find((d) => d.id === b)!.name).not.toBe('FW-2');
  });

  it('a template Conductor can’t fill in says so', () => {
    s().addDeviceAt('firewall', 0, 0);
    s().addCustomRule('naming', 'firewall', 'FW-*', 0);
    expect(s().restoreInvariant(s().customRules[0]!.id)).toBe(0);
    expect(s().flash).toMatch(/^Couldn’t restore Every “firewall” is named “FW-\*” — Conductor can only fill in one “#”/);
  });

  it('restore-all names twins to the standard before the generic naming rule', () => {
    s().addDeviceAt('firewall', 0, 0);
    s().updateDevice(s().devicesAll()[0]!.id, {}, { name: 'FW-1' });
    s().endEdit();
    s().addCustomRule('count', 'firewall', '', 2);
    s().addCustomRule('naming', 'firewall', 'FW-#', 0);
    s().toggleInvariant('every-device-named');
    s().runValidation();
    s().restoreAllInvariants();
    expect(s().devicesAll().map((d) => d.name).sort()).toEqual(['FW-1', 'FW-2']);
    expect(s().invariantViolations).toEqual([]);
  });
});

describe('new devices follow the naming standard', () => {
  const name = (id: string) => s().devicesAll().find((d) => d.id === id)!.name;

  it('adding, summoning and twinning a firewall all give the next standard name', () => {
    const first = s().addDeviceAt('firewall', 0, 0);
    s().addCustomRule('naming', 'firewall', 'FW-#', 0);
    s().restoreInvariant(s().customRules[0]!.id); // → FW-1
    expect(name(first)).toBe('FW-1');
    expect(name(s().addDeviceAt('firewall', 200, 0))).toBe('FW-2');
    expect(name(s().summonDevice('firewall'))).toBe('FW-3');
    // Other types keep the usual default.
    const sw = s().addDeviceAt('switch', 0, 300);
    expect(name(sw)).toMatch(/^Switch/);
    s().connect(first, sw); // a twin needs neighbors to be redundancy
    s().addRedundantTwin(first);
    expect(s().devicesAll().filter((d) => d.type === 'firewall').map((d) => d.name).sort()).toEqual([
      'FW-1',
      'FW-2',
      'FW-3',
      'FW-4',
    ]);
    s().runValidation();
    expect(s().invariantViolations).toEqual([]);
  });

  it('a role standard names a twin of that role; restoring a count rule mints standard names', () => {
    const c = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(c, {}, { role: 'core', name: 'CORE-1' });
    s().endEdit();
    s().addCustomRule('naming', 'core', 'CORE-#', 0);
    s().addCustomRule('count', 'core', '', 3);
    s().restoreInvariant(s().customRules[1]!.id);
    expect(s().devicesAll().map((d) => d.name).sort()).toEqual(['CORE-1', 'CORE-2', 'CORE-3']);
  });

  it('a template it can’t fill in leaves the default', () => {
    s().addCustomRule('naming', 'firewall', 'FW-*', 0);
    expect(name(s().addDeviceAt('firewall', 0, 0))).toBe('Firewall');
  });
});
