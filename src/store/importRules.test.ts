/** Loading rules from a file: one undoable step that says what it did. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { writeRulesFile } from '@/io/rulesFile';
import { createCountRule } from '@/model/invariants';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

const file = writeRulesFile(
  { invariants: new Set(['every-device-named']), customRules: [createCountRule('firewall', 2)] },
  'Standard',
);

describe('importRules', () => {
  it('merges, says what happened and what is not met, and undoes in one step', () => {
    s().addDeviceAt('firewall', 0, 0);
    s().addCustomRule('count', 'firewall', '', 1);
    s().importRules(file, 'Standard rules.nexrules');
    expect(s().customRules).toHaveLength(1);
    expect(s().customRules[0]!.min).toBe(2);
    expect(s().invariantsEnabled.has('every-device-named')).toBe(true);
    expect(s().flash).toBe(
      'Loaded 2 rules from “Standard rules.nexrules”: 1 added, 1 changed to the file’s minimum — 1 not met.',
    );
    s().undo();
    expect(s().customRules[0]!.min).toBe(1);
    expect(s().invariantsEnabled.size).toBe(0);
    expect(s().flash).toBe('Undid: Import rules from “Standard rules.nexrules”.');
  });

  it('a file with nothing new changes nothing', () => {
    s().importRules(file, 'a.nexrules');
    s().importRules(file, 'a.nexrules');
    expect(s().flash).toBe('All 2 rules in “a.nexrules” are already declared.');
  });

  it('an unreadable file says why and changes nothing', () => {
    s().importRules('{}', 'photo.json');
    expect(s().flash).toBe('Couldn’t load rules from “photo.json” — it isn’t a rules file or a NexMap design.');
    expect(s().canUndo).toBe(false);
  });
});

describe('importRules · enforcement', () => {
  it('a file that only adds enforcement still applies, and says so', () => {
    s().addCustomRule('count', 'firewall', '', 2);
    const id = s().customRules[0]!.id;
    const text = writeRulesFile(
      { invariants: new Set(), customRules: [{ ...s().customRules[0]! }], enforced: new Set([id]) },
      'Std',
    );
    s().importRules(text, 'std.nexrules');
    expect(s().rulesEnforced.has(id)).toBe(true);
    expect(s().flash).toBe('Loaded 1 rule from “std.nexrules”: 1 already declared, 1 now enforced — 1 not met.');
  });
});
