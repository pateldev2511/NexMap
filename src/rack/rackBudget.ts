/**
 * Rack budget — U-utilization plus optional power (watts) and weight (kg) totals against
 * the rack's caps. Pure + deterministic; drives the rack header fill bar, the row-view
 * summaries, and the overload badges. All capacity fields are optional, so a rack with no
 * caps simply never reports an overload.
 */
import type { Device, Rack } from '@/model/types';

export interface RackBudget {
  /** Distinct physical U occupied by rack-mounted (non-rail) gear, capped at ruHeight. */
  usedU: number;
  freeU: number;
  /** Fraction full, 0..1. */
  pct: number;
  watts: number;
  weightKg: number;
  maxWatts?: number;
  maxWeightKg?: number;
  overWatts: boolean;
  overWeight: boolean;
}

export function rackBudget(rack: Rack, devices: Device[]): RackBudget {
  const inRack = devices.filter((d) => d.rackId === rack.id && d.ru != null);

  // Count DISTINCT occupied U across both faces (front+rear at the same U share the depth;
  // left+right half-bays share their U). Rail-mounted (0U) gear never consumes U.
  const occupied = new Set<number>();
  let watts = 0;
  let weightKg = 0;
  for (const d of inRack) {
    watts += d.watts ?? 0;
    weightKg += d.weightKg ?? 0;
    if ((d.mount ?? 'rack') === 'rail') continue;
    const base = d.ru ?? 1;
    const span = d.ruSpan ?? 1;
    for (let u = base; u < base + span; u++) {
      if (u >= 1 && u <= rack.ruHeight) occupied.add(u);
    }
  }

  const usedU = occupied.size;
  const freeU = Math.max(0, rack.ruHeight - usedU);
  const pct = rack.ruHeight > 0 ? usedU / rack.ruHeight : 0;
  return {
    usedU,
    freeU,
    pct,
    watts,
    weightKg,
    maxWatts: rack.maxWatts,
    maxWeightKg: rack.maxWeightKg,
    overWatts: rack.maxWatts != null && watts > rack.maxWatts,
    overWeight: rack.maxWeightKg != null && weightKg > rack.maxWeightKg,
  };
}
