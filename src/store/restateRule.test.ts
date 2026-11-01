/**
 * Saying a declared rule again with a new number changes it (one rule, new
 * minimum) instead of stacking a second, weaker or stronger, copy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { findRestated, createCountRule, createPlacementRule } from '@/model/invariants';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

describe('restating a rule', () => {
  it('a new number changes the declared rule in place', () => {
    s().addDeviceAt('firewall', 0, 0);
    s().addDeviceAt('firewall', 200, 0);
    s().addCustomRule('count', 'firewall', '', 2);
    const id = s().customRules[0]!.id;
    s().addCustomRule('count', 'Firewall', '', 3);
    expect(s().customRules).toHaveLength(1);
    expect(s().customRules[0]).toMatchObject({ id, min: 3 });
    expect(s().flash).toBe('Tightened to At least 3 “firewall” (was 2) — 1 short.');
    s().addCustomRule('count', 'firewall', '', 1);
    expect(s().flash).toBe('Loosened to At least 1 “firewall” (was 3) — met.');
  });

  it('the same number says so and changes nothing', () => {
    s().addCustomRule('connectivity', 'access', 'core', 2);
    s().addCustomRule('connectivity', 'access', 'core', 2);
    expect(s().customRules).toHaveLength(1);
    expect(s().flash).toBe('Every “access” connects to ≥2 “core” is already declared.');
  });

  it('different roles or kinds are different rules', () => {
    s().addCustomRule('connectivity', 'access', 'core', 2);
    s().addCustomRule('connectivity', 'access', 'edge', 1);
    s().addCustomRule('count', 'core', '', 2);
    expect(s().customRules.map((r) => r.min)).toEqual([2, 1, 2]);
  });

  it('never goes below 1', () => {
    s().addCustomRule('count', 'core', '', 1);
    s().setCustomRuleMin(s().customRules[0]!.id, 0);
    expect(s().customRules[0]!.min).toBe(1);
  });

  it('tightening into a broken rule is not reported later as an edit that broke it', () => {
    const fw = s().addDeviceAt('firewall', 0, 0);
    s().addDeviceAt('firewall', 200, 0);
    s().addCustomRule('count', 'firewall', '', 2);
    s().runValidation();
    s().setCustomRuleMin(s().customRules[0]!.id, 3); // now 1 short
    useProjectStore.setState({ flash: null });
    s().updateDevice(fw, {}, { name: 'Edge FW' }); // unrelated edit
    s().endEdit();
    expect(s().flash).toBeNull();
  });
});

describe('findRestated', () => {
  it('matches kind and roles (any case), never the subnet of another placement', () => {
    const rules = [createCountRule('core', 2), createPlacementRule('camera', 'CCTV')];
    expect(findRestated(rules, { kind: 'count', fromRole: ' CORE ', toRole: '' })).toBe(rules[0]);
    expect(findRestated(rules, { kind: 'count', fromRole: 'edge', toRole: '' })).toBeUndefined();
    expect(findRestated(rules, { kind: 'placement', fromRole: 'camera', toRole: '', subnet: 'Office' })).toBeUndefined();
  });
});
