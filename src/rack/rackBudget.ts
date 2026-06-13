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

/**
 * The set of physical U occupied by rack-mounted gear (rail items are 0U → never counted).
 * Pass `side` to count one face only (drives the per-face occupancy heatmap); omit it to
 * count distinct U across both faces (the U-budget). Pure.
 */
export function occupiedUnits(rack: Rack, devices: Device[], side?: 'front' | 'rear'): Set<number> {
  const occupied = new Set<number>();
  for (const d of devices) {
    if (d.rackId !== rack.id || d.ru == null) continue;
    if ((d.mount ?? 'rack') === 'rail') continue;
    if (side && (d.side ?? 'front') !== side) continue;
    const base = d.ru ?? 1;
    const span = d.ruSpan ?? 1;
    for (let u = base; u < base + span; u++) {
      if (u >= 1 && u <= rack.ruHeight) occupied.add(u);
    }
  }
  return occupied;
}

export function rackBudget(rack: Rack, devices: Device[]): RackBudget {
  const inRack = devices.filter((d) => d.rackId === rack.id && d.ru != null);

  let watts = 0;
  let weightKg = 0;
  for (const d of inRack) {
    watts += d.watts ?? 0;
    weightKg += d.weightKg ?? 0;
  }
  // Distinct U across both faces (front+rear share depth; half-bays share their U).
  const occupied = occupiedUnits(rack, devices);

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

export interface FleetBudget {
  rackCount: number;
  totalU: number;
  usedU: number;
  freeU: number;
  watts: number;
  /** Sum of per-rack power caps (only racks that set one contribute). 0 if none capped. */
  maxWatts: number;
  weightKg: number;
  /** Any rack over its power or weight cap. */
  anyOver: boolean;
}

/** Aggregate capacity across a whole fleet of racks — drives the canvas capacity strip. Pure. */
export function fleetBudget(racks: Rack[], devices: Device[]): FleetBudget {
  let totalU = 0, usedU = 0, freeU = 0, watts = 0, maxWatts = 0, weightKg = 0, anyOver = false;
  for (const rack of racks) {
    const b = rackBudget(rack, devices);
    totalU += rack.ruHeight;
    usedU += b.usedU;
    freeU += b.freeU;
    watts += b.watts;
    maxWatts += b.maxWatts ?? 0;
    weightKg += b.weightKg;
    if (b.overWatts || b.overWeight) anyOver = true;
  }
  return { rackCount: racks.length, totalU, usedU, freeU, watts, maxWatts, weightKg, anyOver };
}
