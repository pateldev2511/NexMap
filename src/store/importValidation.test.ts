/** #84a: the import actions leave validation fresh, not stale until the next edit. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { createDevice, createVlan } from '@/model/schema';

const s = () => useProjectStore.getState();
beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('import actions re-run validation', () => {
  it('importSemantics: an out-of-range VLAN is flagged immediately', () => {
    s().runValidation();
    const before = s().issues.length;
    s().importSemantics([], [createVlan(5000, 'Bad')]);
    expect(s().issues.length).toBeGreaterThan(before);
    expect(s().issues.some((i) => /5000|range/i.test(i.message))).toBe(true);
  });

  it('importObjects: a duplicate IP is flagged immediately', () => {
    const layer = s().defaultLayerId();
    s().runValidation();
    const before = s().issues.length;
    const a = createDevice('router', 0, 0, layer);
    const b = createDevice('router', 200, 0, layer);
    a.managementIp = b.managementIp = '10.0.0.1';
    s().importObjects([a, b], []);
    expect(s().issues.length).toBeGreaterThan(before);
  });
});
