/**
 * Viewport math: the bridge between screen pixels and canvas coordinates.
 *
 * A device lives at a canvas coordinate; the viewport pans (tx,ty) and zooms
 * (scale). The SVG scene is wrapped in `<g transform="translate(tx,ty) scale(s)">`
 * so: screen = canvas * scale + t,  canvas = (screen - t) / scale.
 *
 * Kept pure and standalone so it's unit-testable and reused by hit-testing,
 * culling, snapping, and box-select without dragging React in.
 */
import type { Box } from '@/lib/spatial-index';

export interface Viewport {
  /** Translation in screen pixels. */
  tx: number;
  ty: number;
  /** Zoom factor (1 = 100%). */
  scale: number;
}

export const MIN_SCALE = 0.1; // 10%
export const MAX_SCALE = 4; // 400%
export const GRID_SIZE = 16;
export const SNAP_THRESHOLD = 6;

export const initialViewport: Viewport = { tx: 0, ty: 0, scale: 1 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToCanvas(
  v: Viewport,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale };
}

export function canvasToScreen(
  v: Viewport,
  cx: number,
  cy: number,
): { x: number; y: number } {
  return { x: cx * v.scale + v.tx, y: cy * v.scale + v.ty };
}

/** Pan by a screen-space delta. */
export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, tx: v.tx - dx, ty: v.ty - dy };
}

/**
 * Zoom toward a screen anchor (cursor) so the canvas point under the cursor
 * stays put — the behavior every modern canvas tool uses.
 */
export function zoomAt(v: Viewport, factor: number, sx: number, sy: number): Viewport {
  const nextScale = clampScale(v.scale * factor);
  if (nextScale === v.scale) return v;
  // Keep the canvas point under (sx,sy) fixed.
  const canvas = screenToCanvas(v, sx, sy);
  return {
    scale: nextScale,
    tx: sx - canvas.x * nextScale,
    ty: sy - canvas.y * nextScale,
  };
}

/** The canvas-space rectangle currently visible on screen (for culling). */
export function visibleBox(v: Viewport, screenW: number, screenH: number): Box {
  const tl = screenToCanvas(v, 0, 0);
  const br = screenToCanvas(v, screenW, screenH);
  return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

/** Snap a canvas coordinate to the grid unless suspended (Alt held). */
export function snap(value: number, suspend: boolean): number {
  if (suspend) return value;
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/**
 * Fit a content bounding box into the viewport with padding. Returns a viewport
 * centered on the content. If content is empty, returns identity.
 */
export function fitToBox(
  content: Box,
  screenW: number,
  screenH: number,
  padding = 60,
): Viewport {
  if (content.width <= 0 || content.height <= 0) return initialViewport;
  const sx = (screenW - padding * 2) / content.width;
  const sy = (screenH - padding * 2) / content.height;
  const scale = clampScale(Math.min(sx, sy));
  const cx = content.x + content.width / 2;
  const cy = content.y + content.height / 2;
  return { scale, tx: screenW / 2 - cx * scale, ty: screenH / 2 - cy * scale };
}
