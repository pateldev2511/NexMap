/** Naming rules: "every firewall is named FW-#". */
import { describe, expect, it } from 'vitest';
import { createDevice } from './schema';
import {
  createNamingRule,
  customRuleLabel,
  evaluateCustomRules,
  explainOffenders,
  findRestated,
  isCustomRuleRestorable,
  namingCanGenerate,
  namingMatcher,
  planNaming,
} from './invariants';
import { parseRuleIntent } from './ruleIntent';
import { suggestRules } from './ruleSuggest';
import { readRulesFile, writeRulesFile } from '@/io/rulesFile';
import type { Device } from './types';

const L = 'layer';
const fw = (name: string, x = 0, y = 0, role?: string) =>
  createDevice('firewall', x, y, L, { name, ...(role ? { role } : {}) });
const ctx = (devices: Device[]) => ({ devices, links: [], subnets: [] });

describe('naming templates', () => {
  it('# is a number, * is anything, the rest is literal and exact', () => {
    const fits = namingMatcher('FW-#')!;
    expect(['FW-1', 'FW-12', ' FW-3 '].every(fits)).toBe(true);
    expect(['FW-', 'fw-1', 'FW-1a', 'XFW-1', 'FW-x', ''].some(fits)).toBe(false);
    expect(namingMatcher('SW.*-#')!('SW.core-3')).toBe(true);
    expect(namingMatcher('SW.#')!('SWx1')).toBe(false); // "." is literal
    expect(namingMatcher('*-*')!('a-b-c')).toBe(true);
    expect(namingMatcher('##')!('7')).toBe(false); // each # takes at least one digit
    expect(namingMatcher('  ')).toBeNull();
  });

  it('a pathological template can’t hang the app (no backtracking)', () => {
    const fits = namingMatcher('*'.repeat(40) + 'X')!;
    const t = performance.now();
    expect(fits('a'.repeat(400))).toBe(false);
    expect(performance.now() - t).toBeLessThan(200);
  });

  it('Conductor can fill in exactly one # with no *', () => {
    expect(namingCanGenerate('FW-#')).toBe(true);
    expect(namingCanGenerate('FW-#-#')).toBe(false);
    expect(namingCanGenerate('*-#')).toBe(false);
    expect(namingCanGenerate('Edge')).toBe(false);
  });
});

describe('naming rules', () => {
  const rule = createNamingRule('firewall', 'FW-#');

  it('labels, matches by role or type, and explains', () => {
    expect(customRuleLabel(rule)).toBe('Every “firewall” is named “FW-#”');
    expect(isCustomRuleRestorable(rule)).toBe(true);
    expect(isCustomRuleRestorable(createNamingRule('firewall', 'FW-*'))).toBe(false);
    const ok = fw('FW-1');
    const bad = fw('Firewall 2');
    const blank = fw('');
    const [v] = evaluateCustomRules([rule], ctx([ok, bad, blank]));
    expect(v!.objectIds).toEqual([bad.id, blank.id]);
    expect(explainOffenders(rule.id, [bad.id, blank.id], ctx([ok, bad, blank]), [rule]).map((o) => o.reason)).toEqual([
      '“Firewall 2” doesn’t match “FW-#”',
      'blank name, not “FW-#”',
    ]);
    // A role works too ("every edge is named …").
    const edge = createNamingRule('edge', 'E-#');
    expect(evaluateCustomRules([edge], ctx([fw('X', 0, 0, 'edge')]))[0]!.objectIds).toHaveLength(1);
  });

  it('plans the next free numbers in reading order', () => {
    const one = fw('FW-1', 0, 0);
    const right = fw('Firewall', 300, 0);
    const left = fw('', 100, 0);
    const below = fw('edge box', 0, 200);
    const plan = planNaming(rule, [one, right, left, below]);
    expect(plan.renames).toEqual([
      { deviceId: left.id, name: 'FW-2' },
      { deviceId: right.id, name: 'FW-3' },
      { deviceId: below.id, name: 'FW-4' },
    ]);
    expect(planNaming(createNamingRule('firewall', 'FW-*'), [right]).renames).toEqual([]);
  });

  it('a different template is a different rule', () => {
    expect(findRestated([rule], { kind: 'naming', fromRole: 'Firewall', toRole: '', pattern: 'FW-#' })).toBe(rule);
    expect(findRestated([rule], { kind: 'naming', fromRole: 'firewall', toRole: '', pattern: 'EDGE-#' })).toBeUndefined();
  });
});

describe('naming · ⌘K, suggestions, files', () => {
  it('parses the ways people say it, keeping the template exact', () => {
    for (const text of ['every firewall is named FW-#', 'all firewalls are named like FW-#', 'firewalls named FW-#', 'name every firewall FW-#']) {
      expect(parseRuleIntent(text, [])).toEqual({ kind: 'naming', fromRole: 'firewall', target: 'FW-#', min: 0 });
    }
    expect(parseRuleIntent('every core is named "Core #"', ['core'])).toEqual({ kind: 'naming', fromRole: 'core', target: 'Core #', min: 0 });
  });

  it('suggests a template every device already follows — only as room allows', () => {
    const labels = suggestRules(ctx([fw('FW-1'), fw('FW-2')]), { invariants: new Set(), customRules: [] }).map((s) => s.label);
    expect(labels).toContain('Every “firewall” is named “FW-#”');
    const mixed = suggestRules(ctx([fw('FW-1'), fw('Edge')]), { invariants: new Set(), customRules: [] }).map((s) => s.label);
    expect(mixed.some((l) => l.includes('is named “'))).toBe(false); // (not the built-in "Every device is named")
  });

  it('round-trips through a rules file', () => {
    const r = createNamingRule('firewall', 'FW-#');
    const read = readRulesFile(writeRulesFile({ invariants: new Set(), customRules: [r] }, 'x'));
    expect(read.ok && read.customRules[0]).toMatchObject({ kind: 'naming', fromRole: 'firewall', pattern: 'FW-#' });
  });
});
