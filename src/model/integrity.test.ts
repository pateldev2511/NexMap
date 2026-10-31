import { describe, it, expect } from 'vitest';
import { planPruneDanglingLinks, planClearDanglingIfaces } from './integrity';
import { createDevice, createLink } from './schema';
import type { Device, Link } from './types';

const L = 'layer';
const dev = () => createDevice('server', 0, 0, L);
const devWithIface = (ifaceId: string): Device =>
  createDevice('switch', 0, 0, L, { interfaces: [{ id: ifaceId, name: ifaceId }] });
/** A link with the given raw endpoint ids (bypasses createLink's real-device assumption). */
const linkBetween = (sourceId: string, targetId: string): Link => ({
  ...createLink(sourceId, targetId, L),
  sourceId,
  targetId,
});

describe('planPruneDanglingLinks', () => {
  it('keeps links whose both endpoints exist', () => {
    const a = dev();
    const b = dev();
    const good = linkBetween(a.id, b.id);
    expect(planPruneDanglingLinks([a, b], [good])).toEqual([]);
  });

  it('prunes a link whose source device is missing', () => {
    const b = dev();
    const bad = linkBetween('ghost', b.id);
    expect(planPruneDanglingLinks([b], [bad])).toEqual([bad.id]);
  });

  it('prunes a link whose target device is missing', () => {
    const a = dev();
    const bad = linkBetween(a.id, 'ghost');
    expect(planPruneDanglingLinks([a], [bad])).toEqual([bad.id]);
  });

  it('prunes a link whose both endpoints are missing', () => {
    const bad = linkBetween('ghost-a', 'ghost-b');
    expect(planPruneDanglingLinks([], [bad])).toEqual([bad.id]);
  });

  it('prunes only the broken links, preserving input order', () => {
    const a = dev();
    const b = dev();
    const good = linkBetween(a.id, b.id);
    const bad1 = linkBetween(a.id, 'ghost');
    const bad2 = linkBetween('ghost', b.id);
    // Interleaved: good, bad1, bad2 → only the two bad ids, in order.
    expect(planPruneDanglingLinks([a, b], [good, bad1, bad2])).toEqual([bad1.id, bad2.id]);
  });

  it('is a no-op when there are no links', () => {
    expect(planPruneDanglingLinks([dev()], [])).toEqual([]);
  });
});

describe('planClearDanglingIfaces', () => {
  it('keeps a link whose interface reference resolves', () => {
    const a = devWithIface('if-a');
    const b = devWithIface('if-b');
    const link = createLink(a.id, b.id, L, { sourceIfaceId: 'if-a', targetIfaceId: 'if-b' });
    expect(planClearDanglingIfaces([a, b], [link])).toEqual([]);
  });

  it('clears a source ref pointing at a removed interface', () => {
    const a = devWithIface('if-a');
    const b = devWithIface('if-b');
    const link = createLink(a.id, b.id, L, { sourceIfaceId: 'gone', targetIfaceId: 'if-b' });
    expect(planClearDanglingIfaces([a, b], [link])).toEqual([
      { linkId: link.id, clearSource: true, clearTarget: false },
    ]);
  });

  it('clears a target ref pointing at a removed interface', () => {
    const a = devWithIface('if-a');
    const b = devWithIface('if-b');
    const link = createLink(a.id, b.id, L, { sourceIfaceId: 'if-a', targetIfaceId: 'gone' });
    expect(planClearDanglingIfaces([a, b], [link])).toEqual([
      { linkId: link.id, clearSource: false, clearTarget: true },
    ]);
  });

  it('clears both ends when both refs dangle on one link', () => {
    const a = devWithIface('if-a');
    const b = devWithIface('if-b');
    const link = createLink(a.id, b.id, L, { sourceIfaceId: 'x', targetIfaceId: 'y' });
    expect(planClearDanglingIfaces([a, b], [link])).toEqual([
      { linkId: link.id, clearSource: true, clearTarget: true },
    ]);
  });

  it('leaves a ref alone when the endpoint device is missing (prune handles that)', () => {
    const b = devWithIface('if-b');
    const link = createLink('ghost', b.id, L, { sourceIfaceId: 'anything', targetIfaceId: 'if-b' });
    expect(planClearDanglingIfaces([b], [link])).toEqual([]);
  });

  it('ignores links that carry no interface reference', () => {
    const a = devWithIface('if-a');
    const b = devWithIface('if-b');
    const link = createLink(a.id, b.id, L); // no sourceIfaceId / targetIfaceId
    expect(planClearDanglingIfaces([a, b], [link])).toEqual([]);
  });
});
