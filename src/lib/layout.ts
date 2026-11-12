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
  /** Site/location to keep together (autoLayoutGrouped). Case and outer spaces ignored. */
  group?: string;
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
  /** Gap between site blocks (autoLayoutGrouped). */
  groupGap?: number;
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

/**
 * Auto-layout that keeps each group (a site) together: every group is laid out on its
 * own as a block, then the blocks are shelf-packed — most inter-site links first, so the
 * hub leads. Nodes with no group share one block. A link between sites doesn't pull
 * its ends out of their blocks, and a block's inside depends only on that block, so
 * editing one site leaves the others' arrangement alone.
 *
 * With fewer than two named groups there is nothing to keep apart: this is
 * autoLayoutPositions. Otherwise the result doesn't depend on input order.
 */
export function autoLayoutGrouped(
  nodes: LayoutNode[],
  links: LayoutLink[],
  opts: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const keyOf = (n: LayoutNode) => n.group?.trim().toLowerCase() ?? '';
  const named = new Set(nodes.map(keyOf).filter((k) => k !== ''));
  if (named.size < 2) return autoLayoutPositions(nodes, links, opts);

  const grid = opts.grid ?? 16;
  const margin = opts.margin ?? 40;
  const groupGap = opts.groupGap ?? 160;

  // '' (ungrouped) sorts last among ties.
  const byKey = (a: string, b: string) =>
    a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a < b ? -1 : 1;

  const buckets = new Map<string, LayoutNode[]>();
  const groupOfId = new Map<string, string>();
  for (const n of nodes) {
    const k = keyOf(n);
    groupOfId.set(n.id, k);
    const list = buckets.get(k);
    if (list) list.push(n);
    else buckets.set(k, [n]);
  }

  const crossLinks = new Map<string, number>();
  const linksIn = new Map<string, LayoutLink[]>();
  for (const l of links) {
    const a = groupOfId.get(l.sourceId);
    const b = groupOfId.get(l.targetId);
    if (a === undefined || b === undefined || l.sourceId === l.targetId) continue;
    if (a === b) {
      const list = linksIn.get(a);
      if (list) list.push(l);
      else linksIn.set(a, [l]);
    } else {
      crossLinks.set(a, (crossLinks.get(a) ?? 0) + 1);
      crossLinks.set(b, (crossLinks.get(b) ?? 0) + 1);
    }
  }

  const blocks = [...buckets.keys()].sort(byKey).map((key) => {
    const members = [...buckets.get(key)!].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const local = autoLayoutPositions(members, linksIn.get(key) ?? [], { ...opts, margin: 0 });
    let w = 0;
    let h = 0;
    for (const n of members) {
      const p = local.get(n.id)!;
      w = Math.max(w, p.x + n.width);
      h = Math.max(h, p.y + n.height);
    }
    return { key, local, w, h };
  });
  blocks.sort(
    (a, b) => (crossLinks.get(b.key) ?? 0) - (crossLinks.get(a.key) ?? 0) || byKey(a.key, b.key),
  );

  const area = blocks.reduce((s, b) => s + b.w * b.h, 0);
  const rowWidth = Math.max(opts.rowWidth ?? 0, Math.ceil(Math.sqrt(area)) * 1.3);

  // Shelf-pack. Block origins sit on the grid so the final snap moves every node by
  // the same amount and a block's inside survives it.
  const onGrid = (v: number) => Math.ceil(v / grid) * grid;
  const pos = new Map<string, { x: number; y: number }>();
  let cursorX = 0;
  let cursorY = 0;
  let rowMaxH = 0;
  for (const b of blocks) {
    if (cursorX > 0 && cursorX + b.w > rowWidth) {
      cursorX = 0;
      cursorY = onGrid(cursorY + rowMaxH + groupGap);
      rowMaxH = 0;
    }
    for (const [id, p] of b.local) pos.set(id, { x: cursorX + p.x, y: cursorY + p.y });
    cursorX = onGrid(cursorX + b.w + groupGap);
    rowMaxH = Math.max(rowMaxH, b.h);
  }

  // Normalize to a margin and snap to grid, as autoLayoutPositions does.
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
