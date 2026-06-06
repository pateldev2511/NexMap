import { describe, it, expect } from 'vitest';
import { analyzeHealth, articulationPoints, edgeDisjointPaths } from './health';
import type { Device, Link } from '@/model/types';

let n = 0;
function dev(id: string): Device {
  return { id, kind: 'device', type: 'generic', name: id, x: 0, y: 0, width: 56, height: 40, layerId: 'L' };
}
function link(sourceId: string, targetId: string, extra: Partial<Link> = {}): Link {
  return { id: `l${n++}`, kind: 'link', sourceId, targetId, layerId: 'L', ...extra };
}
/** Build adjacency directly for the articulationPoints unit. */
function adjOf(edges: [string, string][]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
  for (const [a, b] of edges) {
    add(a, b);
    add(b, a);
  }
  return m;
}

describe('articulationPoints', () => {
  it('finds the cut vertex in a chain A-B-C', () => {
    const cut = articulationPoints(adjOf([['A', 'B'], ['B', 'C']]));
    expect([...cut]).toEqual(['B']);
  });

  it('finds none in a triangle (fully redundant)', () => {
    const cut = articulationPoints(adjOf([['A', 'B'], ['B', 'C'], ['C', 'A']]));
    expect(cut.size).toBe(0);
  });

  it('identifies the hub in a star', () => {
    const cut = articulationPoints(adjOf([['H', 'A'], ['H', 'B'], ['H', 'C']]));
    expect([...cut]).toEqual(['H']);
  });

  it('does not overflow on a long chain (iterative)', () => {
    const edges: [string, string][] = [];
    for (let i = 0; i < 5000; i++) edges.push([`n${i}`, `n${i + 1}`]);
    const cut = articulationPoints(adjOf(edges));
    // every interior node is a cut vertex; endpoints are not
    expect(cut.has('n0')).toBe(false);
    expect(cut.has('n2500')).toBe(true);
    expect(cut.size).toBe(4999);
  });
});

describe('analyzeHealth — critical links (bridges)', () => {
  it('flags the single link in a chain as a critical pair', () => {
    const devices = ['A', 'B', 'C'].map(dev);
    const r = analyzeHealth(devices, [link('A', 'B'), link('B', 'C')]);
    expect(r.criticalLinkPairs.sort()).toEqual(['A|B', 'B|C']);
  });
  it('a redundant ring has no critical links', () => {
    const devices = ['A', 'B', 'C'].map(dev);
    const r = analyzeHealth(devices, [link('A', 'B'), link('B', 'C'), link('C', 'A')]);
    expect(r.criticalLinkPairs).toEqual([]);
  });
  it('parallel links between a pair are NOT critical (alternate path exists)', () => {
    const devices = ['A', 'B'].map(dev);
    const r = analyzeHealth(devices, [link('A', 'B'), link('A', 'B')]);
    expect(r.criticalLinkPairs).toEqual([]);
  });
  it('exposes conflict link ids', () => {
    const devices = ['A', 'B'].map(dev);
    const r = analyzeHealth(devices, [link('A', 'B', { vlan: '10' }), link('A', 'B', { vlan: '20' })]);
    expect(r.conflictLinkIds.length).toBe(2);
  });
});

describe('analyzeHealth — SPOF', () => {
  it('flags the middle device of a chain as a SPOF', () => {
    const devices = ['A', 'B', 'C'].map(dev);
    const r = analyzeHealth(devices, [link('A', 'B'), link('B', 'C')]);
    expect(r.spofIds).toEqual(['B']);
    expect(r.issues.some((i) => i.code === 'spof' && i.objectIds[0] === 'B')).toBe(true);
    expect(r.score).toBeLessThan(100);
  });

  it('a redundant ring has no SPOF and a perfect score', () => {
    const devices = ['A', 'B', 'C'].map(dev);
    const r = analyzeHealth(devices, [link('A', 'B'), link('B', 'C'), link('C', 'A')]);
    expect(r.spofIds).toEqual([]);
    expect(r.score).toBe(100);
  });
});

describe('analyzeHealth — fragmentation', () => {
  it('reports multiple disconnected segments', () => {
    const devices = ['A', 'B', 'C', 'D'].map(dev);
    const r = analyzeHealth(devices, [link('A', 'B'), link('C', 'D')]);
    expect(r.componentCount).toBe(2);
    expect(r.issues.some((i) => i.code === 'fragmented-topology')).toBe(true);
  });

  it('ignores fully isolated devices for component count', () => {
    const devices = ['A', 'B', 'Iso'].map(dev);
    const r = analyzeHealth(devices, [link('A', 'B')]);
    expect(r.componentCount).toBe(1);
  });
});

describe('analyzeHealth — conflicting parallel links', () => {
  it('flags parallel links with differing VLANs', () => {
    const devices = ['A', 'B'].map(dev);
    const r = analyzeHealth(devices, [
      link('A', 'B', { vlan: '10' }),
      link('A', 'B', { vlan: '20' }),
    ]);
    expect(r.issues.some((i) => i.code === 'conflicting-parallel-links')).toBe(true);
  });

  it('does not flag matching parallel links', () => {
    const devices = ['A', 'B'].map(dev);
    const r = analyzeHealth(devices, [
      link('A', 'B', { vlan: '10' }),
      link('A', 'B', { vlan: '10' }),
    ]);
    expect(r.issues.some((i) => i.code === 'conflicting-parallel-links')).toBe(false);
  });
});

describe('analyzeHealth — scan-derived caveat', () => {
  it('adds a caveat when any link is inferred', () => {
    const devices = ['A', 'B'].map(dev);
    const r = analyzeHealth(devices, [link('A', 'B', { inferred: true })]);
    expect(r.scanDerived).toBe(true);
    expect(r.issues.some((i) => i.code === 'scan-derived-topology')).toBe(true);
  });
});

describe('edgeDisjointPaths', () => {
  it('returns 1 for a single chain', () => {
    const devices = ['A', 'B', 'C'].map(dev);
    expect(edgeDisjointPaths(devices, [link('A', 'B'), link('B', 'C')], 'A', 'C')).toBe(1);
  });

  it('returns 2 for a ring (two ways round)', () => {
    const devices = ['A', 'B', 'C', 'D'].map(dev);
    const ring = [link('A', 'B'), link('B', 'C'), link('C', 'D'), link('D', 'A')];
    expect(edgeDisjointPaths(devices, ring, 'A', 'C')).toBe(2);
  });

  it('returns 0 when there is no path', () => {
    const devices = ['A', 'B', 'C'].map(dev);
    expect(edgeDisjointPaths(devices, [link('A', 'B')], 'A', 'C')).toBe(0);
  });

  it('counts parallel links as separate disjoint paths', () => {
    const devices = ['A', 'B'].map(dev);
    expect(edgeDisjointPaths(devices, [link('A', 'B'), link('A', 'B')], 'A', 'B')).toBe(2);
  });
});
