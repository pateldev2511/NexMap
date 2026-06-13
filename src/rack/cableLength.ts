/**
 * Estimate a patch-cable length (feet) from rack geometry (schema v3). Pure + deterministic.
 * A run is the vertical U travel between the two ports, plus horizontal cabinet travel for
 * cross-rack runs, plus routing slack (service loop + tray), rounded UP to a stocked length
 * so the cable schedule is directly orderable. The live editor never had real lengths —
 * this turns the manual "Length (ft)" field into a one-click estimate.
 */
import type { Device, Rack } from '@/model/types';
import { orderRacks } from './rackModel';

/** A rack U is 1.75 inches tall. */
export const U_HEIGHT_FT = 1.75 / 12;

/** Common stocked patch-cable lengths (ft). An estimate rounds UP to the next one. */
export const STOCK_LENGTHS_FT = [1, 2, 3, 5, 7, 10, 15, 25, 35, 50] as const;

export function roundUpToStockFt(ft: number): number {
  for (const s of STOCK_LENGTHS_FT) if (ft <= s) return s;
  return STOCK_LENGTHS_FT[STOCK_LENGTHS_FT.length - 1]!;
}

/**
 * Estimate a cable length in feet from where its two devices sit. Returns null when either
 * endpoint isn't mounted (no `ru`) — there's no geometry to measure.
 */
export function estimateCableLengthFt(a: Device, b: Device, racks: Rack[]): number | null {
  if (a.ru == null || b.ru == null) return null;
  const vertical = Math.abs(a.ru - b.ru) * U_HEIGHT_FT;
  const sameRack = a.rackId != null && a.rackId === b.rackId;

  let horizontal = 0;
  let slack = 3; // intra-rack: routing to the rails + a small service loop
  if (!sameRack) {
    const ordered = orderRacks(racks);
    const ia = ordered.findIndex((r) => r.id === a.rackId);
    const ib = ordered.findIndex((r) => r.id === b.rackId);
    const racksApart = ia >= 0 && ib >= 0 ? Math.abs(ia - ib) : 1;
    horizontal = Math.max(1, racksApart) * 2.5; // ~2.5 ft per cabinet of overhead travel
    slack = 6; // cross-rack: longer service loops + tray routing
  }
  return roundUpToStockFt(vertical + horizontal + slack);
}
