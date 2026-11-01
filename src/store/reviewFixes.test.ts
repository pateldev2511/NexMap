/**
 * Regression tests for the pre-landing review of the Conductor rules batch: damaged
 * files, unbounded minimums, duplicate rules, and edits the rule guard hadn't judged.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { createEmptyDocument } from '@/model/schema';
import { MAX_RULE_MIN } from '@/model/invariants';
import { mergeRules, readRulesFile } from '@/io/rulesFile';
import { parseRuleIntent } from '@/model/ruleIntent';
import type { NexMapDocument } from '@/model/types';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

describe('a damaged .nexmap loads cleanly', () => {
  it('bad rule fields are dropped, not thrown halfway through loading', () => {
    const doc = {
      ...createEmptyDocument('2026-01-01T00:00:00.000Z'),
      project: { ...createEmptyDocument('2026-01-01T00:00:00.000Z').project, name: 'Damaged' },
      invariants: ['every-device-named', 7, null],
      customRules: [
        { id: 'ok', kind: 'count', fromRole: 'core', toRole: '', min: 2 },
        { kind: 'naming', fromRole: 'firewall', pattern: 'FW-#', min: 0 }, // no id: minted
        { id: 'bad', kind: 'placement', fromRole: 5, subnet: {} }, // not a rule
        'nonsense',
      ],
      enforcedRules: 'ok',
    } as unknown as NexMapDocument;
    expect(() => s().loadDoc(doc)).not.toThrow();
    expect(s().projectName).toBe('Damaged');
    expect([...s().invariantsEnabled]).toEqual(['every-device-named']);
    expect(s().customRules.map((r) => r.kind)).toEqual(['count', 'naming']);
    expect(s().customRules[1]!.id).toBeTruthy();
    expect(s().rulesEnforced.size).toBe(0); // "ok" as a bare string isn't a list
  });
});

describe('rule minimums stay sane', () => {
  it('files, the form and ⌘K can’t ask for 20000 firewalls', () => {
    const read = readRulesFile(
      JSON.stringify({ format: 'nexmap-rules', version: 1, invariants: [], customRules: [{ kind: 'count', fromRole: 'firewall', min: 20000 }, { kind: 'count', fromRole: 'core', min: 2.6 }] }),
    );
    expect(read.ok && read.customRules.map((r) => r.min)).toEqual([MAX_RULE_MIN, 3]);
    s().addCustomRule('count', 'firewall', '', 1e9);
    expect(s().customRules[0]!.min).toBe(MAX_RULE_MIN);
    s().setCustomRuleMin(s().customRules[0]!.id, 2);
    expect(s().customRules[0]!.min).toBe(2);
    expect(parseRuleIntent('at least 20000 firewalls', [])).toBeNull();
  });

  it('a "vlan20" in a file is the same rule as a declared "VLAN 20"', () => {
    s().addCustomRule('placement', 'camera', 'VLAN 20', 0);
    const read = readRulesFile(
      JSON.stringify({ format: 'nexmap-rules', version: 1, invariants: [], customRules: [{ kind: 'placement', fromRole: 'camera', subnet: 'vlan20' }] }),
    );
    const m = mergeRules({ invariants: new Set(), customRules: s().customRules }, read.ok ? read : { invariants: [], customRules: [] });
    expect([m.added, m.same]).toEqual([0, 1]);
  });
});

describe('the same rule twice is one rule', () => {
  it('placement, isolation and naming duplicates say "already declared"', () => {
    s().addCustomRule('placement', 'camera', 'vlan 20', 0);
    s().addCustomRule('placement', 'camera', 'VLAN 20', 0);
    s().addCustomRule('isolation', 'guest', 'core', 0);
    s().addCustomRule('isolation', 'guest', 'core', 0);
    s().addCustomRule('naming', 'firewall', 'FW-#', 0);
    s().addCustomRule('naming', 'firewall', 'FW-#', 0);
    expect(s().customRules).toHaveLength(3);
    expect(s().flash).toBe('Every “firewall” is named “FW-#” is already declared.');
    s().addCustomRule('naming', 'firewall', 'EDGE-#', 0); // a different standard is a different rule
    expect(s().customRules).toHaveLength(4);
  });
});

describe('the rule guard judges a pending edit before re-baselining', () => {
  it('a delete right after an unvalidated breaking edit still blocks that edit', () => {
    const fw1 = s().addDeviceAt('firewall', 0, 0);
    const fw2 = s().addDeviceAt('firewall', 200, 0);
    const sw = s().addDeviceAt('switch', 400, 0);
    s().addCustomRule('count', 'firewall', '', 2);
    s().toggleEnforced(s().customRules[0]!.id);
    s().runValidation();
    // Change FW2 into a router — breaks the enforced rule — and delete the switch
    // before the debounced validation runs.
    s().updateDevice(fw2, { type: 'firewall' }, { type: 'router' });
    // (no blur: the delete's own boundary closes the edit)
    s().select([sw]);
    s().deleteSelection();
    expect(s().devicesAll().find((d) => d.id === fw2)!.type).toBe('firewall'); // taken back
    expect(s().devicesAll().some((d) => d.id === sw)).toBe(false); // the delete itself went through
    expect(s().devicesAll().some((d) => d.id === fw1)).toBe(true);
  });
});
