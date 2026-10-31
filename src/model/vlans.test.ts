import { describe, expect, it } from 'vitest';
import { createVlan } from './schema';
import { planDeduplicateVlans } from './vlans';
import type { Vlan } from './types';

const vlan = (id: string, vlanId: number): Vlan => createVlan(vlanId, `VLAN ${vlanId}`, { id });

describe('planDeduplicateVlans', () => {
  it('leaves a clean set untouched', () => {
    expect(planDeduplicateVlans([vlan('a', 10), vlan('b', 20)])).toEqual([]);
  });

  it('keeps the lowest-id VLAN and renumbers the rest to free IDs', () => {
    const plan = planDeduplicateVlans([vlan('b', 10), vlan('a', 10), vlan('c', 10)]);
    // 'a' is lowest id → keeps 10. 'b' and 'c' move to the next free valid IDs.
    expect(plan.map((p) => p.id)).toEqual(['b', 'c']);
    const nums = plan.map((p) => p.vlanId);
    expect(nums).toEqual([1, 2]); // 10 taken; smallest free valid IDs are 1, 2
    expect(new Set(nums).size).toBe(nums.length); // all distinct
  });

  it('never reuses a number already live on the board', () => {
    // 10 is duplicated; 1 and 2 are already taken, so the mover skips to 3.
    const plan = planDeduplicateVlans([
      vlan('a', 10),
      vlan('b', 10),
      vlan('c', 1),
      vlan('d', 2),
    ]);
    expect(plan).toEqual([{ id: 'b', vlanId: 3 }]);
  });

  it('resolves two independent clashing groups without collision', () => {
    const plan = planDeduplicateVlans([
      vlan('a', 5),
      vlan('b', 5),
      vlan('c', 6),
      vlan('d', 6),
    ]);
    // Keepers 'a'(5) and 'c'(6) stay; 'b' and 'd' get distinct free IDs.
    expect(plan.map((p) => p.id)).toEqual(['b', 'd']);
    const nums = plan.map((p) => p.vlanId);
    expect(new Set(nums).size).toBe(2);
    expect(nums.every((n) => n !== 5 && n !== 6)).toBe(true);
  });

  it('fixes only the duplication when the shared ID is out of range', () => {
    // Both at 0 (invalid-vlan-range). Dedupe moves one off 0; the keeper stays
    // at 0 — that remaining out-of-range value is a separate issue, not ours.
    const plan = planDeduplicateVlans([vlan('a', 0), vlan('b', 0)]);
    expect(plan).toEqual([{ id: 'b', vlanId: 1 }]);
  });
});
