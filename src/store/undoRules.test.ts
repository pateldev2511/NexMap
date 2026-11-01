/**
 * Rule changes are undoable like any edit: declare, retract, tighten, lock in —
 * ⌘Z puts the rules back, ⌘⇧Z re-applies, and the banner says which step it was
 * (nothing on the canvas changes, so it would otherwise be invisible).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

describe('undoing rule changes', () => {
  it('declaring a built-in rule is one undo step, and redo puts it back', () => {
    s().toggleInvariant('every-device-named');
    expect(s().canUndo).toBe(true);
    s().undo();
    expect(s().invariantsEnabled.has('every-device-named')).toBe(false);
    expect(s().flash).toBe('Undid: Declare Every device is named.');
    s().redo();
    expect(s().invariantsEnabled.has('every-device-named')).toBe(true);
    expect(s().flash).toBe('Redid: Declare Every device is named.');
  });

  it('a retracted custom rule comes back with its id, and a tightened one goes back to its old minimum', () => {
    s().addCustomRule('count', 'firewall', '', 2);
    const id = s().customRules[0]!.id;
    s().setCustomRuleMin(id, 3);
    s().removeCustomRule(id);
    expect(s().customRules).toHaveLength(0);
    s().undo();
    expect(s().customRules).toEqual([expect.objectContaining({ id, min: 3 })]);
    expect(s().flash).toBe('Undid: Retract At least 3 “firewall”.');
    s().undo();
    expect(s().customRules[0]!.min).toBe(2);
    expect(s().flash).toBe('Undid: Change At least 2 “firewall” to 3.');
    s().undo();
    expect(s().customRules).toHaveLength(0);
  });

  it('rule steps and edits share one history, in order', () => {
    const fw = s().addDeviceAt('firewall', 0, 0);
    s().addCustomRule('count', 'firewall', '', 1);
    s().undo(); // the rule
    expect(s().customRules).toHaveLength(0);
    expect(s().devicesAll().some((d) => d.id === fw)).toBe(true);
    s().undo(); // the device
    expect(s().devicesAll()).toHaveLength(0);
  });

  it('undoing a rule step re-validates without the edit guard calling it a break', () => {
    s().addDeviceAt('firewall', 0, 0);
    s().runValidation();
    s().addCustomRule('count', 'firewall', '', 2); // 1 short
    s().runValidation();
    s().setCustomRuleMin(s().customRules[0]!.id, 1); // met
    s().runValidation();
    s().undo(); // back to 2: broken again — a rule change, not an edit that broke it
    s().runValidation();
    expect(s().flash).toBe('Undid: Change At least 2 “firewall” to 1.');
    expect(s().invariantViolations).toHaveLength(1);
  });

  it('opening another design clears rule steps from history', () => {
    s().toggleInvariant('every-device-named');
    s().newProject('2026-01-02T00:00:00.000Z');
    expect(s().canUndo).toBe(false);
  });
});
