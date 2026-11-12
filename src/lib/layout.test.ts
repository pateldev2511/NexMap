import { describe, it, expect } from 'vitest';
import { autoLayoutGrouped, autoLayoutPositions, type LayoutNode, type LayoutLink } from './layout';

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

describe('autoLayoutGrouped', () => {
  const g = (id: string, group?: string): LayoutNode => ({ id, width: 56, height: 40, group });
  const link = (sourceId: string, targetId: string): LayoutLink => ({ sourceId, targetId });
  type Pos = Map<string, { x: number; y: number }>;
  type Box = { x0: number; y0: number; x1: number; y1: number };

  function box(nodes: LayoutNode[], pos: Pos): Box {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const node of nodes) {
      const p = pos.get(node.id)!;
      b.x0 = Math.min(b.x0, p.x);
      b.y0 = Math.min(b.y0, p.y);
      b.x1 = Math.max(b.x1, p.x + node.width);
      b.y1 = Math.max(b.y1, p.y + node.height);
    }
    return b;
  }
  const disjoint = (a: Box, b: Box) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
  const byGroup = (nodes: LayoutNode[]) => {
    const m = new Map<string, LayoutNode[]>();
    for (const node of nodes) m.set(node.group ?? '', [...(m.get(node.group ?? '') ?? []), node]);
    return m;
  };
  /** A site's node positions relative to its own top-left corner. */
  function inside(nodes: LayoutNode[], pos: Pos): Record<string, { x: number; y: number }> {
    const b = box(nodes, pos);
    return Object.fromEntries(nodes.map((node) => [node.id, { x: pos.get(node.id)!.x - b.x0, y: pos.get(node.id)!.y - b.y0 }]));
  }
  /** Deterministic shuffle (LCG) so a failure reproduces. */
  function shuffled<T>(list: T[], seed: number): T[] {
    const out = [...list];
    let s = seed;
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** HQ, DR and eight branches, all joined into ONE component by two ungrouped WAN nodes. */
  function tenSites(): { nodes: LayoutNode[]; links: LayoutLink[] } {
    const nodes: LayoutNode[] = [g('wan-1'), g('wan-2')];
    const links: LayoutLink[] = [link('wan-1', 'wan-2')];
    const site = (name: string, access: number, hosts: number) => {
      const id = (x: string) => `${name}-${x}`;
      nodes.push(g(id('fw'), name), g(id('core-1'), name), g(id('core-2'), name));
      links.push(link(id('fw'), 'wan-1'), link(id('fw'), 'wan-2'));
      links.push(link(id('fw'), id('core-1')), link(id('fw'), id('core-2')), link(id('core-1'), id('core-2')));
      for (let a = 0; a < access; a++) {
        nodes.push(g(id(`acc-${a}`), name));
        links.push(link(id('core-1'), id(`acc-${a}`)), link(id('core-2'), id(`acc-${a}`)));
        for (let h = 0; h < hosts; h++) {
          nodes.push(g(id(`h-${a}-${h}`), name));
          links.push(link(id(`acc-${a}`), id(`h-${a}-${h}`)));
        }
      }
    };
    site('HQ', 4, 4);
    site('DR', 3, 3);
    for (let b = 1; b <= 8; b++) site(`Branch ${b}`, 1, 3);
    links.push(link('HQ-core-1', 'DR-core-1'), link('HQ-core-2', 'DR-core-2')); // redundant HQ↔DR
    return { nodes, links };
  }

  it('keeps each group in its own box: the boxes are pairwise disjoint', () => {
    const { nodes, links } = tenSites();
    const pos = autoLayoutGrouped(nodes, links);
    expect(pos.size).toBe(nodes.length);
    const boxes = [...byGroup(nodes).values()].map((members) => box(members, pos));
    expect(boxes).toHaveLength(11); // ten sites + the ungrouped WAN block
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(disjoint(boxes[i]!, boxes[j]!)).toBe(true);
    }
    // Plain auto-layout scatters the one big component's sites across BFS layers.
    const plain = autoLayoutPositions(nodes, links);
    const plainBoxes = [...byGroup(nodes).values()].map((members) => box(members, plain));
    expect(plainBoxes.some((a, i) => plainBoxes.some((b, j) => i < j && !disjoint(a, b)))).toBe(true);
  });

  it('no two nodes overlap in the ten-site fixture', () => {
    const { nodes, links } = tenSites();
    const pos = autoLayoutGrouped(nodes, links);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(disjoint(box([nodes[i]!], pos), box([nodes[j]!], pos))).toBe(true);
      }
    }
  });

  it('is plain auto-layout when there are fewer than two named groups', () => {
    const { nodes, links } = tenSites();
    const none = nodes.map((node) => ({ ...node, group: undefined }));
    const one = nodes.map((node) => ({ ...node, group: node.group ? ' Campus ' : '  ' }));
    const sameButForCase = nodes.map((node, i) => ({ ...node, group: i % 2 ? 'hq' : ' HQ ' }));
    for (const variant of [none, one, sameButForCase]) {
      expect(autoLayoutGrouped(variant, links, { rowWidth: 900 })).toEqual(
        autoLayoutPositions(variant, links, { rowWidth: 900 }),
      );
    }
    expect(autoLayoutGrouped([], [])).toEqual(new Map());
  });

  it('does not depend on input order', () => {
    const { nodes, links } = tenSites();
    const want = autoLayoutGrouped(nodes, links);
    for (const seed of [1, 2, 3]) {
      const got = autoLayoutGrouped(shuffled(nodes, seed), shuffled(links, seed + 10));
      expect(Object.fromEntries(got)).toEqual(Object.fromEntries(want));
    }
  });

  it('treats group names that differ only in case or outer spaces as one site', () => {
    const nodes = [g('a', 'HQ'), g('b', ' hq '), g('c', 'DR'), g('d', 'dr')];
    const pos = autoLayoutGrouped(nodes, [link('a', 'c'), link('b', 'd')]);
    expect(disjoint(box([nodes[0]!, nodes[1]!], pos), box([nodes[2]!, nodes[3]!], pos))).toBe(true);
  });

  it('puts the site with the most inter-site links first', () => {
    const nodes = [g('a1', 'Alpha'), g('a2', 'Alpha'), g('h1', 'Hub'), g('h2', 'Hub'), g('z1', 'Zeta'), g('z2', 'Zeta')];
    const links = [link('a1', 'a2'), link('h1', 'h2'), link('z1', 'z2'), link('h1', 'a1'), link('h1', 'z1')];
    const pos = autoLayoutGrouped(nodes, links, { rowWidth: 5000 });
    const x = (ids: number[]) => box(ids.map((i) => nodes[i]!), pos).x0;
    expect(x([2, 3])).toBeLessThan(x([0, 1])); // Hub before Alpha…
    expect(x([0, 1])).toBeLessThan(x([4, 5])); // …and ties fall back to name order
  });

  it('applies the margin and grid once, like plain auto-layout', () => {
    const { nodes, links } = tenSites();
    const pos = autoLayoutGrouped(nodes, links, { margin: 64, grid: 32 });
    const all = box(nodes, pos);
    expect([all.x0, all.y0]).toEqual([64, 64]);
    for (const p of pos.values()) expect([p.x % 32, p.y % 32]).toEqual([0, 0]);
  });

  it('adding a node to one site leaves every other site arranged as it was', () => {
    const { nodes, links } = tenSites();
    const before = autoLayoutGrouped(nodes, links);
    const after = autoLayoutGrouped(
      [...nodes, g('Branch 3-printer', 'Branch 3')],
      [...links, link('Branch 3-acc-0', 'Branch 3-printer')],
    );
    for (const [name, members] of byGroup(nodes)) {
      if (name === 'Branch 3') continue;
      expect(inside(members, after)).toEqual(inside(members, before));
    }
  });
});
