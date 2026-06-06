/**
 * Topology health — NexMap's intelligence moat. Beyond "is this data valid?" (validate.ts),
 * this answers "is this network sound?": single points of failure, fragmented topology,
 * contradictory parallel links, and path redundancy between critical nodes.
 *
 * Per the eng-review lock, this runs MAIN-THREAD and debounced: every check here is O(V+E)
 * and sub-frame even at a few thousand nodes. The articulation-point pass is ITERATIVE (not
 * recursive) so a long linear chain can't overflow the JS stack. The one superlinear check —
 * edge-disjoint path redundancy — is OPT-IN, computed on demand between two user-chosen
 * devices, never in the debounced sweep.
 *
 * Pure and canvas-free. Emits the same ValidationIssue shape as validate.ts so the existing
 * issue list / badges / jump-to-object all work unchanged.
 */
import type { Device, Link, ValidationIssue } from '@/model/types';

let counter = 0;
function hid(): string {
  return `h${counter++}`;
}
/** Reset health issue ids (call before a fresh analysis so ids are stable per run). */
export function resetHealthIds(): void {
  counter = 0;
}

export interface HealthReport {
  issues: ValidationIssue[];
  /** 0–100 soundness score (100 = no health issues). */
  score: number;
  /** Device ids that are single points of failure. */
  spofIds: string[];
  /** Number of disconnected components among connected devices. */
  componentCount: number;
  /** True if any link is reachability-inferred (results should be read with that caveat). */
  scanDerived: boolean;
  /**
   * Sorted `"a|b"` device-pair keys whose single connecting link is a bridge — losing
   * that link splits the network. Only pairs with exactly ONE link are included
   * (parallel members provide an alternate path, so they're never critical).
   */
  criticalLinkPairs: string[];
  /** Link ids flagged by the conflicting-parallel-links check. */
  conflictLinkIds: string[];
}

/** Build an undirected adjacency map over devices, ignoring self-loops and dangling links. */
function buildAdjacency(devices: Device[], links: Link[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const d of devices) adj.set(d.id, new Set());
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    const a = adj.get(l.sourceId);
    const b = adj.get(l.targetId);
    if (!a || !b) continue; // endpoint missing (validate.ts reports that separately)
    a.add(l.targetId);
    b.add(l.sourceId);
  }
  return adj;
}

/**
 * Articulation points (cut vertices) of an undirected graph — devices whose removal would
 * disconnect part of the network. Iterative DFS (stack-safe). Standard low-link algorithm.
 */
export function articulationPoints(adj: Map<string, Set<string>>): Set<string> {
  return cutVerticesAndBridges(adj).cut;
}

/**
 * Cut vertices AND bridges (cut edges) in one DFS. A bridge is an edge whose removal
 * disconnects the graph — "a link whose loss splits the network." Bridges are returned
 * as sorted `"a|b"` device-pair keys. NOTE: computed on the SIMPLE graph (parallel links
 * collapse in the adjacency Set), so a returned pair is only a *real* critical link when
 * that device pair has exactly one link — the caller checks group size.
 */
export function cutVerticesAndBridges(adj: Map<string, Set<string>>): {
  cut: Set<string>;
  bridges: Set<string>;
} {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cut = new Set<string>();
  const bridges = new Set<string>();
  let timer = 0;

  for (const start of adj.keys()) {
    if (disc.has(start)) continue;
    parent.set(start, null);
    let rootChildren = 0;

    // Each frame tracks a node and an iterator over its neighbors.
    const stack: { node: string; iter: Iterator<string> }[] = [];
    disc.set(start, timer);
    low.set(start, timer);
    timer++;
    stack.push({ node: start, iter: adj.get(start)!.values() });

    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const next = frame.iter.next();
      if (next.done) {
        // Done exploring `frame.node`: fold its low-link into its parent and test cut.
        stack.pop();
        const p = parent.get(frame.node) ?? null;
        if (p !== null) {
          low.set(p, Math.min(low.get(p)!, low.get(frame.node)!));
          // Non-root parent is a cut vertex if a child can't reach above it.
          if (parent.get(p) !== null && low.get(frame.node)! >= disc.get(p)!) {
            cut.add(p);
          }
          // Edge (p, frame.node) is a bridge if the child can't reach p or above.
          if (low.get(frame.node)! > disc.get(p)!) {
            bridges.add([p, frame.node].sort().join('|'));
          }
        }
        continue;
      }
      const to = next.value;
      if (!disc.has(to)) {
        if (frame.node === start) rootChildren++;
        parent.set(to, frame.node);
        disc.set(to, timer);
        low.set(to, timer);
        timer++;
        stack.push({ node: to, iter: adj.get(to)!.values() });
      } else if (to !== parent.get(frame.node)) {
        // Back edge.
        low.set(frame.node, Math.min(low.get(frame.node)!, disc.get(to)!));
      }
    }

    // The DFS root is a cut vertex iff it has more than one DFS child.
    if (rootChildren > 1) cut.add(start);
  }
  return { cut, bridges };
}

/** Count connected components among devices that have at least one link. */
function countComponents(devices: Device[], adj: Map<string, Set<string>>): number {
  const seen = new Set<string>();
  let components = 0;
  for (const d of devices) {
    if (adj.get(d.id)!.size === 0) continue; // isolated; validate.ts flags as orphan
    if (seen.has(d.id)) continue;
    components++;
    const stack = [d.id];
    seen.add(d.id);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of adj.get(cur)!) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
  }
  return components;
}

/** Detect parallel links between the same pair that disagree on VLAN or access/trunk mode. */
function conflictingParallelLinks(links: Link[]): ValidationIssue[] {
  const groups = new Map<string, Link[]>();
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    const key = [l.sourceId, l.targetId].sort().join('|');
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(l);
  }
  const issues: ValidationIssue[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const vlans = new Set(group.map((l) => l.vlan ?? '').filter(Boolean));
    const modes = new Set(group.map((l) => l.mode ?? '').filter(Boolean));
    if (vlans.size > 1 || modes.size > 1) {
      issues.push({
        id: hid(),
        severity: 'warn',
        code: 'conflicting-parallel-links',
        message: `Parallel links between the same devices disagree on ${
          vlans.size > 1 ? 'VLAN' : 'access/trunk mode'
        }.`,
        objectIds: group.map((l) => l.id),
      });
    }
  }
  return issues;
}

/**
 * Analyze topology soundness. Cheap (O(V+E)) checks only — safe to run main-thread on every
 * debounced edit. Use `edgeDisjointPaths` separately for the opt-in redundancy check.
 */
export function analyzeHealth(devices: Device[], links: Link[]): HealthReport {
  resetHealthIds();
  const issues: ValidationIssue[] = [];
  const adj = buildAdjacency(devices, links);
  const idToName = new Map(devices.map((d) => [d.id, d.name]));

  // Single points of failure + bridges (critical links) in one DFS.
  const { cut: spof, bridges } = cutVerticesAndBridges(adj);
  const spofIds = [...spof];

  // A bridge pair is a *critical link* only when the pair has exactly one link
  // (parallel members provide an alternate path). pairKey = sorted "a|b".
  const pairCount = new Map<string, number>();
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    const k = [l.sourceId, l.targetId].sort().join('|');
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  const criticalLinkPairs = [...bridges].filter((k) => (pairCount.get(k) ?? 0) === 1);
  for (const id of spofIds) {
    issues.push({
      id: hid(),
      severity: 'warn',
      code: 'spof',
      message: `${idToName.get(id) ?? id} is a single point of failure — its loss splits the network.`,
      objectIds: [id],
    });
  }

  // Fragmented topology (more than one connected island of linked devices).
  const componentCount = countComponents(devices, adj);
  if (componentCount > 1) {
    issues.push({
      id: hid(),
      severity: 'info',
      code: 'fragmented-topology',
      message: `Topology has ${componentCount} disconnected segments — there is no path between them.`,
      objectIds: [],
    });
  }

  // Contradictory parallel links.
  issues.push(...conflictingParallelLinks(links));

  // Reachability-inferred edges caveat (import fidelity).
  const scanDerived = links.some((l) => l.inferred);
  if (scanDerived) {
    issues.push({
      id: hid(),
      severity: 'info',
      code: 'scan-derived-topology',
      message:
        'Some links are reachability-inferred (e.g. from a scan), not confirmed L2 adjacencies — read SPOF and redundancy results with that caveat.',
      objectIds: links.filter((l) => l.inferred).map((l) => l.id),
    });
  }

  // Soundness score: each SPOF -8, each conflicting-link group -5, fragmentation -10, floor 0.
  let score = 100;
  score -= spofIds.length * 8;
  score -= issues.filter((i) => i.code === 'conflicting-parallel-links').length * 5;
  if (componentCount > 1) score -= 10;
  score = Math.max(0, Math.min(100, score));

  const conflictLinkIds = issues
    .filter((i) => i.code === 'conflicting-parallel-links')
    .flatMap((i) => i.objectIds);

  return {
    issues,
    score,
    spofIds,
    componentCount,
    scanDerived,
    criticalLinkPairs,
    conflictLinkIds,
  };
}

/**
 * Maximum number of edge-disjoint paths between two devices (= the network's redundancy
 * between them, by Menger's theorem). 0 = no path; 1 = a single chain (any link cut isolates
 * them); ≥2 = redundant. Unit-capacity max-flow via BFS-augmenting (Edmonds–Karp). OPT-IN
 * only — do not call in the debounced sweep.
 */
export function edgeDisjointPaths(
  devices: Device[],
  links: Link[],
  sourceId: string,
  targetId: string,
): number {
  if (sourceId === targetId) return 0;
  const has = new Set(devices.map((d) => d.id));
  if (!has.has(sourceId) || !has.has(targetId)) return 0;

  // Residual capacities keyed "a>b". Each undirected link contributes cap 1 each direction.
  const cap = new Map<string, number>();
  const out = new Map<string, Set<string>>();
  const arc = (a: string, b: string) => {
    cap.set(`${a}>${b}`, (cap.get(`${a}>${b}`) ?? 0) + 1);
    (out.get(a) ?? out.set(a, new Set()).get(a)!).add(b);
    if (!out.has(b)) out.set(b, new Set());
  };
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    if (!has.has(l.sourceId) || !has.has(l.targetId)) continue;
    arc(l.sourceId, l.targetId);
    arc(l.targetId, l.sourceId);
  }

  let flow = 0;
  // BFS for an augmenting path along edges with residual capacity.
  for (;;) {
    const prev = new Map<string, string>();
    const queue = [sourceId];
    prev.set(sourceId, sourceId);
    let reached = false;
    while (queue.length && !reached) {
      const u = queue.shift()!;
      for (const v of out.get(u) ?? []) {
        if (prev.has(v) || (cap.get(`${u}>${v}`) ?? 0) <= 0) continue;
        prev.set(v, u);
        if (v === targetId) {
          reached = true;
          break;
        }
        queue.push(v);
      }
    }
    if (!reached) break;
    // Augment by 1 along the found path.
    let v = targetId;
    while (v !== sourceId) {
      const u = prev.get(v)!;
      cap.set(`${u}>${v}`, cap.get(`${u}>${v}`)! - 1);
      cap.set(`${v}>${u}`, (cap.get(`${v}>${u}`) ?? 0) + 1);
      v = u;
    }
    flow++;
  }
  return flow;
}
