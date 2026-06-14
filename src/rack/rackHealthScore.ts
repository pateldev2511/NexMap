/**
 * Rack health score (0-100) — a single legible number for the rack header, plus the one
 * line that explains the biggest risk. Pure and schema-free: derived from existing budget,
 * power, cabling, and inventory state. No new persisted fields.
 *
 * Four equally-weighted dimensions (0..1 each), so each can swing the score by up to 25:
 *   capacity     — not over watts/weight; U not jammed past 90%
 *   redundancy   — powered gear is dual-corded and A/B load is even
 *   cabling      — no health issues touching this rack; no missing cable lengths
 *   inventory    — devices carry an asset tag + vendor/model for handoff
 *
 * The lowest dimension becomes the "biggest risk" headline. Thresholds reuse the app's
 * semantic ramp: >=80 ok (green), 50-79 warn (amber), <50 error (red).
 */
import type { Device, Rack, RackCable, ValidationIssue } from '@/model/types';
import { rackBudget } from './rackBudget';
import { powerFeedAnalysis } from './rackPower';

export type HealthBand = 'ok' | 'warn' | 'error';

export interface HealthDimension {
  key: 'capacity' | 'redundancy' | 'cabling' | 'inventory';
  label: string;
  /** 0..1 */
  score: number;
  /** Shown as the biggest-risk line when this is the weakest dimension. */
  risk: string;
}

export interface RackHealthScore {
  /** 0-100, rounded. */
  score: number;
  band: HealthBand;
  /** One-line headline for the weakest dimension (or a clean-bill message at 100). */
  biggestRisk: string;
  dimensions: HealthDimension[];
}

export function healthBand(score: number): HealthBand {
  if (score >= 80) return 'ok';
  if (score >= 50) return 'warn';
  return 'error';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function rackHealthScore(
  rack: Rack,
  devices: Device[],
  cables: RackCable[] = [],
  issues: ValidationIssue[] = [],
): RackHealthScore {
  const inRack = devices.filter((d) => d.rackId === rack.id);
  const inRackIds = new Set(inRack.map((d) => d.id));
  const budget = rackBudget(rack, inRack);

  // capacity: over-cap is a hard fail; otherwise penalize cramming past 90% U.
  let capacity = 1;
  let capacityRisk = 'Capacity is healthy.';
  if (budget.overWatts || budget.overWeight) {
    capacity = 0;
    capacityRisk = budget.overWatts ? 'Over the power cap.' : 'Over the weight cap.';
  } else if (budget.pct > 0.9) {
    capacity = clamp01(1 - (budget.pct - 0.9) / 0.1) * 0.5 + 0.3; // 0.3..0.8 band when 90-100%
    capacityRisk = `Only ${budget.freeU}U free (${Math.round(budget.pct * 100)}% full).`;
  }

  // redundancy: share of powered gear that is dual-corded, minus an A/B imbalance penalty.
  const power = powerFeedAnalysis(inRack);
  const poweredCount = power.dualCorded + power.singleCorded;
  let redundancy = 1;
  let redundancyRisk = 'Power redundancy looks good.';
  if (poweredCount > 0) {
    const dualFrac = power.dualCorded / poweredCount;
    const totalFeed = power.normalA + power.normalB;
    const imbalance = totalFeed > 0 ? Math.abs(power.normalA - power.normalB) / totalFeed : 0;
    redundancy = clamp01(dualFrac * 0.7 + (1 - imbalance) * 0.3);
    if (power.singleCorded > 0 && dualFrac < 0.5) {
      redundancyRisk = `${power.singleCorded} single-corded device${power.singleCorded === 1 ? '' : 's'} (no A/B redundancy).`;
    } else if (imbalance >= 0.25) {
      redundancyRisk = `A/B power is ${Math.round(imbalance * 100)}% out of balance.`;
    }
  }

  // cabling: issues touching this rack's devices + cables missing an estimated length.
  const rackIssues = issues.filter((i) => i.objectIds.some((id) => inRackIds.has(id)));
  const rackCables = cables.filter(
    (c) => inRackIds.has(c.aEnd.deviceId) || inRackIds.has(c.bEnd.deviceId),
  );
  const missingLen = rackCables.filter((c) => c.lengthFt == null).length;
  let cabling = 1;
  let cablingRisk = 'Cabling is clean.';
  if (rackIssues.length > 0) {
    cabling = clamp01(1 - rackIssues.length * 0.25);
    cablingRisk = `${rackIssues.length} cabling issue${rackIssues.length === 1 ? '' : 's'} to review.`;
  } else if (missingLen > 0) {
    cabling = clamp01(1 - (missingLen / Math.max(1, rackCables.length)) * 0.4);
    cablingRisk = `${missingLen} cable${missingLen === 1 ? '' : 's'} missing a length estimate.`;
  }

  // inventory: devices with both an asset tag and a vendor/model for handoff.
  let inventory = 1;
  let inventoryRisk = 'Inventory is complete.';
  if (inRack.length > 0) {
    const documented = inRack.filter(
      (d) => d.assetTag?.trim() && (d.vendor?.trim() || d.model?.trim()),
    ).length;
    inventory = documented / inRack.length;
    const missing = inRack.length - documented;
    if (missing > 0) {
      inventoryRisk = `${missing} device${missing === 1 ? '' : 's'} missing asset tag or model.`;
    }
  }

  const dimensions: HealthDimension[] = [
    { key: 'capacity', label: 'Capacity', score: capacity, risk: capacityRisk },
    { key: 'redundancy', label: 'Redundancy', score: redundancy, risk: redundancyRisk },
    { key: 'cabling', label: 'Cabling', score: cabling, risk: cablingRisk },
    { key: 'inventory', label: 'Inventory', score: inventory, risk: inventoryRisk },
  ];

  const score = Math.round(
    (dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length) * 100,
  );
  const weakest = dimensions.reduce((lo, d) => (d.score < lo.score ? d : lo), dimensions[0]!);
  const biggestRisk = score >= 100 ? 'No risks — this rack is in great shape.' : weakest.risk;

  return { score, band: healthBand(score), biggestRisk, dimensions };
}
