import { describe, expect, it } from 'vitest';
import { createConnectivityRule, createCountRule, createPlacementRule } from '@/model/invariants';
import { createEmptyDocument } from '@/model/schema';
import { mergeRules, readRulesFile, rulesFileName, writeRulesFile } from './rulesFile';

const set = (customRules = [createCountRule('firewall', 2)], invariants = ['no-single-point-of-failure']) => ({
  invariants: new Set(invariants),
  customRules,
});

describe('rules files', () => {
  it('round-trips: ids dropped, everything else kept', () => {
    const text = writeRulesFile(set([createCountRule('firewall', 2), createPlacementRule('camera', 'vlan 20')]), 'Boston');
    const json = JSON.parse(text);
    expect(json).toMatchObject({ format: 'nexmap-rules', version: 1, from: 'Boston' });
    expect(json.customRules[0].id).toBeUndefined();
    const read = readRulesFile(text);
    expect(read).toEqual({
      ok: true,
      source: 'rules',
      invariants: ['no-single-point-of-failure'],
      enforcedInvariants: [],
      customRules: [
        { kind: 'count', fromRole: 'firewall', toRole: '', min: 2 },
        { kind: 'placement', fromRole: 'camera', toRole: '', min: 0, subnet: 'VLAN 20' },
      ],
    });
  });

  it('takes the rules out of a whole .nexmap design', () => {
    const doc = { ...createEmptyDocument('2026-01-01T00:00:00.000Z'), invariants: ['every-device-named'], customRules: [createConnectivityRule('access', 'core', 2)] };
    const read = readRulesFile(JSON.stringify(doc));
    expect(read).toMatchObject({ ok: true, source: 'design', invariants: ['every-device-named'] });
  });

  it('says why when there is nothing to take', () => {
    expect(readRulesFile('not json')).toEqual({ ok: false, error: 'it isn’t a rules file or a NexMap design (not valid JSON)' });
    expect(readRulesFile('{"hello":1}')).toEqual({ ok: false, error: 'it isn’t a rules file or a NexMap design' });
    expect(readRulesFile(JSON.stringify(createEmptyDocument('2026-01-01T00:00:00.000Z')))).toEqual({ ok: false, error: 'that design declares no rules' });
    expect(readRulesFile('{"format":"nexmap-rules","version":9,"invariants":["x"]}')).toEqual({ ok: false, error: 'it was written by a newer NexMap — update to read it' });
    expect(readRulesFile('{"format":"nexmap-rules","version":1,"customRules":[{"kind":3}]}')).toEqual({ ok: false, error: 'the file holds no rules' });
  });

  it('names the file after the project, safely', () => {
    expect(rulesFileName('Boston site')).toBe('Boston site rules.nexrules');
    expect(rulesFileName('a/b:c')).toBe('a_b_c rules.nexrules');
    expect(rulesFileName('  ')).toBe('nexmap rules.nexrules');
  });
});

describe('mergeRules', () => {
  it('adds what is new, adopts the file’s minimum, leaves exact matches, drops nothing', () => {
    const mine = set([createCountRule('firewall', 2), createConnectivityRule('access', 'core', 1), createCountRule('router', 1)]);
    const m = mergeRules(mine, {
      invariants: ['no-single-point-of-failure', 'every-device-named'],
      customRules: [
        { kind: 'count', fromRole: 'Firewall', toRole: '', min: 3 }, // changed 2 → 3
        { kind: 'connectivity', fromRole: 'access', toRole: 'core', min: 1 }, // same
        { kind: 'placement', fromRole: 'camera', toRole: '', min: 0, subnet: 'CCTV' }, // added
      ],
    });
    expect([m.added, m.changed, m.same]).toEqual([2, 1, 2]);
    expect([...m.next.invariants].sort()).toEqual(['every-device-named', 'no-single-point-of-failure']);
    expect(m.next.customRules.map((r) => `${r.kind}:${r.fromRole}:${r.min}`)).toEqual([
      'count:firewall:3',
      'connectivity:access:1',
      'count:router:1',
      'placement:camera:0',
    ]);
    expect(m.next.customRules[0]!.id).toBe(mine.customRules[0]!.id); // the same rule, changed
    expect(new Set(m.next.customRules.map((r) => r.id)).size).toBe(4);
  });
});

describe('rules files carry enforcement', () => {
  it('writes enforced rules, reads them back, and a design’s enforced ids too', () => {
    const fw = createCountRule('firewall', 2);
    const named = createCountRule('core', 2);
    const text = writeRulesFile(
      { invariants: new Set(['no-single-point-of-failure', 'every-device-named']), customRules: [fw, named], enforced: new Set([fw.id, 'no-single-point-of-failure']) },
      'Std',
    );
    const read = readRulesFile(text);
    expect(read).toMatchObject({
      ok: true,
      enforcedInvariants: ['no-single-point-of-failure'],
      customRules: [{ fromRole: 'firewall', enforced: true }, { fromRole: 'core' }],
    });
    expect(read.ok && read.customRules[1]!.enforced).toBeUndefined();

    const doc = {
      ...createEmptyDocument('2026-01-01T00:00:00.000Z'),
      invariants: ['every-device-named'],
      customRules: [fw],
      enforcedRules: [fw.id, 'every-device-named'],
    };
    expect(readRulesFile(JSON.stringify(doc))).toMatchObject({
      enforcedInvariants: ['every-device-named'],
      customRules: [{ fromRole: 'firewall', enforced: true }],
    });
  });

  it('merging adopts the file’s enforcement and never drops local enforcement', () => {
    const mine = createCountRule('firewall', 2);
    const local = createCountRule('core', 2);
    const m = mergeRules(
      { invariants: new Set(['every-device-named']), customRules: [mine, local], enforced: new Set([local.id]) },
      {
        invariants: ['every-device-named'],
        enforcedInvariants: ['every-device-named'],
        customRules: [{ kind: 'count', fromRole: 'firewall', toRole: '', min: 2, enforced: true }],
      },
    );
    expect([...m.next.enforced].sort()).toEqual([local.id, mine.id, 'every-device-named'].sort());
    expect(m.newlyEnforced).toBe(2);
    expect([m.added, m.changed, m.same]).toEqual([0, 0, 2]);
  });
});
