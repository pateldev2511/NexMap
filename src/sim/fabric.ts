/**
 * Lasso-to-fabric — turn a scatter of selected devices into one connected fabric.
 *
 * You drop a pile of devices, lasso them, and "weave": every selected device is
 * joined into a single connected graph with the fewest, shortest wires — a
 * euclidean Minimum Spanning Tree over their centers. N devices become N−1 clean
 * links, no cycles, no crossings-by-construction-greed, fully deterministic.
 *
 * Honest scope: this is a geometric spanning tree, not a routing or capacity
 * decision. It connects what you picked by proximity; it does not choose roles or
 * add redundancy. Pure and canvas-free so it is unit-testable in isolation.
 */

export interface FabricNode {
  id: string;
  /** Center point (canvas coords). */
  x: number;
  y: number;
}

/** An undirected edge between two node ids, nearest-first by construction. */
export type FabricEdge = readonly [string, string];

/**
 * Euclidean MST (Prim's) over the node centers. Returns N−1 edges connecting all
 * nodes, or [] for fewer than two nodes. Ties broken by id so the result is
 * stable across runs regardless of input order.
 */
export function fabricEdges(nodes: readonly FabricNode[]): FabricEdge[] {
  if (nodes.length < 2) return [];

  // Deterministic order: sort a copy by id so Prim's tie-breaks are stable.
  const ns = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = ns.length;
  const inTree = new Array<boolean>(n).fill(false);
  // Best known distance (squared) from the growing tree to each outside node,
  // and which in-tree node that best edge attaches to.
  const best = new Array<number>(n).fill(Infinity);
  const parent = new Array<number>(n).fill(-1);

  const d2 = (a: FabricNode, b: FabricNode) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  };

  best[0] = 0;
  const edges: FabricEdge[] = [];

  for (let iter = 0; iter < n; iter++) {
    // Pick the closest not-yet-connected node (ties → lowest index, i.e. lowest id).
    let u = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      // i, v, u are all loop indices in [0, n); the fixed-length arrays are
      // defined at every such index, so the non-null assertions are sound (the
      // build's noUncheckedIndexedAccess just can't see it).
      if (!inTree[i] && best[i]! < bestD) {
        bestD = best[i]!;
        u = i;
      }
    }
    if (u === -1) break; // disconnected guard (can't happen for a complete graph)
    inTree[u] = true;
    const nu = ns[u]!;
    const pu = parent[u]!;
    if (pu !== -1) {
      const a = ns[pu]!.id;
      const b = nu.id;
      edges.push(a < b ? [a, b] : [b, a]);
    }
    // Relax distances to the remaining outside nodes through the newly added u.
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const dist = d2(nu, ns[v]!);
      if (dist < best[v]!) {
        best[v] = dist;
        parent[v] = u;
      }
    }
  }

  return edges;
}
