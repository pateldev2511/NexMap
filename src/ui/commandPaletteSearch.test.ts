import { describe, expect, it } from 'vitest';
import { fuzzy, matchScore, rankCommands } from './commandPaletteSearch';

describe('matchScore', () => {
  it('scores prefix < word-start < substring < hint < subsequence', () => {
    expect(matchScore('Restore 1 declared rule', undefined, 'restore')).toBe(0);
    expect(matchScore('Retract rule: Every device is named', undefined, 'every')).toBe(1);
    expect(matchScore('Auto-address interfaces', undefined, 'address')).toBe(1); // after "-"
    expect(matchScore('Unrestored', undefined, 'restore')).toBe(2);
    expect(matchScore('Export…', '⌘E', '⌘e')).toBe(3);
    expect(matchScore('Add a redundant twin (fix a single point of failure)', undefined, 'restore')).toBe(4);
    expect(matchScore('Save', undefined, 'zzz')).toBeNull();
  });
});

describe('rankCommands', () => {
  const cmds = [
    { label: 'Add a redundant twin (fix a single point of failure)' },
    { label: 'Harden the design (twin every single point of failure)' },
    { label: 'Draw subnets to cover orphan addresses' },
    { label: 'Restore 1 declared rule' },
    { label: 'Retract rule: No single point of failure' },
  ];

  it('puts the literal match first (regression: "restore" used to rank 4th)', () => {
    expect(rankCommands(cmds, 'restore')[0]!.label).toBe('Restore 1 declared rule');
  });

  it('keeps original order within a tier and drops non-matches', () => {
    const out = rankCommands(cmds, 'single').map((c) => c.label);
    expect(out).toEqual([
      'Add a redundant twin (fix a single point of failure)',
      'Harden the design (twin every single point of failure)',
      'Retract rule: No single point of failure',
    ]);
  });

  it('returns everything, in order, for an empty query', () => {
    expect(rankCommands(cmds, '  ').map((c) => c.label)).toEqual(cmds.map((c) => c.label));
  });
});

describe('fuzzy', () => {
  it('matches in-order subsequences only', () => {
    expect(fuzzy('harden the design', 'hdd')).toBe(true);
    expect(fuzzy('harden the design', 'ddh')).toBe(false);
  });
});
