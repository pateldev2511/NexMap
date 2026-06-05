/**
 * Isometric projection core (Phase 9.1).
 *
 * NexMap's model is and stays FLAT: every device/object lives at a plain
 * canvas-pixel (x, y). Isometric is a *view mode* — a reversible projection
 * applied at render and edit time only. This module is the pure, standalone math
 * for that projection so it's unit-testable and never drags React or the store in.
 *
 * Convention: a 2:1 isometric (the classic "video-game" diamond). A flat grid
 * cell (gx, gy) maps to a diamond whose width is `tile.w` and height `tile.h`
 * (with `tile.w === 2 * tile.h` for true 2:1). The mapping:
 *
 *   sx = (gx - gy) * (tile.w / 2)
 *   sy = (gx + gy) * (tile.h / 2)
 *
 * and its inverse:
 *
 *   gx = (sx / (tile.w / 2) + sy / (tile.h / 2)) / 2
 *   gy = (sy / (tile.h / 2) - sx / (tile.w / 2)) / 2
 *
 * "Grid coordinates" here are flat pixel coordinates divided by the grid size, so
 * callers convert with {@link toGrid} / {@link fromGrid}. Keeping the projection
 * in grid space (not raw pixels) keeps tile sizing intuitive and stable at any
 * zoom.
 */

export interface IsoTile {
  /** Full diamond width in screen units. */
  w: number;
  /** Full diamond height in screen units (w / 2 for true 2:1). */
  h: number;
}

/** Default 2:1 tile, sized to the 16px flat grid (one cell → one diamond). */
export const DEFAULT_TILE: IsoTile = { w: 64, h: 32 };

export interface Point {
  x: number;
  y: number;
}

/** Flat pixel coordinate → grid coordinate (may be fractional). */
export function toGrid(px: number, gridSize: number): number {
  return px / gridSize;
}

/** Grid coordinate → flat pixel coordinate. */
export function fromGrid(g: number, gridSize: number): number {
  return g * gridSize;
}

/** Project a flat grid coordinate (gx, gy) to an isometric screen offset. */
export function isoProject(gx: number, gy: number, tile: IsoTile = DEFAULT_TILE): Point {
  return {
    x: (gx - gy) * (tile.w / 2),
    y: (gx + gy) * (tile.h / 2),
  };
}

/** Inverse of {@link isoProject}: screen offset → flat grid coordinate. */
export function isoUnproject(
  sx: number,
  sy: number,
  tile: IsoTile = DEFAULT_TILE,
): { gx: number; gy: number } {
  const a = sx / (tile.w / 2);
  const b = sy / (tile.h / 2);
  return {
    gx: (a + b) / 2,
    gy: (b - a) / 2,
  };
}

/**
 * Painter's-algorithm depth key: tiles with a larger (gx + gy) are "closer" to
 * the viewer and must render later (on top). Sort ascending by this key.
 */
export function isoDepth(gx: number, gy: number): number {
  return gx + gy;
}

/**
 * Project a flat pixel point straight to iso screen space, folding in the grid
 * conversion. Convenience for callers that hold raw model coordinates.
 */
export function isoProjectPx(
  px: number,
  py: number,
  gridSize: number,
  tile: IsoTile = DEFAULT_TILE,
): Point {
  return isoProject(toGrid(px, gridSize), toGrid(py, gridSize), tile);
}

/** Inverse of {@link isoProjectPx}: iso screen space → flat pixel point. */
export function isoUnprojectPx(
  sx: number,
  sy: number,
  gridSize: number,
  tile: IsoTile = DEFAULT_TILE,
): Point {
  const { gx, gy } = isoUnproject(sx, sy, tile);
  return { x: fromGrid(gx, gridSize), y: fromGrid(gy, gridSize) };
}
