/**
 * Enforced rules: an edit that would break one is taken back once it settles, with
 * a banner saying why. Undo/redo only warn. Enforcement is undoable and saved.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

/** Two firewalls, "at least 2 firewall" declared and enforced, guard settled. */
function setup() {
  const fws = [0, 1].map((i) => {
    const id = s().addDeviceAt('firewall', i * 200, 0);
    s().updateDevice(id, {}, { name: `FW${i + 1}` });
    s().endEdit();
    return id;
  });
  s().addCustomRule('count', 'firewall', '', 2);
  const ruleId = s().customRules[0]!.id;
  s().toggleEnforced(ruleId);
  s().runValidation();
  useProjectStore.setState({ flash: null });
  return { fws, ruleId };
}

describe('enforced rules', () => {
  it('a delete that would break one is taken back, and says why', () => {
    const { fws } = setup();
    s().select([fws[1]!]);
    s().deleteSelection();
    expect(s().devicesAll().map((d) => d.name).sort()).toEqual(['FW1', 'FW2']);
    expect(s().invariantViolations).toEqual([]);
    expect(s().flash).toBe(
      'Blocked: that delete would break At least 2 “firewall”, which is enforced. Stop enforcing it in the Rules tab to make this change.',
    );
    // Taken back, not parked on the redo stack.
    expect(s().canRedo).toBe(false);
  });

  it('a field edit is taken back once it settles, not mid-typing', () => {
    const { fws } = setup();
    s().updateDevice(fws[0]!, { type: 'firewall' }, { type: 'router' });
    s().runValidation(); // field still focused
    expect(s().devicesAll().find((d) => d.id === fws[0])!.type).toBe('router');
    s().endEdit();
    expect(s().devicesAll().find((d) => d.id === fws[0])!.type).toBe('firewall');
    expect(s().flash).toMatch(/^Blocked: that edit would break At least 2 “firewall”/);
  });

  it('edits that keep the rule go through; earlier history is untouched', () => {
    const { fws } = setup();
    s().updateDevice(fws[0]!, {}, { name: 'Edge A' });
    s().endEdit();
    expect(s().devicesAll().find((d) => d.id === fws[0])!.name).toBe('Edge A');
    s().select([fws[1]!]);
    s().deleteSelection(); // blocked
    expect(s().devicesAll().find((d) => d.id === fws[0])!.name).toBe('Edge A'); // only the delete went back
  });

  it('an undo that breaks it only warns', () => {
    s().addDeviceAt('firewall', 0, 0);
    s().addCustomRule('count', 'firewall', '', 1);
    s().toggleEnforced(s().customRules[0]!.id);
    s().runValidation();
    s().undo(); // un-enforce
    s().undo(); // un-declare
    s().redo(); // re-declare
    s().redo(); // re-enforce
    s().runValidation();
    expect(s().rulesEnforced.size).toBe(1);
    // Now undo past the device itself: breaks the enforced rule, but it's time travel.
    s().undo();
    s().undo();
    s().undo();
    s().runValidation();
    expect(s().devicesAll()).toHaveLength(0);
  });

  it('not enforced: the same delete goes through with a warning', () => {
    const { fws, ruleId } = setup();
    s().toggleEnforced(ruleId);
    expect(s().flash).toBe('No longer enforcing At least 2 “firewall”: edits that break it are flagged, not taken back.');
    s().select([fws[1]!]);
    s().deleteSelection();
    expect(s().devicesAll()).toHaveLength(1);
    expect(s().flash).toMatch(/^That delete broke At least 2 “firewall”/);
  });

  it('enforcing is an undo step, is dropped with its rule, and is saved with the design', () => {
    const { ruleId } = setup();
    expect(s().getDocument().enforcedRules).toEqual([ruleId]);
    s().undo();
    expect(s().rulesEnforced.has(ruleId)).toBe(false);
    s().redo();
    s().removeCustomRule(ruleId);
    expect(s().rulesEnforced.size).toBe(0);
    s().undo();
    expect(s().rulesEnforced.has(ruleId)).toBe(true);

    const doc = s().getDocument();
    s().newProject('2026-01-02T00:00:00.000Z');
    s().loadDoc(doc);
    expect([...s().rulesEnforced]).toEqual([ruleId]);
  });

  it('a built-in rule can be enforced only while declared', () => {
    s().toggleEnforced('every-device-named');
    expect(s().rulesEnforced.size).toBe(0);
    s().toggleInvariant('every-device-named');
    s().toggleEnforced('every-device-named');
    expect(s().rulesEnforced.has('every-device-named')).toBe(true);
    s().toggleInvariant('every-device-named'); // retract → no longer enforced
    expect(s().rulesEnforced.size).toBe(0);
  });
});
