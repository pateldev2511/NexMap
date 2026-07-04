/**
 * Flip-then-clamp placement for the floating selection toolbar
 * (docs/designs/pointer-native-canvas.md, M3 spec v2).
 *
 *   preferred slot: 8px ABOVE the selection bbox, horizontally centered
 *   ── unless an info card already owns that airspace → BELOW first
 *   clipped above → flip below; clipped below → flip above
 *   still clipped (giant selection / select-all at 30% zoom) → CLAMP inside
 *   the viewport with 8px insets, pinned toward the edge nearest the
 *   selection centroid.
 *
 * Pure math — provable without a DOM.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlaceResult {
  left: number;
  top: number;
  slot: 'above' | 'below' | 'clamped';
}

export const TOOLBAR_GAP = 8;
export const TOOLBAR_INSET = 8;

export function placeToolbar(
  bbox: Rect,
  toolbar: { width: number; height: number },
  viewport: { width: number; height: number },
  cardAbove = false,
): PlaceResult {
  const left = clamp(
    bbox.x + bbox.width / 2 - toolbar.width / 2,
    TOOLBAR_INSET,
    Math.max(TOOLBAR_INSET, viewport.width - toolbar.width - TOOLBAR_INSET),
  );

  const aboveTop = bbox.y - TOOLBAR_GAP - toolbar.height;
  const belowTop = bbox.y + bbox.height + TOOLBAR_GAP;
  const fitsAbove = aboveTop >= TOOLBAR_INSET;
  const fitsBelow = belowTop + toolbar.height <= viewport.height - TOOLBAR_INSET;

  const order: Array<['above' | 'below', number, boolean]> = cardAbove
    ? [
        ['below', belowTop, fitsBelow],
        ['above', aboveTop, fitsAbove],
      ]
    : [
        ['above', aboveTop, fitsAbove],
        ['below', belowTop, fitsBelow],
      ];

  for (const [slot, top, fits] of order) {
    if (fits) return { left, top, slot };
  }

  // Neither slot fits: clamp inside the viewport, pinned toward the edge
  // nearest the selection centroid.
  const centroidY = bbox.y + bbox.height / 2;
  const top =
    centroidY < viewport.height / 2
      ? TOOLBAR_INSET
      : Math.max(TOOLBAR_INSET, viewport.height - toolbar.height - TOOLBAR_INSET);
  return { left, top, slot: 'clamped' };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
