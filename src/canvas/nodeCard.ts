/**
 * Sizing constants + clamps for the on-canvas node info card and icon scaling.
 * Kept separate from NodeInfoCard.tsx so the component file only exports a
 * component (react-refresh / fast-refresh friendliness).
 */

export const MIN_ICON_SCALE = 0.5;
export const MAX_ICON_SCALE = 2.5;
export const DEFAULT_ICON_SCALE = 1;

export const MIN_LABEL_HEIGHT = 0;
export const MAX_LABEL_HEIGHT = 160;
export const DEFAULT_LABEL_HEIGHT = 30;

/** Clamp a stored icon scale into the supported range. */
export function clampIconScale(scale: number | undefined): number {
  const s = scale ?? DEFAULT_ICON_SCALE;
  return Math.max(MIN_ICON_SCALE, Math.min(MAX_ICON_SCALE, s));
}

/** Clamp a stored label height into the supported range. */
export function clampLabelHeight(h: number | undefined): number {
  const v = h ?? DEFAULT_LABEL_HEIGHT;
  return Math.max(MIN_LABEL_HEIGHT, Math.min(MAX_LABEL_HEIGHT, v));
}
