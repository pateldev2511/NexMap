import { describe, it, expect } from 'vitest';
import { planPruneDanglingLinks } from './integrity';
import { createDevice, createLink } from './schema';
import type { Link } from './types';

const L = 'layer';
const dev = () => createDevice('server', 0, 0, L);
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
