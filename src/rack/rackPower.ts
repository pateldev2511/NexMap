/**
 * A/B power-feed analysis (schema v3). Real racks run two power feeds (A and B). Dual-corded
 * gear (redundant PSUs, `powerFeed: 'AB'`) splits its draw across both and survives losing
 * either; single-corded gear ('A' or 'B') sits entirely on one feed and dies if that feed
 * goes. This computes the per-feed normal load, the failover load each feed must carry if the
 * other dies, and how many devices are single-corded (a power single-point-of-failure). Pure.
 */
import type { Device } from '@/model/types';

export interface PowerFeedAnalysis {
  /** Normal-operation watts on each feed (dual-corded gear splits 50/50). */
  normalA: number;
  normalB: number;
  /** Watts feed A must carry if feed B dies (dual gear shifts fully to A; B-only gear drops). */
  failoverA: number;
  /** Watts feed B must carry if feed A dies. */
  failoverB: number;
  /** Devices with redundant (dual) power. */
  dualCorded: number;
  /** Single-corded devices — these are power SPOFs (lose the feed, lose the device). */
  singleCorded: number;
}

/** A single proposed feed reassignment for one device. */
export interface PowerFlip {
  deviceId: string;
  from: 'A' | 'B';
  to: 'A' | 'B';
}

export interface PowerBalanceProposal {
  /** Net feed changes (devices flipped twice cancel out and are omitted). */
  flips: PowerFlip[];
  /** |A − B| watts before balancing. */
  beforeDiff: number;
  /** |A − B| watts after applying the flips. */
  afterDiff: number;
  /** Total watts moved between feeds. */
  movedWatts: number;
  /**
   * Single-corded devices that remain single-corded after balancing. Balancing evens the
   * load; it does NOT add redundancy — these are still power SPOFs. Surfaced honestly so
   * the UI never implies a flip fixed redundancy.
   */
  remainingSingleCorded: number;
}

/**
 * Propose A/B feed reassignments that minimize the load gap |A − B| by flipping
 * single-corded gear only. Dual-corded ('AB') devices split 50/50 and are never moved.
 * Greedy local optimum: repeatedly flip the one device that most reduces the gap until no
 * flip helps. Deterministic (stable iteration order, strict-improvement threshold), so the
 * same fleet always yields the same proposal. Pure — never mutates the input.
 */
export function proposePowerBalance(devices: Device[]): PowerBalanceProposal {
  let a = 0;
  let b = 0;
  const movable: { id: string; w: number; orig: 'A' | 'B'; feed: 'A' | 'B' }[] = [];
  for (const d of devices) {
    const w = d.watts ?? 0;
    if (w <= 0) continue;
    const feed = d.powerFeed ?? 'A';
    if (feed === 'AB') {
      a += w / 2;
      b += w / 2;
    } else if (feed === 'B') {
      b += w;
      movable.push({ id: d.id, w, orig: 'B', feed: 'B' });
    } else {
      a += w;
      movable.push({ id: d.id, w, orig: 'A', feed: 'A' });
    }
  }

  const beforeDiff = Math.abs(a - b);
  let improved = true;
  while (improved) {
    improved = false;
    let best: (typeof movable)[number] | null = null;
    let bestDiff = Math.abs(a - b);
    for (const m of movable) {
      const na = m.feed === 'A' ? a - m.w : a + m.w;
      const nb = m.feed === 'A' ? b + m.w : b - m.w;
      const nd = Math.abs(na - nb);
      if (nd < bestDiff - 1e-9) {
        bestDiff = nd;
        best = m;
      }
    }
    if (best) {
      a = best.feed === 'A' ? a - best.w : a + best.w;
      b = best.feed === 'A' ? b + best.w : b - best.w;
      best.feed = best.feed === 'A' ? 'B' : 'A';
      improved = true;
    }
  }

  const flips: PowerFlip[] = [];
  let movedWatts = 0;
  for (const m of movable) {
    if (m.feed !== m.orig) {
      flips.push({ deviceId: m.id, from: m.orig, to: m.feed });
      movedWatts += m.w;
    }
  }
  return {
    flips,
    beforeDiff,
    afterDiff: Math.abs(a - b),
    movedWatts,
    remainingSingleCorded: movable.length,
  };
}

/** Analyze power feeds across the given devices (only those that actually draw power). */
export function powerFeedAnalysis(devices: Device[]): PowerFeedAnalysis {
  let normalA = 0, normalB = 0, failoverA = 0, failoverB = 0, dualCorded = 0, singleCorded = 0;
  for (const d of devices) {
    const w = d.watts ?? 0;
    if (w <= 0) continue;
    const feed = d.powerFeed ?? 'A';
    if (feed === 'AB') {
      dualCorded++;
      normalA += w / 2;
      normalB += w / 2;
      failoverA += w; // if B dies, A carries the whole device
      failoverB += w;
    } else if (feed === 'B') {
      singleCorded++;
      normalB += w;
      failoverB += w; // A dying doesn't affect a B-only device; B dying takes it down (0 to A)
    } else {
      singleCorded++;
      normalA += w;
      failoverA += w;
    }
  }
  return { normalA, normalB, failoverA, failoverB, dualCorded, singleCorded };
}
