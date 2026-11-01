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
  /**
   * Link ids that carry traffic toward egress ONLY after the failure — the backup
   * paths that "light up" as survivors find a detour. Computed as edges newly on a
   * shortest path to egress (BFS layers) that weren't before, excluding dead links.
   */
  rerouted: Set<string>;
}

/** Devices nearer the edge/egress make the most honest reference for "reachable". */
const EGRESS_RANK: Partial<Record<DeviceType, number>> = {
  isp: 6,
  'internet-gateway': 5,
  'nat-gateway': 4,
  'vpn-gateway': 3,
  router: 2,
  firewall: 1,
  // A load balancer is the ingress to an app tier — the entry point reachability
  // is measured against when no higher-ranked edge device is present (e.g. a
  // three-tier app with no router/firewall drawn). Ranked below the real edge so
  // an ISP/firewall still wins whenever one exists.
  'load-balancer': 1,
};

/** Whether a device type can stand as egress (see `egressNodes`). */
export function isEgressType(type: DeviceType): boolean {
  return (EGRESS_RANK[type] ?? 0) > 0;
}

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

/**
 * Multi-source BFS. Returns the hop distance (0 at the sources) of every reachable
 * node — `.has(id)` doubles as the reachable set, and the layers let us tell which
 * edges lie on a shortest path toward egress.
 */
function bfsLayers(adj: Map<string, Set<string>>, sources: Iterable<string>): Map<string, number> {
  const dist = new Map<string, number>();
  let frontier: string[] = [];
  for (const s of sources) {
    if (adj.has(s) && !dist.has(s)) {
      dist.set(s, 0);
      frontier.push(s);
    }
  }
  let depth = 0;
  while (frontier.length) {
    depth++;
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        if (!dist.has(v)) {
          dist.set(v, depth);
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Link ids that lie on a shortest path toward egress given BFS layer distances:
 * both endpoints reachable and exactly one hop apart. These are the edges that
 * could carry traffic toward the egress set.
 */
function activeLinks(links: Link[], dist: Map<string, number>): Set<string> {
  const active = new Set<string>();
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    const a = dist.get(l.sourceId);
    const b = dist.get(l.targetId);
    if (a === undefined || b === undefined) continue;
    if (Math.abs(a - b) === 1) active.add(l.id);
  }
  return active;
}

/**
 * The egress/core nodes reachability is measured against: every linked device with
 * an egress role (ISP / gateway / router / firewall / LB). When a diagram has no
 * such device, EVERY linked node tied at the maximum degree stands in as "the
 * core" — not just one. That matters for redundant fabrics with no edge device
 * drawn (dual top-of-rack switches, a dual-core pair): picking a single anchor
 * would make failing it read as a total outage even though its twin survives.
 * Order is resolved by id so the result is deterministic.
 */
export function egressNodes(devices: Device[], links: Link[]): string[] {
  const adj = buildAdjacency(devices, links, new Set());
  const linked = devices.filter((d) => (adj.get(d.id)?.size ?? 0) > 0);
  const ranked = linked
    .filter((d) => (EGRESS_RANK[d.type] ?? 0) > 0)
    .sort((a, b) => (EGRESS_RANK[b.type]! - EGRESS_RANK[a.type]!) || (a.id < b.id ? -1 : 1));
  if (ranked.length) return ranked.map((d) => d.id);

  let maxDeg = 0;
  for (const d of linked) maxDeg = Math.max(maxDeg, adj.get(d.id)!.size);
  if (maxDeg === 0) return [];
  return linked
    .filter((d) => adj.get(d.id)!.size === maxDeg)
    .map((d) => d.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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

  const distBefore = bfsLayers(buildAdjacency(devices, links, new Set()), egress);
  const survivingEgress = egress.filter((id) => !failedSet.has(id));
  const distAfter = bfsLayers(buildAdjacency(devices, links, failedSet), survivingEgress);

  const isolated = new Set<string>();
  for (const id of distBefore.keys()) {
    if (!failedSet.has(id) && !distAfter.has(id)) isolated.add(id);
  }
  const survived = new Set(distAfter.keys());

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

  // Backups that light up as traffic finds a detour: any edge newly on a shortest
  // path (equal-length alternates), PLUS the full new path every survivor whose
  // route got longer now takes — so you watch the whole detour, not one lone hop.
  const activeBefore = activeLinks(links, distBefore);
  const afterActive = activeLinks(links, distAfter);
  const rerouted = new Set<string>();
  for (const id of afterActive) {
    if (!activeBefore.has(id) && !deadLinks.has(id)) rerouted.add(id);
  }

  const afterAdj = buildAdjacency(devices, links, failedSet);
  const pairLink = new Map<string, string>();
  for (const l of links) {
    if (l.sourceId === l.targetId || deadLinks.has(l.id)) continue;
    pairLink.set(`${l.sourceId}|${l.targetId}`, l.id);
    pairLink.set(`${l.targetId}|${l.sourceId}`, l.id);
  }
  for (const [id, dAfter] of distAfter) {
    const dBefore = distBefore.get(id);
    if (dBefore === undefined || dAfter <= dBefore) continue; // route didn't get longer
    let cur = id;
    for (let guard = 0; (distAfter.get(cur) ?? 0) > 0 && guard <= devices.length; guard++) {
      const dc = distAfter.get(cur)!;
      let stepped = false;
      for (const nb of afterAdj.get(cur) ?? []) {
        if (distAfter.get(nb) === dc - 1) {
          const lid = pairLink.get(`${cur}|${nb}`);
          if (lid) rerouted.add(lid);
          cur = nb;
          stepped = true;
          break;
        }
      }
      if (!stepped) break;
    }
  }

  return { failed: failedSet, isolated, survived, anchor, deadLinks, rerouted };
}
