/** "Apply all" quick fixes: re-planned one by one, one undo step, locks respected. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});
const add = (role: string, name: string) => {
  const id = s().addDeviceAt('switch', 0, 0);
  s().updateDevice(id, {}, { role, name });
  s().endEdit();
  return id;
};
const pairs = () => {
  const n = new Map(s().devicesAll().map((d) => [d.id, d.name]));
  return s().linksAll().map((l) => [n.get(l.sourceId), n.get(l.targetId)].sort().join('–')).sort();
};

describe('applyAllRuleFixes', () => {
  it('draws every missing uplink and cuts every breach, spread over the cores, as one undo', () => {
    const c1 = add('core', 'C1');
    add('core', 'C2');
    const c3 = add('core', 'C3');
    const a1 = add('access', 'A1');
    const a2 = add('access', 'A2');
    const g = add('guest', 'G');
    s().connect(a1, c1);
    s().connect(a2, c1);
    s().connect(g, c3);
    s().connect(g, c1); // the guest leaks onto C1
    s().addCustomRule('connectivity', 'access', 'core', 2);
    s().addCustomRule('isolation', 'guest', 'access', 0);
    s().runValidation();
    const before = pairs();

    expect(s().applyAllRuleFixes()).toBe(3);
    expect(s().invariantViolations).toEqual([]);
    // A1 → C2 first (least loaded); A2 then still has C2 as the safe choice — never
    // C3, the guest's core.
    expect(pairs()).toEqual(['A1–C1', 'A1–C2', 'A2–C1', 'A2–C2', 'C3–G']);
    expect(s().flash).toMatch(/^Applied 3 fixes: cut G–C1; connected A1 to C2; connected A2 to C2\. Every declared rule is met\. ⌘Z undoes all of it\.$/);

    s().undo();
    expect(pairs()).toEqual(before);
  });

  it('nothing to apply says why', () => {
    add('access', 'A1');
    s().addCustomRule('connectivity', 'access', 'core', 1); // no core exists: no fix to suggest
    s().runValidation();
    expect(s().applyAllRuleFixes()).toBe(0);
    expect(s().flash).toBe('No quick fixes to apply — the broken rules need a choice Conductor won’t make for you.');
  });
});

describe('applyAllRuleFixes · locks', () => {
  it('leaves a breach whose link sits on a locked layer, and still makes the other fixes', () => {
    const c1 = add('core', 'C1');
    add('core', 'C2');
    const a1 = add('access', 'A1');
    const g = add('guest', 'G');
    s().connect(a1, c1);
    const leak = s().connect(g, c1)!;
    // Move the leaking link to a locked layer.
    const layer = s().addLayer();
    s().updateLink(leak, {}, { layerId: layer });
    s().endEdit();
    s().setLayerLocked(layer, true);
    s().addCustomRule('connectivity', 'access', 'core', 2);
    s().addCustomRule('isolation', 'guest', 'access', 0);
    s().runValidation();

    expect(s().applyAllRuleFixes()).toBe(1); // just the A1 uplink
    expect(s().linksAll().some((l) => l.id === leak)).toBe(true);
    expect(s().flash).toMatch(/^Applied 1 fix: connected A1 to C2\. 1 rule still not met\./);
  });
});
