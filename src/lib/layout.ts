/**
 * Auto-layout: arrange a network into a tidy layered diagram (the "tidy this
 * mess" button). Pure and standalone so it's unit-testable and never touches the
 * store or React.
 *
 * Heuristic well-suited to networks (which are mostly tree-like — core →
 * distribution → access → endpoints): for each connected component, root at the
 * highest-degree node and assign layers by BFS depth, then center each layer and
 * stack downward. Disconnected components are shelf-packed into rows so the whole
 * scene stays compact. Output is deterministic for a given input order.
 */
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutLink {
  sourceId: string;
  targetId: string;
}

export interface LayoutOptions {
  /** Horizontal gap between nodes in a layer. */
  hGap?: number;
  /** Vertical gap between layers. */
  vGap?: number;
  /** Gap between disconnected components. */
  compGap?: number;
  /** Wrap component packing to a new row past this width. */
  rowWidth?: number;
  /** Grid size to snap final coordinates to. */
  grid?: number;
  /** Margin from the origin. */
  margin?: number;
}

export function autoLayoutPositions(
  nodes: LayoutNode[],
  links: LayoutLink[],
  opts: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const hGap = opts.hGap ?? 48;
  const vGap = opts.vGap ?? 72;
  const compGap = opts.compGap ?? 80;
  const rowWidth = opts.rowWidth ?? 1400;
  const grid = opts.grid ?? 16;
  const margin = opts.margin ?? 40;

  const pos = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return pos;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Undirected adjacency (layout ignores link direction).
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const l of links) {
    if (!byId.has(l.sourceId) || !byId.has(l.targetId)) continue;
    if (l.sourceId === l.targetId) continue;
    adj.get(l.sourceId)!.add(l.targetId);
    adj.get(l.targetId)!.add(l.sourceId);
  }

  // Connected components (preserve input order for determinism).
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const comp: string[] = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      for (const m of adj.get(id)!) {
        if (!seen.has(m)) {
          seen.add(m);
          stack.push(m);
        }
      }
    }
    comp.sort(); // stable intra-component order independent of traversal
    components.push(comp);
  }

  function layoutComponent(comp: string[]): {
    local: Map<string, { x: number; y: number }>;
    w: number;
    h: number;
  } {
    const local = new Map<string, { x: number; y: number }>();
    if (comp.length === 1) {
      const n = byId.get(comp[0]!)!;
      local.set(comp[0]!, { x: 0, y: 0 });
      return { local, w: n.width, h: n.height };
    }

    // Root at the highest-degree node (deterministic tie-break by id).
    let root = comp[0]!;
    let bestDeg = -1;
    for (const id of comp) {
      const deg = adj.get(id)!.size;
      if (deg > bestDeg || (deg === bestDeg && id < root)) {
        bestDeg = deg;
        root = id;
      }
    }

    // Layer = BFS depth from the root.
    const depth = new Map<string, number>([[root, 0]]);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      for (const m of adj.get(id)!) {
        if (!depth.has(m)) {
          depth.set(m, depth.get(id)! + 1);
          queue.push(m);
        }
      }
    }
    for (const id of comp) if (!depth.has(id)) depth.set(id, 0);

    const maxDepth = Math.max(...comp.map((id) => depth.get(id)!));
    const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (const id of comp) layers[depth.get(id)!]!.push(id);

    const rowH = layers.map((layer) =>
      Math.max(...layer.map((id) => byId.get(id)!.height)),
    );
    const layerW = layers.map(
      (layer) =>
        layer.reduce((s, id) => s + byId.get(id)!.width, 0) +
        Math.max(0, layer.length - 1) * hGap,
    );
    const compW = Math.max(...layerW);

    let y = 0;
    for (let d = 0; d < layers.length; d++) {
      let x = (compW - layerW[d]!) / 2;
      for (const id of layers[d]!) {
        const n = byId.get(id)!;
        local.set(id, { x, y });
        x += n.width + hGap;
      }
      y += rowH[d]! + vGap;
    }
    return { local, w: compW, h: Math.max(0, y - vGap) };
  }

  const laid = components.map(layoutComponent);

  // Shelf-pack components into rows.
  let cursorX = 0;
  let cursorY = 0;
  let rowMaxH = 0;
  for (let i = 0; i < components.length; i++) {
    const { local, w, h } = laid[i]!;
    if (cursorX > 0 && cursorX + w > rowWidth) {
      cursorX = 0;
      cursorY += rowMaxH + compGap;
      rowMaxH = 0;
    }
    for (const [id, p] of local) pos.set(id, { x: cursorX + p.x, y: cursorY + p.y });
    cursorX += w + compGap;
    rowMaxH = Math.max(rowMaxH, h);
  }

  // Normalize to a margin and snap to grid.
  let minX = Infinity;
  let minY = Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  for (const [id, p] of pos) {
    pos.set(id, {
      x: Math.round((p.x - minX + margin) / grid) * grid,
      y: Math.round((p.y - minY + margin) / grid) * grid,
    });
  }
  return pos;
}
