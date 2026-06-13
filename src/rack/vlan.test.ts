import { describe, it, expect } from 'vitest';
import { isValidVlanId, parseVlanId, vlanLabel, VLAN_MIN, VLAN_MAX } from './vlan';

describe('vlan helpers', () => {
  it('validates the 1–4094 range, rejecting reserved + non-integers', () => {
    expect(isValidVlanId(VLAN_MIN)).toBe(true);
    expect(isValidVlanId(VLAN_MAX)).toBe(true);
    expect(isValidVlanId(100)).toBe(true);
    expect(isValidVlanId(0)).toBe(false);
    expect(isValidVlanId(4095)).toBe(false);
    expect(isValidVlanId(10.5)).toBe(false);
    expect(isValidVlanId(NaN)).toBe(false);
  });

  it('parses a single id from text, undefined when blank or out of range', () => {
    expect(parseVlanId('10')).toBe(10);
    expect(parseVlanId('  20 ')).toBe(20);
    expect(parseVlanId('')).toBeUndefined();
    expect(parseVlanId('0')).toBeUndefined();
    expect(parseVlanId('5000')).toBeUndefined();
    expect(parseVlanId('abc')).toBeUndefined();
  });

  it('labels a tagged port and blanks an untagged one', () => {
    expect(vlanLabel({ vlan: 30 })).toBe('VLAN 30');
    expect(vlanLabel({})).toBe('');
  });
});
