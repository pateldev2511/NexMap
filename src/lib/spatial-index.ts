/**
 * Spatial index (uniform grid) — the keystone the eng review (DA-P2) called for.
 *
 * Hit-testing, viewport culling, and snap-candidate lookup all route through this
 * so the renderer NEVER relies on `event.target` for object identity. That single
 * discipline is what keeps a future Canvas-2D layer swappable behind SceneSource.
 *
 * A uniform grid (not a quadtree) is chosen deliberately: network diagrams are
 * roughly evenly distributed, inserts/moves are frequent (every drag frame), and
 * a grid gives O(1) insert/remove/move with no rebalancing. If profiling later
 * shows pathological clustering, this is a drop-in replacement behind the same API.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Entry {
  id: string;
  box: Box;
  /** Grid cell keys this entry currently occupies (for cheap removal). */
  cells: string[];
}

const DEFAULT_CELL = 128;

export class SpatialIndex {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<string>>();
  private readonly entries = new Map<string, Entry>();

  constructor(cellSize: number = DEFAULT_CELL) {
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.entries.size;
  }

  private cellKey(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  private cellsFor(box: Box): string[] {
    const minX = Math.floor(box.x / this.cellSize);
    const minY = Math.floor(box.y / this.cellSize);
    const maxX = Math.floor((box.x + box.width) / this.cellSize);
    const maxY = Math.floor((box.y + box.height) / this.cellSize);
    const keys: string[] = [];
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        keys.push(this.cellKey(cx, cy));
      }
    }
    return keys;
  }

  insert(id: string, box: Box): void {
    if (this.entries.has(id)) {
      this.update(id, box);
      return;
    }
    const cells = this.cellsFor(box);
    this.entries.set(id, { id, box, cells });
    for (const key of cells) {
      let set = this.cells.get(key);
      if (!set) {
        set = new Set();
        this.cells.set(key, set);
      }
      set.add(id);
    }
  }

  /** Move/resize an existing entry. Cheap when it stays in the same cells. */
  update(id: string, box: Box): void {
    const entry = this.entries.get(id);
    if (!entry) {
      this.insert(id, box);
      return;
    }
    const next = this.cellsFor(box);
    if (sameCells(entry.cells, next)) {
      entry.box = box;
      return;
    }
    this.removeFromCells(entry);
    entry.box = box;
    entry.cells = next;
    for (const key of next) {
      let set = this.cells.get(key);
      if (!set) {
        set = new Set();
        this.cells.set(key, set);
      }
      set.add(id);
    }
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.removeFromCells(entry);
    this.entries.delete(id);
  }

  private removeFromCells(entry: Entry): void {
    for (const key of entry.cells) {
      const set = this.cells.get(key);
      if (set) {
        set.delete(entry.id);
        if (set.size === 0) this.cells.delete(key);
      }
    }
  }

  clear(): void {
    this.cells.clear();
    this.entries.clear();
  }

  /** IDs whose bounding box intersects the query box (e.g. viewport cull, box-select). */
  query(box: Box): string[] {
    // Guard: if the box spans more grid cells than we have entries (pathological
    // box — huge, NaN-derived, or a caller bug), scan entries directly. Query cost
    // is then bounded by min(cells, entries) and can never freeze the tab.
    const span = this.cellSpan(box);
    if (!Number.isFinite(span) || span > this.entries.size) {
      const found: string[] = [];
      for (const entry of this.entries.values()) {
        if (boxesIntersect(entry.box, box)) found.push(entry.id);
      }
      return found;
    }
    const found = new Set<string>();
    for (const key of this.cellsFor(box)) {
      const set = this.cells.get(key);
      if (!set) continue;
      for (const id of set) {
        const entry = this.entries.get(id);
        if (entry && boxesIntersect(entry.box, box)) found.add(id);
      }
    }
    return [...found];
  }

  /** Number of grid cells a box covers (without materializing them). */
  private cellSpan(box: Box): number {
    const cols = Math.floor((box.x + box.width) / this.cellSize) - Math.floor(box.x / this.cellSize) + 1;
    const rows = Math.floor((box.y + box.height) / this.cellSize) - Math.floor(box.y / this.cellSize) + 1;
    return cols * rows;
  }

  /** IDs whose box contains the point (hit-testing). Topmost-last by insertion. */
  hit(x: number, y: number): string[] {
    const point: Box = { x, y, width: 0, height: 0 };
    return this.query(point).filter((id) => {
      const entry = this.entries.get(id);
      return entry !== undefined && pointInBox(x, y, entry.box);
    });
  }
}

function sameCells(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

export function pointInBox(x: number, y: number, box: Box): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}
