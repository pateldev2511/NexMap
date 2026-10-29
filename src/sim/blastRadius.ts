/**
 * Blast-radius analysis — the brain behind Flow mode ("stress-test your design").
 *
 * Given a set of FAILED devices, it answers the question every network person feels
 * in their gut: *what loses its connection to the rest of the network if this dies?*
 *
 * The honest claim (see NEXMAP-REIMAGINED.md): this is **reachability over the drawn
 * graph**, not routing and not a traffic model. A device is "isolated" when it could
 * reach the network's egress/core before the failure but cannot reach ANY surviving
 * egress after it. Measuring against the *set* of egress nodes (not a single anchor)
 * is what makes redundant uplinks read as resilient instead of a false total outage.
 *
 * Pure, canvas-free, O(V+E) — safe to run on every hover. Mirrors the undirected
 * adjacency build in lib/health.ts (the existing SPOF/bridge engine).
 */
import type { Device, DeviceType, Link } from '@/model/types';

export interface BlastResult {
  /** The devices the user pulled (failed). */
  failed: Set<string>;
  /** Devices that lost all reachability to a surviving egress because of the failure. */
  isolated: Set<string>;
  /** Devices still reachable from a surviving egress (the survivors). */
  survived: Set<string>;
  /** A representative egress node for display, or null when the graph has no edges. */
  anchor: string | null;
  /** Link ids with at least one failed-or-isolated endpoint (the "dead" wave). */
  deadLinks: Set<string>;
}

/** Devices nearer the edge/egress make the most honest reference for "reachable". */
const EGRESS_RANK: Partial<Record<DeviceType, number>> = {
  isp: 6,
  'internet-gateway': 5,
  'nat-gateway': 4,
  'vpn-gateway': 3,
  router: 2,
  firewall: 1,
};

/** Undirected adjacency, skipping self-loops, dangling endpoints, and `exclude`d nodes. */
function buildAdjacency(
  devices: Device[],
  links: Link[],
  exclude: Set<string>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const d of devices) if (!exclude.has(d.id)) adj.set(d.id, new Set());
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    if (exclude.has(l.sourceId) || exclude.has(l.targetId)) continue;
    const a = adj.get(l.sourceId);
    const b = adj.get(l.targetId);
    if (!a || !b) continue; // endpoint missing (validate.ts reports that separately)
    a.add(l.targetId);
    b.add(l.sourceId);
  }
  return adj;
}

/** Multi-source flood fill: everything reachable from ANY of `sources`. */
function reachableFrom(adj: Map<string, Set<string>>, sources: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const s of sources) {
    if (adj.has(s) && !seen.has(s)) {
      seen.add(s);
      stack.push(s);
    }
  }
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

/**
 * The egress/core nodes reachability is measured against: every linked device with
 * an egress role (ISP / gateway / router / firewall). When a diagram has no such
 * device, the single highest-degree linked node stands in as "the hub" (ties broken
 * by id for determinism), so failing it still reads as isolating its dependents.
 */
export function egressNodes(devices: Device[], links: Link[]): string[] {
  const adj = buildAdjacency(devices, links, new Set());
  const linked = devices.filter((d) => (adj.get(d.id)?.size ?? 0) > 0);
  const ranked = linked
    .filter((d) => (EGRESS_RANK[d.type] ?? 0) > 0)
    .sort((a, b) => (EGRESS_RANK[b.type]! - EGRESS_RANK[a.type]!) || (a.id < b.id ? -1 : 1));
  if (ranked.length) return ranked.map((d) => d.id);

  let best: string | null = null;
  let bestDeg = -1;
  for (const d of linked) {
    const deg = adj.get(d.id)!.size;
    if (deg > bestDeg || (deg === bestDeg && best !== null && d.id < best)) {
      bestDeg = deg;
      best = d.id;
    }
  }
  return best ? [best] : [];
}

/** A single representative egress for display ("rerouted via core-b" etc.). */
export function networkAnchor(devices: Device[], links: Link[]): string | null {
  return egressNodes(devices, links)[0] ?? null;
}

/**
 * Compute what the failure of `failed` does to the rest of the network.
 * `failed` may be one device (a single click) or several (cascading what-ifs).
 */
export function blastRadius(
  devices: Device[],
  links: Link[],
  failed: Iterable<string>,
): BlastResult {
  const failedSet = new Set(failed);
  const egress = egressNodes(devices, links);
  const anchor = egress[0] ?? null;

  const before = reachableFrom(buildAdjacency(devices, links, new Set()), egress);
  const survivingEgress = egress.filter((id) => !failedSet.has(id));
  const after = reachableFrom(buildAdjacency(devices, links, failedSet), survivingEgress);

  const isolated = new Set<string>();
  for (const id of before) {
    if (!failedSet.has(id) && !after.has(id)) isolated.add(id);
  }

  const deadLinks = new Set<string>();
  for (const l of links) {
    if (
      failedSet.has(l.sourceId) ||
      failedSet.has(l.targetId) ||
      isolated.has(l.sourceId) ||
      isolated.has(l.targetId)
    ) {
      deadLinks.add(l.id);
    }
  }

  return { failed: failedSet, isolated, survived: after, anchor, deadLinks };
}
