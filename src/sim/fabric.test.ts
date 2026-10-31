import { describe, it, expect } from 'vitest';
import { fabricEdges, type FabricNode } from './fabric';

const node = (id: string, x: number, y: number): FabricNode => ({ id, x, y });

/** Normalize an edge list to a comparable Set of "a|b" (endpoints are sorted). */
const key = (edges: ReadonlyArray<readonly [string, string]>) =>
  new Set(edges.map(([a, b]) => `${a}|${b}`));

describe('fabricEdges (euclidean MST)', () => {
  it('returns nothing for zero or one node', () => {
    expect(fabricEdges([])).toEqual([]);
    expect(fabricEdges([node('a', 0, 0)])).toEqual([]);
  });

  it('connects two nodes with a single edge', () => {
    expect(fabricEdges([node('a', 0, 0), node('b', 100, 0)])).toEqual([['a', 'b']]);
  });

  it('produces exactly N−1 edges and touches every node', () => {
    const nodes = [
      node('a', 0, 0),
      node('b', 50, 0),
      node('c', 100, 0),
      node('d', 150, 0),
      node('e', 200, 0),
    ];
    const edges = fabricEdges(nodes);
    expect(edges).toHaveLength(nodes.length - 1);
    const touched = new Set(edges.flat());
    expect(touched).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
  });

  it('chains a line by nearest neighbor, not across the whole span', () => {
    // A row: the tree should hop neighbor→neighbor, never skip to a far node.
    const edges = key(
      fabricEdges([node('a', 0, 0), node('b', 10, 0), node('c', 20, 0), node('d', 30, 0)]),
    );
    expect(edges).toEqual(new Set(['a|b', 'b|c', 'c|d']));
  });

  it('prefers the short diagonal in a rectangle cluster', () => {
    // Square with a near pair: a-b are close (10), the rest are 100 apart.
    const edges = key(
      fabricEdges([
        node('a', 0, 0),
        node('b', 0, 10),
        node('c', 100, 0),
        node('d', 100, 10),
      ]),
    );
    // a-b and c-d are the cheap local links; one 100-wide link bridges the pair.
    expect(edges.has('a|b')).toBe(true);
    expect(edges.has('c|d')).toBe(true);
    expect(edges.size).toBe(3);
  });

  it('is order-independent and deterministic (stable tie-breaks)', () => {
    const a = node('a', 0, 0);
    const b = node('b', 100, 0);
    const c = node('c', 200, 0);
    const forward = key(fabricEdges([a, b, c]));
    const shuffled = key(fabricEdges([c, a, b]));
    expect(shuffled).toEqual(forward);
  });

  it('is pure — does not mutate the input array', () => {
    const nodes = [node('a', 0, 0), node('b', 100, 0)];
    const snapshot = JSON.stringify(nodes);
    fabricEdges(nodes);
    expect(JSON.stringify(nodes)).toEqual(snapshot);
  });
});
