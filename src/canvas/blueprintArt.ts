/**
 * Blueprint skin — the device set drawn as a drafting sheet: one pale ink on
 * cyanotype paper, a single fine pen, no fills or glow. It TRACES the line icon
 * set (the house style) at the blueprint stroke from the icon-system spec, and
 * adds what a draftsman would: registration ticks at the corners of the type's
 * silhouette box, so the shared skeleton every skin draws to is visible on the
 * sheet itself.
 *
 * Markup is a trusted compile-time constant (no user input), like every skin.
 */
import type { DeviceType } from '@/model/types';
import { deviceIcon } from './deviceVisuals';
import { ICON_STROKE, iconSilhouette } from './iconSystem';

/** Paper and ink. Literal colours so exports (no CSS) match the canvas. */
export const BLUEPRINT = {
  paper: '#123e6b',
  ink: '#e6f0fb',
  /** Secondary ink: registration ticks, interface labels, the title block rule. */
  inkDim: '#9fbbd8',
  gridMinor: 'rgba(230, 240, 251, 0.07)',
  gridMajor: 'rgba(230, 240, 251, 0.16)',
  /** Drafting sheets warn in amber, not alarm red — it reads on blue paper. */
  warn: '#fbbf24',
} as const;

/** Grid units of the corner registration ticks, and their pen. */
const TICK = 1.6;
const TICK_PEN = 0.5;

/**
 * Corner ticks tracing a type's silhouette box (0..24 art units). The box is
 * measured ink, so the ticks sit half a pen inside it and stay in the live area.
 */
function registrationTicks(type: DeviceType, ink: string): string {
  const h = TICK_PEN / 2;
  const [b0, b1, b2, b3] = iconSilhouette(type).box;
  const [x0, y0, x1, y1] = [b0 + h, b1 + h, b2 - h, b3 - h];
  const d =
    `M${x0} ${y0 + TICK}V${y0}H${x0 + TICK}` +
    `M${x1 - TICK} ${y0}H${x1}V${y0 + TICK}` +
    `M${x1} ${y1 - TICK}V${y1}H${x1 - TICK}` +
    `M${x0 + TICK} ${y1}H${x0}V${y1 - TICK}`;
  return `<path d="${d}" stroke="${ink}" stroke-width="${TICK_PEN}" opacity="0.6"/>`;
}

/** Blueprint art for a type on the 0..24 grid (stroke set by the caller's group). */
export function deviceBlueprintArt(type: DeviceType, ink: string = BLUEPRINT.ink): string {
  return registrationTicks(type, ink) + deviceIcon(type, ink);
}

/** SVG `<g>` rendering the blueprint icon centered at (cx,cy) at `size`. */
export function deviceIconBlueprintGroup(
  type: DeviceType,
  cx: number,
  cy: number,
  size: number,
  ink: string = BLUEPRINT.ink,
): string {
  const s = size / 24;
  return (
    `<g data-blueprint-icon="1" transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})" ` +
    `stroke="${ink}" stroke-width="${ICON_STROKE.blueprint}" fill="none" ` +
    `stroke-linecap="round" stroke-linejoin="round">${deviceBlueprintArt(type, ink)}</g>`
  );
}
