/**
 * Invariants M2: restoreInvariant wires each declared rule to the fixer that owns
 * its remedy. These are end-to-end: declare a rule, break it, restore, and assert
 * the violation clears (or shrinks honestly).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const violated = (id: string) => s().invariantViolations.some((v) => v.id === id);

beforeEach(() => s().newProject(NOW));

describe('restoreInvariant', () => {
  it('every-device-named: names the blank device and clears the rule', () => {
    const d = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(d, { name: s().devicesAll()[0]!.name }, { name: '' });
    s().toggleInvariant('every-device-named');
    expect(violated('every-device-named')).toBe(true);

    const fixed = s().restoreInvariant('every-device-named');
    expect(fixed).toBe(1);
    expect(violated('every-device-named')).toBe(false);
  });

  it('every-device-addressed: addresses the device and clears the rule', () => {
    const d = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(d, {}, { managementIp: '' });
    s().toggleInvariant('every-device-addressed');
    expect(violated('every-device-addressed')).toBe(true);

    s().restoreInvariant('every-device-addressed');
    expect(violated('every-device-addressed')).toBe(false);
  });

  it('every-subnet-has-gateway: adopts an in-range router and clears the rule', () => {
    const r = s().addDeviceAt('router', 0, 0);
    s().updateDevice(r, {}, { managementIp: '10.0.0.1' });
    s().addSubnet('10.0.0.0/24'); // gateway-less
    s().toggleInvariant('every-subnet-has-gateway');
    expect(violated('every-subnet-has-gateway')).toBe(true);

    s().restoreInvariant('every-subnet-has-gateway');
    expect(violated('every-subnet-has-gateway')).toBe(false);
  });

  it('no-single-point-of-failure: hardens the SPOF and clears the rule', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const hub = s().addDeviceAt('switch', 200, 0);
    const b = s().addDeviceAt('server', 400, 0);
    s().connect(a, hub);
    s().connect(b, hub); // hub is the single point of failure
    s().toggleInvariant('no-single-point-of-failure');
    expect(violated('no-single-point-of-failure')).toBe(true);

    s().restoreInvariant('no-single-point-of-failure');
    expect(violated('no-single-point-of-failure')).toBe(false);
  });

  it('is a no-op for an unknown id', () => {
    expect(s().restoreInvariant('nope')).toBe(0);
  });
});

describe('twin naming from an unnamed source', () => {
  const spof = () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const hub = s().addDeviceAt('switch', 200, 0);
    const b = s().addDeviceAt('server', 400, 0);
    s().connect(a, hub);
    s().connect(b, hub);
    s().updateDevice(hub, {}, { name: '' }); // the SPOF has no name
    return hub;
  };
  // Regression: a blank source used to yield a twin named "" or " 2".
  const twinNames = (before: Set<string>) =>
    s().devicesAll().filter((d) => !before.has(d.id)).map((d) => d.name);

  it('hardenDesign names the twin from its type', () => {
    spof();
    const before = new Set(s().devicesAll().map((d) => d.id));
    s().hardenDesign();
    const names = twinNames(before);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^Switch( \d+)?$/);
  });

  it('addRedundantTwin names the twin from its type', () => {
    const hub = spof();
    const before = new Set(s().devicesAll().map((d) => d.id));
    s().addRedundantTwin(hub);
    const names = twinNames(before);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^Switch( \d+)?$/);
  });
});

describe('restoreAllInvariants', () => {
  it('restores every declared, violated rule in one pass', () => {
    // A SPOF topology that also breaks naming and addressing.
    const a = s().addDeviceAt('switch', 0, 0);
    const hub = s().addDeviceAt('switch', 200, 0);
    const b = s().addDeviceAt('server', 400, 0);
    s().connect(a, hub);
    s().connect(b, hub); // hub is the SPOF
    for (const id of [a, hub, b]) s().updateDevice(id, {}, { name: '', managementIp: '' });

    s().toggleInvariant('no-single-point-of-failure');
    s().toggleInvariant('every-device-named');
    s().toggleInvariant('every-device-addressed');
    expect(s().invariantViolations.length).toBe(3);

    const changed = s().restoreAllInvariants();
    expect(changed).toBeGreaterThan(0);
    // All three declared rules are met — including on the twin harden minted,
    // because naming + addressing run after harden in the same pass.
    expect(s().invariantViolations).toEqual([]);
  });

  it('is an honest no-op when every declared rule is already met', () => {
    const d = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(d, {}, { managementIp: '10.0.0.2' });
    s().toggleInvariant('every-device-addressed');
    expect(s().invariantViolations).toEqual([]);

    expect(s().restoreAllInvariants()).toBe(0);
    expect(s().flash).toMatch(/already met/);
  });
});
