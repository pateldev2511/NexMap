/**
 * Shared pixel geometry for the rack designer (schema v3).
 *
 * This is the "share the math, fork the markup" boundary from the eng review: BOTH
 * the live SVG editor (var() colors, interaction) and the pure export renderer
 * (literal hex, no foreignObject) import their LAYOUT from here, so a device's panel,
 * jacks, and U position are computed in exactly ONE place. Pure + deterministic.
 */
import type { Device, Rack } from '@/model/types';
import { slotOf, topU } from './rackModel';

/** Pixels per rack unit. Generous so a 1U panel + its jacks read clearly. */
export const U_PX = 30;
/** Left gutter holding the U numbers. */
export const GUTTER_PX = 28;
/** Mounting-rail width on each side of the bay. */
export const RAIL_PX = 10;
/** Inner bay width (where devices mount), before rails. */
export const BAY_W = 600;
/** Outer padding inside the cabinet frame. */
export const FRAME_PAD = 14;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Full pixel size of the cabinet (frame + gutter + bay), front view. */
export function cabinetSize(rack: Rack): { width: number; height: number } {
  const bayH = rack.ruHeight * U_PX;
  return {
    width: FRAME_PAD * 2 + GUTTER_PX + BAY_W,
    height: FRAME_PAD * 2 + bayH,
  };
}

/** Horizontal space between adjacent cabinets in the multi-rack row view. */
export const RACK_GUTTER = 48;

/**
 * Top-left origin of the bay (device coordinate space) within the cabinet. In the
 * single-rack editor `offsetX` is 0; in the multi-rack row the cabinet is shifted right
 * by its placement offset (see `rowLayout`).
 */
export function bayOrigin(offsetX = 0): { x: number; y: number } {
  return { x: offsetX + FRAME_PAD + GUTTER_PX, y: FRAME_PAD };
}

export interface RackPlacement {
  rack: Rack;
  offsetX: number;
  size: { width: number; height: number };
}

/**
 * Lay cabinets left-to-right for the row view / multi-rack export. Each cabinet keeps
 * its own width (racks can differ); `offsetX` is the cumulative left edge. Returns the
 * placements plus the total row bounds (width = sum of cabinets + gutters, height = the
 * tallest cabinet). Pure + deterministic.
 */
export function rowLayout(racks: Rack[]): { placements: RackPlacement[]; width: number; height: number } {
  const placements: RackPlacement[] = [];
  let offsetX = 0;
  let height = 0;
  racks.forEach((rack, i) => {
    const size = cabinetSize(rack);
    placements.push({ rack, offsetX, size });
    height = Math.max(height, size.height);
    offsetX += size.width + (i < racks.length - 1 ? RACK_GUTTER : 0);
  });
  return { placements, width: offsetX, height };
}

/** y (top) of a given U row's top edge within the bay. U1 sits at the bottom. */
export function uToY(rack: Rack, ru: number, ruSpan: number): number {
  // The top unit (ru+span-1) determines the top edge.
  return (rack.ruHeight - topU({ ru, ruSpan })) * U_PX;
}

/**
 * Device rectangle in BAY-LOCAL pixels (front view). Honors half-width bays.
 * Rail-mounted (0U) devices render as a thin vertical strip in the side channel.
 */
export function deviceRect(rack: Rack, device: Device): Rect {
  const s = slotOf(device);
  const innerW = BAY_W - RAIL_PX * 2;
  const y = uToY(rack, s.ru, s.ruSpan);
  const h = s.ruSpan * U_PX;
  if (s.mount === 'rail') {
    // Side rail: thin strip hugging the right rail (front view convention).
    return { x: BAY_W - RAIL_PX - 16, y, w: 16, h };
  }
  if (s.bay === 'left') return { x: RAIL_PX, y, w: innerW / 2 - 2, h };
  if (s.bay === 'right') return { x: RAIL_PX + innerW / 2 + 2, y, w: innerW / 2 - 2, h };
  return { x: RAIL_PX, y, w: innerW, h };
}

/** y of a U-number label's vertical center within the gutter (1-based U). */
export function uLabelCenterY(rack: Rack, u: number): number {
  return (rack.ruHeight - u) * U_PX + U_PX / 2;
}

export interface PortRect extends Rect {
  ifaceId: string;
  name: string;
}

/**
 * Lay out a device's ports as a jack grid that FILLS the panel space to the right of
 * the name (using the otherwise-empty middle), sizing jacks as large as they fit and
 * centering the grid in that area. Default row count: ≤8 ports → one prominent row;
 * more → two rows. Callers force realism with `rows` (e.g. a 24-port PATCH panel is
 * one row, not 2×12) and `groupEvery`/`groupGap` (keystone banks of 6, switch port
 * banks) — real gear separates its ports into groups, not one undifferentiated strip.
 * Returns one rect per interface (panel-local coords) for BOTH drawing and hit-testing.
 */
export function portLayout(
  panel: Rect,
  ports: { id: string; name: string }[],
  opts: {
    gap?: number;
    rightInset?: number;
    nameZone?: number;
    maxJack?: number;
    /** Force the row count (e.g. patch panel = 1). Default: ≤8 → 1, else 2. */
    rows?: number;
    /** Insert `groupGap` extra px after every `groupEvery` COLUMNS (banks of ports). */
    groupEvery?: number;
    groupGap?: number;
  } = {},
): PortRect[] {
  const n = ports.length;
  if (n === 0) return [];
  const gap = opts.gap ?? 3;
  const nameZone = opts.nameZone ?? 98; // left strip reserved for the brand label
  const rightInset = opts.rightInset ?? 10;
  const maxJack = opts.maxJack ?? 20;
  const groupEvery = opts.groupEvery ?? 0;
  const groupGap = opts.groupGap ?? 0;

  const areaX = panel.x + nameZone;
  const areaW = Math.max(20, panel.w - nameZone - rightInset);
  const areaY = panel.y + 4;
  const areaH = Math.max(8, panel.h - 8);

  const rows = Math.max(1, opts.rows ?? (n <= 8 ? 1 : 2));
  const cols = Math.ceil(n / rows);
  // Bank separators sit between column groups; reserve their width before sizing jacks.
  const numGroupGaps = groupEvery > 0 ? Math.floor((cols - 1) / groupEvery) : 0;
  const totalGroupGap = numGroupGaps * groupGap;
  // Size jacks to fill the available width (capped), then constrain by row height.
  const jackW = Math.max(
    7,
    Math.min(maxJack, (areaW - (cols - 1) * gap - totalGroupGap) / cols),
  );
  const jackH = Math.max(6, Math.min(jackW, (areaH - (rows - 1) * gap) / rows));
  const gridW = cols * jackW + (cols - 1) * gap + totalGroupGap;
  const gridH = rows * jackH + (rows - 1) * gap;
  // Center the grid in the port area so the previously-empty middle gets used.
  const startX = areaX + Math.max(0, (areaW - gridW) / 2);
  const startY = areaY + Math.max(0, (areaH - gridH) / 2);

  // Column-major fill so a switch's 2 rows read odd-on-top / even-on-bottom.
  const out: PortRect[] = [];
  for (let i = 0; i < n; i++) {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const groupsBefore = groupEvery > 0 ? Math.floor(col / groupEvery) : 0;
    out.push({
      x: startX + col * (jackW + gap) + groupsBefore * groupGap,
      y: startY + row * (jackH + gap),
      w: jackW,
      h: jackH,
      ifaceId: ports[i]!.id,
      name: ports[i]!.name,
    });
  }
  return out;
}
