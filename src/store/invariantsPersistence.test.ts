/**
 * Invariants M3: declared rules persist in the .nexmap document (schema v6) and
 * come back on load, evaluated against the restored design.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('invariant persistence (schema v6)', () => {
  it('serializes declared rules into the document', () => {
    s().toggleInvariant('no-single-point-of-failure');
    s().toggleInvariant('every-device-named');
    const doc = s().getDocument();
    expect(doc.schemaVersion).toBe(7);
    expect([...doc.invariants].sort()).toEqual([
      'every-device-named',
      'no-single-point-of-failure',
    ]);
  });

  it('round-trips: loading restores the rules and re-evaluates them on the design', () => {
    const d = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(d, { name: s().devicesAll()[0]!.name }, { name: '' }); // blank name
    s().toggleInvariant('every-device-named');
    const doc = s().getDocument();

    s().newProject(NOW); // wipe
    expect(s().invariantsEnabled.size).toBe(0);

    s().loadDoc(doc); // reopen the saved design
    expect([...s().invariantsEnabled]).toEqual(['every-device-named']);
    expect(s().invariantViolations.map((v) => v.id)).toEqual(['every-device-named']);
  });

  it('marks the document dirty when a rule is declared', () => {
    expect(s().dirty).toBe(false);
    s().toggleInvariant('every-device-addressed');
    expect(s().dirty).toBe(true);
  });

  it('a new project declares no rules', () => {
    s().toggleInvariant('every-device-named');
    s().newProject(NOW);
    expect(s().invariantsEnabled.size).toBe(0);
    expect(s().getDocument().invariants).toEqual([]);
  });
});

describe('custom rule persistence + evaluation (schema v7)', () => {
  it('authors a rule, evaluates it, and serializes it into the document', () => {
    const acc = s().addDeviceAt('switch', 0, 0);
    const core = s().addDeviceAt('switch', 200, 0);
    s().updateDevice(acc, {}, { role: 'access' });
    s().updateDevice(core, {}, { role: 'core' });
    s().connect(acc, core); // only one core — dual-home rule should flag the access switch

    s().addCustomRule('connectivity', 'access', 'core', 2);
    expect(s().dirty).toBe(true);
    const viol = s().invariantViolations.filter((v) => v.objectIds.includes(acc));
    expect(viol).toHaveLength(1);

    const doc = s().getDocument();
    expect(doc.schemaVersion).toBe(7);
    expect(doc.customRules).toHaveLength(1);
    expect(doc.customRules[0]).toMatchObject({ kind: 'connectivity', fromRole: 'access', toRole: 'core', min: 2 });
  });

  it('round-trips authored rules on load and re-evaluates them', () => {
    const acc = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(acc, {}, { role: 'access' });
    s().addCustomRule('connectivity', 'access', 'core', 2); // no cores at all → access violates
    const doc = s().getDocument();

    s().newProject(NOW);
    expect(s().customRules).toHaveLength(0);

    s().loadDoc(doc);
    expect(s().customRules).toHaveLength(1);
    expect(s().invariantViolations.some((v) => v.id === doc.customRules[0]!.id)).toBe(true);
  });

  it('removes an authored rule', () => {
    s().addCustomRule('connectivity', 'access', 'core', 2);
    const id = s().customRules[0]!.id;
    const before = s().customRules;
    s().removeCustomRule(id);
    expect(s().customRules).toHaveLength(0);
    expect(s().invariantViolations.some((v) => v.id === id)).toBe(false);
    expect(s().flash).toBe('Retracted Every “access” connects to ≥2 “core”.');
    // An unknown id is a no-op: no state churn, so autosave doesn't fire for nothing.
    const after = s().customRules;
    s().removeCustomRule('nope');
    expect(s().customRules).toBe(after);
    expect(before).not.toBe(after);
  });

  it('authors an isolation rule and flags a guest that can reach internal', () => {
    const guest = s().addDeviceAt('switch', 0, 0);
    const internal = s().addDeviceAt('server', 200, 0);
    s().updateDevice(guest, {}, { role: 'guest' });
    s().updateDevice(internal, {}, { role: 'internal' });
    s().connect(guest, internal); // same fabric → reachable

    s().addCustomRule('isolation', 'guest', 'internal', 0);
    const rule = s().customRules[0]!;
    expect(rule.kind).toBe('isolation');
    const viol = s().invariantViolations.find((v) => v.id === rule.id);
    expect(viol?.objectIds).toEqual([guest]);
  });

  it('round-trips a placement rule with its subnet ref', () => {
    const cam = s().addDeviceAt('server', 0, 0);
    s().updateDevice(cam, {}, { role: 'camera', managementIp: '10.10.0.5' });
    s().addCustomRule('placement', 'camera', 'CCTV', 0);
    const doc = s().getDocument();
    expect(doc.customRules[0]).toMatchObject({ kind: 'placement', fromRole: 'camera', subnet: 'CCTV' });

    s().newProject(NOW);
    s().loadDoc(doc);
    expect(s().customRules[0]).toMatchObject({ kind: 'placement', subnet: 'CCTV' });
    expect(s().invariantViolations.some((v) => v.id === doc.customRules[0]!.id)).toBe(true);
  });
});

describe('declaring from a suggestion', () => {
  it('a built-in says what it did, like an authored rule', () => {
    s().toggleInvariant('every-device-named');
    expect(s().flash).toBe('Declared Every device is named — met.');
    s().toggleInvariant('every-device-named');
    expect(s().flash).toBe('Retracted Every device is named.');
  });
});
