import { describe, it, expect } from 'vitest';
import { deriveLinkStroke, DEFAULT_LINK_WIDTH, type StrokeHealth } from './connector';
import type { Link } from '@/model/types';

function link(partial: Partial<Link> = {}): Link {
  return { id: 'l1', kind: 'link', sourceId: 'a', targetId: 'b', layerId: 'L', ...partial };
}
const noHealth: StrokeHealth = { criticalLinkPairs: [], conflictLinkIds: [] };

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
  it('width: manual link.width drives thickness, else the default (bandwidth no longer matters)', () => {
    expect(deriveLinkStroke(link({ width: 6 }), noHealth, true).width).toBe(6);
    expect(deriveLinkStroke(link(), noHealth, true).width).toBe(DEFAULT_LINK_WIDTH);
    // bandwidth set but no manual width → still the default (thickness is slider-driven now)
    expect(deriveLinkStroke(link({ bandwidth: '100G' }), noHealth, true).width).toBe(DEFAULT_LINK_WIDTH);
  });
  it('tolerates null health', () => {
    expect(() => deriveLinkStroke(link(), null, true)).not.toThrow();
  });
});
