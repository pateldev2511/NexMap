/**
 * Pure rack-slot geometry + collision math (rack designer, schema v3).
 *
 * No React, no store, no I/O — every function here is total and deterministic so it
 * is exhaustively unit-testable. The live SVG editor and the export renderer both
 * import the LAYOUT math from here; only their emitted markup differs.
 *
 * Coordinate model (front view, U1 at the BOTTOM):
 *
 *     U-origin (ru) is the LOWEST occupied unit, 1-based. A 2U device at ru=40
 *     occupies U40 and U41; its top unit is ru + ruSpan - 1 = 41.
 *
 *   ┌───────────── one rack, ruHeight=42 ─────────────┐
 *   │ U42  ......................................     │
 *   │ U41  [ esxi-01 (2U) ............ rear/front ]   │  ← topU = ru+span-1
 *   │ U40  [ esxi-01 .............................]   │  ← ru (origin)
 *   │ ...                                             │
 *   │ U1   ......................................     │
 *   └─────────────────────────────────────────────────┘
 *
 * `ru`/`ruSpan` are CANONICAL. The slot adds three qualifiers:
 *   - side: 'front' | 'rear'  — devices on opposite faces never collide.
 *   - bay:  'full' | 'left' | 'right' — two half-width devices share one U.
 *   - mount:'rack' | 'rail'   — rail = 0U side channel (PDU); does not consume U,
 *                                collides only with other rail items on the same side.
 */
import type { Device, Rack } from '@/model/types';

export type Mount = 'rack' | 'rail';
export type Side = 'front' | 'rear';
export type Bay = 'full' | 'left' | 'right';

export interface Slot {
  /** Lowest occupied U, 1-based. */
  ru: number;
  /** Height in U (>= 1). Rail-mounted items still carry a span for their rendered height. */
  ruSpan: number;
  mount: Mount;
  side: Side;
  bay: Bay;
}

export type FitResult =
  | { ok: true }
  | { ok: false; reason: 'out-of-bounds' | 'occupied' | 'bay-conflict' | 'invalid' };

/** Read a device's slot, applying v2 back-compat defaults (rack/front/full). */
/**
 * Racks in left-to-right row order. The optional `order` field wins; racks without it
 * fall back to their current array index, so a partially-ordered set stays stable. Pure.
 */
export function orderRacks(racks: Rack[]): Rack[] {
  return racks
    .map((r, i) => ({ r, k: r.order ?? i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.r);
}

export function slotOf(d: Device): Slot {
  return {
    ru: d.ru ?? 1,
    ruSpan: Math.max(1, d.ruSpan ?? 1),
    mount: d.mount ?? 'rack',
    side: d.side ?? 'front',
    bay: d.bay ?? 'full',
  };
}

/** Top occupied unit of a slot (ru + span - 1). */
export function topU(slot: Pick<Slot, 'ru' | 'ruSpan'>): number {
  return slot.ru + slot.ruSpan - 1;
}

/** Whether two bays on the same side/U compete for the same physical space. */
export function baysConflict(a: Bay, b: Bay): boolean {
  // 'full' takes the whole width, so it conflicts with anything.
  if (a === 'full' || b === 'full') return true;
  // left vs left or right vs right conflict; left vs right are independent.
  return a === b;
}

/** Closed-interval overlap of two U ranges [ru, topU]. */
export function uRangesOverlap(a: Slot, b: Slot): boolean {
  return a.ru <= topU(b) && b.ru <= topU(a);
}

/**
 * Do two slots physically collide?
 *  - Different sides never collide (front vs rear are separate faces).
 *  - Rail-mounted items collide only with other rail items on the same side
 *    (they live in the side channel, not the U column).
 *  - Rack-mounted items collide when their U ranges overlap AND their bays conflict.
 */
export function slotsCollide(a: Slot, b: Slot): boolean {
  if (a.side !== b.side) return false;
  if (a.mount === 'rail' || b.mount === 'rail') {
    // Two rail items on the same side share the channel; one rail + one rack don't.
    return a.mount === 'rail' && b.mount === 'rail';
  }
  return uRangesOverlap(a, b) && baysConflict(a.bay, b.bay);
}

/** Is a rack-mounted slot fully within the rack's U range? Rail items are exempt. */
export function inBounds(rack: Rack, slot: Slot): boolean {
  if (slot.mount === 'rail') return true;
  return slot.ru >= 1 && topU(slot) <= rack.ruHeight;
}

/**
 * Can `candidate` be placed in `rack` given the already-mounted `occupants`?
 * Pass `ignoreId` when MOVING an existing device so it doesn't collide with itself.
 */
export function canFit(
  rack: Rack,
  occupants: Device[],
  candidate: Slot,
  ignoreId?: string,
): FitResult {
  if (
    !Number.isInteger(candidate.ru) ||
    !Number.isInteger(candidate.ruSpan) ||
    candidate.ruSpan < 1
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (!inBounds(rack, candidate)) return { ok: false, reason: 'out-of-bounds' };

  for (const occ of occupants) {
    if (occ.id === ignoreId) continue;
    if (occ.rackId !== rack.id) continue;
    const s = slotOf(occ);
    if (!slotsCollide(s, candidate)) continue;
    // Same U range but a half-bay is free vs a full clash → distinguish the message.
    return {
      ok: false,
      reason: candidate.mount === 'rack' && baysConflict(s.bay, candidate.bay) && s.bay !== candidate.bay
        ? 'bay-conflict'
        : 'occupied',
    };
  }
  return { ok: true };
}

/**
 * Lowest free U (1-based origin) where a `span`-high device fits on the given
 * side/bay, scanning bottom→top. Returns null if the rack is full. Used to PULSE
 * the nearest valid slot when a drop is rejected.
 */
export function firstFreeU(
  rack: Rack,
  occupants: Device[],
  span: number,
  side: Side = 'front',
  bay: Bay = 'full',
  ignoreId?: string,
): number | null {
  if (span < 1 || span > rack.ruHeight) return null;
  for (let ru = 1; ru <= rack.ruHeight - span + 1; ru++) {
    const candidate: Slot = { ru, ruSpan: span, mount: 'rack', side, bay };
    if (canFit(rack, occupants, candidate, ignoreId).ok) return ru;
  }
  return null;
}

/**
 * Free U (origin) closest to `target` where a `span`-high device fits, searching
 * OUTWARD from the target (target, target-1, target+1, target-2, …). Returns null if
 * the rack can't fit it anywhere. Used to PULSE the nearest valid slot on a rejected
 * drop — so the hint lands next to where the user aimed, not at the far end of the rack.
 */
export function nearestFreeU(
  rack: Rack,
  occupants: Device[],
  span: number,
  target: number,
  side: Side = 'front',
  bay: Bay = 'full',
  ignoreId?: string,
): number | null {
  if (span < 1 || span > rack.ruHeight) return null;
  const maxRu = rack.ruHeight - span + 1;
  const fits = (ru: number) =>
    ru >= 1 && ru <= maxRu && canFit(rack, occupants, { ru, ruSpan: span, mount: 'rack', side, bay }, ignoreId).ok;
  const start = Math.max(1, Math.min(maxRu, Math.round(target)));
  for (let d = 0; d <= rack.ruHeight; d++) {
    if (fits(start - d)) return start - d;
    if (d > 0 && fits(start + d)) return start + d;
  }
  return null;
}
