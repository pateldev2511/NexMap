import { describe, it, expect } from 'vitest';
import { autoLayoutPositions, type LayoutNode, type LayoutLink } from './layout';

const n = (id: string): LayoutNode => ({ id, width: 56, height: 40 });

describe('autoLayoutPositions', () => {
  it('returns a position for every node', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(n);
    const links: LayoutLink[] = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'a', targetId: 'c' },
      { sourceId: 'b', targetId: 'd' },
    ];
    const pos = autoLayoutPositions(nodes, links);
    for (const node of nodes) expect(pos.has(node.id)).toBe(true);
  });

  it('layers by BFS depth from the highest-degree root (star → root above leaves)', () => {
    // 'hub' connects to 3 leaves → hub is the root (layer 0), leaves layer 1.
    const nodes = ['hub', 'l1', 'l2', 'l3'].map(n);
    const links: LayoutLink[] = [
      { sourceId: 'hub', targetId: 'l1' },
      { sourceId: 'hub', targetId: 'l2' },
      { sourceId: 'hub', targetId: 'l3' },
    ];
    const pos = autoLayoutPositions(nodes, links);
    const hubY = pos.get('hub')!.y;
    for (const leaf of ['l1', 'l2', 'l3']) {
      expect(pos.get(leaf)!.y).toBeGreaterThan(hubY); // leaves below the hub
    }
    // leaves share a layer (same y)
    expect(pos.get('l1')!.y).toBe(pos.get('l2')!.y);
    expect(pos.get('l2')!.y).toBe(pos.get('l3')!.y);
  });

  it('separates disconnected components (no overlap)', () => {
    const nodes = ['a', 'b', 'x', 'y'].map(n);
    const links: LayoutLink[] = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'x', targetId: 'y' },
    ];
    const pos = autoLayoutPositions(nodes, links);
    // Components are packed apart — every node has a distinct position.
    const keys = new Set([...pos.values()].map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(4);
  });

  it('is deterministic for the same input', () => {
    const nodes = ['a', 'b', 'c'].map(n);
    const links: LayoutLink[] = [{ sourceId: 'a', targetId: 'b' }];
    const p1 = autoLayoutPositions(nodes, links);
    const p2 = autoLayoutPositions(nodes, links);
    for (const node of nodes) {
      expect(p1.get(node.id)).toEqual(p2.get(node.id));
    }
  });

  it('snaps coordinates to the grid', () => {
    const pos = autoLayoutPositions(['a', 'b'].map(n), [
      { sourceId: 'a', targetId: 'b' },
    ]);
    for (const p of pos.values()) {
      expect(p.x % 16).toBe(0);
      expect(p.y % 16).toBe(0);
    }
  });

  it('handles a single node and an empty graph', () => {
    expect(autoLayoutPositions([], []).size).toBe(0);
    const one = autoLayoutPositions([n('solo')], []);
    expect(one.get('solo')).toBeDefined();
  });

  it('tolerates cycles and self-loops without looping forever', () => {
    const nodes = ['a', 'b', 'c'].map(n);
    const links: LayoutLink[] = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'b', targetId: 'c' },
      { sourceId: 'c', targetId: 'a' }, // cycle
      { sourceId: 'a', targetId: 'a' }, // self-loop
    ];
    const pos = autoLayoutPositions(nodes, links);
    expect(pos.size).toBe(3);
  });

  it('ignores links to unknown nodes', () => {
    const pos = autoLayoutPositions([n('a')], [{ sourceId: 'a', targetId: 'ghost' }]);
    expect(pos.size).toBe(1);
  });
});
