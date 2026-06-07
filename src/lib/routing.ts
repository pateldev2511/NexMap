/**
 * Obstacle-avoiding orthogonal connector routing.
 *
 * `avoidRoute` runs A* on a coarse grid between two points, treating device
 * rectangles as blocked, and returns a right-angle polyline that routes *around*
 * them instead of straight through. Pure and bounded: if the region is too large
 * for the grid budget it returns `null`, and the caller falls back to a straight
 * line. It's invoked on demand (a "reroute" action stores the result as
 * waypoints), never per frame.
 */

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RouteOpts {
  /** Grid cell size in px. Smaller = finer routes, more cells. */
  cell?: number;
  /** Clearance kept around obstacles, in px. */
  margin?: number;
  /** Abort (return null) if the grid would exceed this many cells. */
  maxCells?: number;
  /** Extra cost per 90° turn, so routes prefer long straight runs. */
  turnPenalty?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Right-angle path from `a` to `b` avoiding `obstacles`. Includes both endpoints.
 * Returns `null` if no route fits the grid budget (caller should fall back).
 */
export function avoidRoute(
  a: Pt,
  b: Pt,
  obstacles: Rect[],
  opts: RouteOpts = {},
): Pt[] | null {
  const cell = opts.cell ?? 14;
  const margin = opts.margin ?? 12;
  const maxCells = opts.maxCells ?? 20000;
  const turnPenalty = opts.turnPenalty ?? 3;

  const pad = cell * 2 + margin;
  let minX = Math.min(a.x, b.x);
  let minY = Math.min(a.y, b.y);
  let maxX = Math.max(a.x, b.x);
  let maxY = Math.max(a.y, b.y);
  for (const o of obstacles) {
    minX = Math.min(minX, o.x);
    minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + o.width);
    maxY = Math.max(maxY, o.y + o.height);
  }
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const cols = Math.ceil((maxX - minX) / cell) + 1;
  const rows = Math.ceil((maxY - minY) / cell) + 1;
  if (cols < 2 || rows < 2 || cols * rows > maxCells) return null;

  const gx = (x: number) => clamp(Math.round((x - minX) / cell), 0, cols - 1);
  const gy = (y: number) => clamp(Math.round((y - minY) / cell), 0, rows - 1);
  const wx = (cx: number) => minX + cx * cell;
  const wy = (cy: number) => minY + cy * cell;
  const idx = (cx: number, cy: number) => cy * cols + cx;

  // Block cells whose center falls inside an inflated obstacle.
  const blocked = new Uint8Array(cols * rows);
  for (const o of obstacles) {
    const x0 = gx(o.x - margin);
    const y0 = gy(o.y - margin);
    const x1 = gx(o.x + o.width + margin);
    const y1 = gy(o.y + o.height + margin);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) blocked[idx(cx, cy)] = 1;
  }

  const start = { x: gx(a.x), y: gy(a.y) };
  const goal = { x: gx(b.x), y: gy(b.y) };
  // Endpoints may sit inside their own device — never block them.
  blocked[idx(start.x, start.y)] = 0;
  blocked[idx(goal.x, goal.y)] = 0;

  const N = cols * rows;
  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const dir = new Int8Array(N).fill(-1); // 0=h,1=v incoming direction
  const closed = new Uint8Array(N);
  const startI = idx(start.x, start.y);
  const goalI = idx(goal.x, goal.y);
  g[startI] = 0;

  // Tiny binary heap keyed by f = g + h.
  const heap: number[] = []; // node indices
  const f = new Float64Array(N);
  const h = (i: number) => {
    const cx = i % cols;
    const cy = (i - cx) / cols;
    return Math.abs(cx - goal.x) + Math.abs(cy - goal.y);
  };
  f[startI] = h(startI);
  const push = (i: number) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[heap[p]!]! <= f[heap[c]!]!) break;
      [heap[p], heap[c]] = [heap[c]!, heap[p]!];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let s = c;
        if (l < heap.length && f[heap[l]!]! < f[heap[s]!]!) s = l;
        if (r < heap.length && f[heap[r]!]! < f[heap[s]!]!) s = r;
        if (s === c) break;
        [heap[s], heap[c]] = [heap[c]!, heap[s]!];
        c = s;
      }
    }
    return top;
  };
  push(startI);

  const neighbors = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 1],
    [0, -1, 1],
  ] as const;

  while (heap.length) {
    const cur = pop();
    if (cur === goalI) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (const [dx, dy, d] of neighbors) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = idx(nx, ny);
      if (blocked[ni] || closed[ni]) continue;
      const turn = dir[cur] !== -1 && dir[cur] !== d ? turnPenalty : 0;
      const tentative = g[cur]! + 1 + turn;
      if (tentative < g[ni]!) {
        g[ni] = tentative;
        came[ni] = cur;
        dir[ni] = d;
        f[ni] = tentative + h(ni);
        push(ni);
      }
    }
  }

  if (came[goalI] === -1 && goalI !== startI) return null; // no path

  // Reconstruct grid cells, convert to world, then merge collinear points.
  const cells: number[] = [];
  for (let i = goalI; i !== -1; i = came[i]!) {
    cells.push(i);
    if (i === startI) break;
  }
  cells.reverse();
  // Strictly axis-aligned grid points (4-neighbor moves). Endpoints land on the
  // nearest grid line — within one cell of the inputs — which is fine because
  // callers use the interior points as waypoints and the link clips to device edges.
  const raw: Pt[] = cells.map((i) => {
    const cx = i % cols;
    const cy = (i - cx) / cols;
    return { x: wx(cx), y: wy(cy) };
  });
  return simplify(raw);
}

/** Drop interior points that lie on the straight segment between their neighbors. */
export function simplify(pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const collinear =
      (p.x === c.x && c.x === n.x) || (p.y === c.y && c.y === n.y);
    if (!collinear) out.push(c);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
