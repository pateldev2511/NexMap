import { describe, it, expect } from 'vitest';
import {
  bandwidthToWidth,
  deriveLinkStroke,
  DEFAULT_LINK_WIDTH,
  type StrokeHealth,
} from './connector';
import type { Link } from '@/model/types';

function link(partial: Partial<Link> = {}): Link {
  return { id: 'l1', kind: 'link', sourceId: 'a', targetId: 'b', layerId: 'L', ...partial };
}
const noHealth: StrokeHealth = { criticalLinkPairs: [], conflictLinkIds: [] };

describe('bandwidthToWidth', () => {
  it('scales by Gbps', () => {
    expect(bandwidthToWidth('1G')).toBeCloseTo(2.0, 1); // 1.5 + 0 + 0.5
    expect(bandwidthToWidth('10G')).toBeGreaterThan(bandwidthToWidth('1G'));
    expect(bandwidthToWidth('100G')).toBeGreaterThan(bandwidthToWidth('10G'));
    expect(bandwidthToWidth('400G')).toBeGreaterThanOrEqual(bandwidthToWidth('100G'));
  });
  it('handles M and T units and is case/space-insensitive', () => {
    expect(bandwidthToWidth('100M')).toBeLessThan(bandwidthToWidth('1G'));
    expect(bandwidthToWidth(' 10g ')).toBe(bandwidthToWidth('10G'));
    expect(bandwidthToWidth('1T')).toBeLessThanOrEqual(6);
  });
  it('clamps to [1, 6]', () => {
    expect(bandwidthToWidth('999999G')).toBeLessThanOrEqual(6);
    expect(bandwidthToWidth('0.001G')).toBeGreaterThanOrEqual(1);
  });
  it('returns the default for empty/garbage, never throws', () => {
    expect(bandwidthToWidth(undefined)).toBe(DEFAULT_LINK_WIDTH);
    expect(bandwidthToWidth('')).toBe(DEFAULT_LINK_WIDTH);
    expect(bandwidthToWidth('fast')).toBe(DEFAULT_LINK_WIDTH);
    expect(() => bandwidthToWidth('!@#')).not.toThrow();
  });
});

describe('deriveLinkStroke — precedence', () => {
  it('manual color wins over health', () => {
    const s = deriveLinkStroke(link({ color: '#123456' }), { criticalLinkPairs: ['a|b'], conflictLinkIds: ['l1'] }, true);
    expect(s.color).toBe('#123456');
  });
  it('conflict → red when no manual color', () => {
    expect(deriveLinkStroke(link(), { criticalLinkPairs: [], conflictLinkIds: ['l1'] }, true).color).toBe('#dc2626');
  });
  it('critical bridge → amber, but only when sole member', () => {
    expect(deriveLinkStroke(link(), { criticalLinkPairs: ['a|b'], conflictLinkIds: [] }, true).color).toBe('#d97706');
    // parallel member (not sole) → not amber
    expect(deriveLinkStroke(link(), { criticalLinkPairs: ['a|b'], conflictLinkIds: [] }, false).color).not.toBe('#d97706');
  });
  it('normal link → null (surface default)', () => {
    expect(deriveLinkStroke(link(), noHealth, true).color).toBeNull();
  });
  it('dash is independent: inferred → dashed even with manual color', () => {
    const s = deriveLinkStroke(link({ color: '#fff', inferred: true }), noHealth, true);
    expect(s.color).toBe('#fff');
    expect(s.dashed).toBe(true);
  });
  it('style dashed honored when not inferred', () => {
    expect(deriveLinkStroke(link({ style: 'dashed' }), noHealth, true).dashed).toBe(true);
    expect(deriveLinkStroke(link({ style: 'solid' }), noHealth, true).dashed).toBe(false);
  });
  it('width: manual override wins, else bandwidth-derived', () => {
    expect(deriveLinkStroke(link({ width: 9 }), noHealth, true).width).toBe(9);
    expect(deriveLinkStroke(link({ bandwidth: '100G' }), noHealth, true).width).toBeGreaterThan(DEFAULT_LINK_WIDTH);
  });
  it('tolerates null health', () => {
    expect(() => deriveLinkStroke(link(), null, true)).not.toThrow();
  });
});
