/**
 * Resilience scan — find every single point of failure, proactively.
 *
 * The Flow lens lets you pull one device at a time and watch the blast radius. This
 * does that pull for *every* device at once and reports the ones that matter: the
 * devices whose failure isolates something else from the network. It turns failure
 * reasoning from a manual hunt ("which box should I click?") into an exhaustive
 * answer ("these three are your weak points, worst first").
 *
 * Pure and canvas-free. It answers the same question as the `blastRadius` engine
 * Flow uses on click — same egress set, same adjacency — so a scan result and a
 * click on the same device always agree (resilience.test checks that against
 * blastRadius on random graphs). The store action selects the reported devices so
 * each can be hardened with "Add a redundant twin".
 */
import type { Device, DeviceType, Link } from '@/model/types';
import { egressNodes, isEgressType } from './blastRadius';
import { planTwin } from './redundancy';

export interface Spof {
  deviceId: string;
  /** How many OTHER devices lose the network when this one fails. */
  isolates: number;
}

/**
 * Every single point of failure in the drawn topology: a device whose failure
 * isolates at least one OTHER device from a surviving egress. Ranked worst-first by
 * blast size, ties broken by id so the order is stable. Only linked devices are
 * tested — an unlinked node can isolate no one, so it's never a SPOF.
 *
 * O(V+E) — one articulation-point pass (see below).
 */
export function findSpofs(devices: Device[], links: Link[]): Spof[] {
  // "Isolated by d" = reachable from the egress set before, from no surviving
  // egress after. Join every egress to one virtual root and that's a cut vertex
  // question: d cuts off each DFS subtree below it whose lowpoint can't climb past
  // d. One iterative Tarjan pass — O(V+E) instead of a blast per device.
  const ROOT = '\u0000root';
  const adj = new Map<string, string[]>();
  for (const d of devices) adj.set(d.id, []);
  const seenPair = new Set<string>();
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    const a = adj.get(l.sourceId);
    const b = adj.get(l.targetId);
    if (!a || !b) continue; // dangling endpoint (validate.ts reports that)
    const key = l.sourceId < l.targetId ? `${l.sourceId}|${l.targetId}` : `${l.targetId}|${l.sourceId}`;
    if (seenPair.has(key)) continue; // parallel links: one adjacency
    seenPair.add(key);
    a.push(l.targetId);
    b.push(l.sourceId);
  }
  const egress = egressNodes(devices, links);
  if (egress.length === 0) return [];
  adj.set(ROOT, egress);
  for (const e of egress) adj.get(e)!.push(ROOT);

  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const size = new Map<string, number>();
  const isolates = new Map<string, number>();
  let time = 0;
  // Explicit stack: [node, parent, next-neighbor index] — no recursion depth limit.
  const stack: [string, string | null, number][] = [[ROOT, null, 0]];
  disc.set(ROOT, time);
  low.set(ROOT, time++);
  size.set(ROOT, 1);
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const [u, parent, i] = top;
    const nbrs = adj.get(u)!;
    if (i < nbrs.length) {
      top[2] = i + 1;
      const v = nbrs[i]!;
      if (v === parent) continue;
      if (disc.has(v)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      } else {
        disc.set(v, time);
        low.set(v, time++);
        size.set(v, 1);
        stack.push([v, u, 0]);
      }
      continue;
    }
    stack.pop();
    if (parent === null) continue;
    low.set(parent, Math.min(low.get(parent)!, low.get(u)!));
    size.set(parent, size.get(parent)! + size.get(u)!);
    // u's subtree can't reach above `parent` without it: failing `parent` cuts it off.
    if (parent !== ROOT && low.get(u)! >= disc.get(parent)!) {
      isolates.set(parent, (isolates.get(parent) ?? 0) + size.get(u)!);
    }
  }

  const spofs: Spof[] = [...isolates].map(([deviceId, n]) => ({ deviceId, isolates: n }));
  spofs.sort(
    (a, b) =>
      b.isolates - a.isolates ||
      (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0),
  );
  return spofs;
}

/**
 * For each linked device d: how many single points of failure the design would
 * have with d deleted (with its links) — `findSpofs(without d).length`, for every
 * d at once. This is what "no single point of failure" leans on: a device whose
 * deletion leaves SPOFs holds that rule up.
 *
 * Still one cut-vertex pass per device (no shortcut is exact here), but on a graph
 * indexed once — int arrays, reused buffers, egress re-derived for the reduced
 * graph the way `egressNodes` would — so a 1000-device design stays interactive.
 * Devices absent from the map leave none. resilience.test checks it against
 * findSpofs on the reduced graph.
 */
export function spofCountsWithout(devices: Device[], links: Link[]): Map<string, number> {
  const n = devices.length;
  const index = new Map(devices.map((d, i) => [d.id, i]));
  const sets: Set<number>[] = devices.map(() => new Set());
  for (const l of links) {
    const a = index.get(l.sourceId);
    const b = index.get(l.targetId);
    if (a === undefined || b === undefined || a === b) continue;
    sets[a]!.add(b);
    sets[b]!.add(a);
  }
  const adj = sets.map((x) => [...x]);
  const egressType = devices.map((d) => isEgressType(d.type));
  const ROOT = n; // virtual root, joined to the egress set
  const disc = new Int32Array(n + 1);
  const low = new Int32Array(n + 1);
  const parent = new Int32Array(n + 1);
  const next = new Int32Array(n + 1); // next neighbor to visit; ROOT's are the egress list
  const cut = new Uint8Array(n);
  const stack = new Int32Array(n + 1);
  const out = new Map<string, number>();

  for (let d = 0; d < n; d++) {
    if (adj[d]!.length === 0) continue; // unlinked: deleting it changes no path
    // Degrees once d is gone, and the egress set `egressNodes` would pick.
    const isNbr = new Set(adj[d]);
    const deg = (v: number) => adj[v]!.length - (isNbr.has(v) ? 1 : 0);
    const egress: number[] = [];
    for (let v = 0; v < n; v++) if (v !== d && egressType[v] && deg(v) > 0) egress.push(v);
    if (egress.length === 0) {
      let max = 0;
      for (let v = 0; v < n; v++) if (v !== d) max = Math.max(max, deg(v));
      if (max > 0) for (let v = 0; v < n; v++) if (v !== d && deg(v) === max) egress.push(v);
    }
    if (egress.length === 0) continue;
    const isEgress = new Set(egress);

    disc.fill(-1);
    cut.fill(0);
    let time = 0;
    let sp = 0;
    disc[ROOT] = low[ROOT] = time++;
    parent[ROOT] = -1;
    next[ROOT] = 0;
    stack[sp++] = ROOT;
    while (sp > 0) {
      const u = stack[sp - 1]!;
      const nbrs = u === ROOT ? egress : adj[u]!;
      // Egress devices are also adjacent to the root.
      const extra = u !== ROOT && isEgress.has(u) ? 1 : 0;
      if (next[u]! < nbrs.length + extra) {
        const k = next[u]!;
        next[u] = k + 1;
        const v = k < nbrs.length ? nbrs[k]! : ROOT;
        if (v === d || v === parent[u]) continue;
        if (disc[v]! >= 0) {
          if (disc[v]! < low[u]!) low[u] = disc[v]!;
        } else {
          disc[v] = low[v] = time++;
          parent[v] = u;
          next[v] = 0;
          stack[sp++] = v;
        }
        continue;
      }
      sp--;
      const p = parent[u]!;
      if (p < 0) continue;
      if (low[u]! < low[p]!) low[p] = low[u]!;
      if (p !== ROOT && low[u]! >= disc[p]!) cut[p] = 1;
    }
    let spofs = 0;
    for (let v = 0; v < n; v++) spofs += cut[v]!;
    if (spofs > 0) out.set(devices[d]!.id, spofs);
  }
  return out;
}

/**
 * External/abstract nodes you can't make redundant by drawing a box: the internet,
 * someone else's cloud, a cloud VPC/subnet. A second ISP or cloud region is a real
 * architectural decision with cost and contracts behind it — never something to add
 * silently. "Harden" leaves these as-is and reports them instead.
 */
export const NON_TWINNABLE: ReadonlySet<DeviceType> = new Set<DeviceType>([
  'isp',
  'cloud',
  'vpc',
  'cloud-subnet',
]);

export interface HardenStep {
  deviceId: string;
  /** Neighbors the twin must re-connect to (from planTwin). */
  neighborIds: string[];
}

export interface HardenPlan {
  /** Internal single points of failure to twin, worst-first. */
  steps: HardenStep[];
  /** SPOFs left untouched because they're external/abstract (a 2nd ISP/cloud is a
   *  deliberate choice) — reported so the result is honest about what it didn't fix. */
  skippedExternal: string[];
}

/**
 * Plan to harden a design: twin every INTERNAL single point of failure so none of
 * them can isolate the network alone. Composes the scan (findSpofs) with the twin
 * decision (planTwin), skipping external/abstract nodes. Since a twin only ever adds
 * a parallel path, planning once against the original graph is sufficient — twinning
 * these devices removes exactly these SPOFs and introduces no new ones.
 */
export function planHardening(devices: Device[], links: Link[]): HardenPlan {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const steps: HardenStep[] = [];
  const skippedExternal: string[] = [];
  for (const sp of findSpofs(devices, links)) {
    const d = byId.get(sp.deviceId);
    if (!d) continue;
    if (NON_TWINNABLE.has(d.type)) {
      skippedExternal.push(sp.deviceId);
      continue;
    }
    const twin = planTwin(sp.deviceId, links);
    if (twin) steps.push({ deviceId: sp.deviceId, neighborIds: twin.neighborIds });
  }
  return { steps, skippedExternal };
}
