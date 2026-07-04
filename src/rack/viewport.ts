/**
 * Pan/zoom viewport math for the multi-rack canvas (schema v3). Pure + deterministic so the
 * zoom-toward-cursor and fit-to-screen logic is unit-testable. The viewport is a CSS-style
 * transform applied to the rack SVG: screen = world * scale + translate. All coordinates are
 * in CONTAINER pixels (cursor relative to the canvas top-left).
 */
export interface Viewport {
  scale: number;
  /** Translation in container px. */
  tx: number;
  ty: number;
}

export const IDENTITY: Viewport = { scale: 1, tx: 0, ty: 0 };

// Unified with the flat canvas (pointer-native plan): same floor/ceiling on
// every canvas so the zoom range feels identical app-wide.
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Zoom by `factor` while keeping the content point under the cursor (px, py — container px)
 * pinned in place. This is what makes wheel-zoom feel anchored instead of drifting.
 * Signature matches canvas/viewport.ts (vp, factor, x, y) — one zoomAt shape app-wide.
 */
export function zoomAt(vp: Viewport, factor: number, px: number, py: number): Viewport {
  const scale = clamp(vp.scale * factor, MIN_SCALE, MAX_SCALE);
  const k = scale / vp.scale; // effective change after clamping
  return {
    scale,
    tx: px - (px - vp.tx) * k,
    ty: py - (py - vp.ty) * k,
  };
}

/** Pan by a screen-space delta. */
export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, tx: vp.tx + dx, ty: vp.ty + dy };
}

/** Set an explicit zoom level centered on the viewport middle. */
export function zoomTo(vp: Viewport, scale: number, viewW: number, viewH: number): Viewport {
  return zoomAt(vp, clamp(scale, MIN_SCALE, MAX_SCALE) / vp.scale, viewW / 2, viewH / 2);
}

/**
 * Fit content (contentW × contentH) into a viewport (viewW × viewH) with padding, centered.
 * Never scales above 1 (don't blow up a small rack to fill a huge screen).
 */
export function fit(contentW: number, contentH: number, viewW: number, viewH: number, pad = 24): Viewport {
  if (contentW <= 0 || contentH <= 0 || viewW <= 0 || viewH <= 0) return IDENTITY;
  const scale = clamp(Math.min((viewW - pad * 2) / contentW, (viewH - pad * 2) / contentH), MIN_SCALE, 1);
  return {
    scale,
    tx: (viewW - contentW * scale) / 2,
    ty: Math.max(pad, (viewH - contentH * scale) / 2),
  };
}

/** Map a container-px point to content (world) coordinates under the current viewport. */
export function toWorld(vp: Viewport, px: number, py: number): { x: number; y: number } {
  return { x: (px - vp.tx) / vp.scale, y: (py - vp.ty) / vp.scale };
}
