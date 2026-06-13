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
