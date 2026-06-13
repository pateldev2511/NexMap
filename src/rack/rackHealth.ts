/**
 * Physical-cabling health for the rack designer (schema v3).
 *
 * Beyond the two HARD blocks enforced at connect time (self-cable, port-already-cabled in
 * rackCables.ts), this is the WARN layer: it inspects the physical RackCable graph and
 * surfaces non-blocking issues — loops (a ring that a real switch storms on without STP),
 * single points of failure, bridge cables, speed/media mismatches, and cross-rack sanity.
 *
 * It REUSES the network designer's graph algorithms (cutVerticesAndBridges /
 * articulationPoints in lib/health.ts) by feeding them an adjacency built from cables, and
 * emits the same ValidationIssue shape so the existing issue list / badges / jump-to-object
 * all work unchanged. Pure + deterministic. Warns, never blocks.
 */
import type { Device, RackCable, ValidationIssue } from '@/model/types';
import { cutVerticesAndBridges } from '@/lib/health';

export interface CablingReport {
  issues: ValidationIssue[];
  /** Ids of cables that close a physical loop (potential broadcast storm without STP). */
  loopCableIds: string[];
  /** Device ids that are single points of failure on the physical graph. */
  spofIds: string[];
}

const pairKey = (a: string, b: string): string => [a, b].sort().join('|');

/** Undirected adjacency over devices from cables (ignores self-loops + missing endpoints). */
function cableAdjacency(devices: Device[], cables: RackCable[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const d of devices) adj.set(d.id, new Set());
  for (const c of cables) {
    const a = c.aEnd.deviceId;
    const b = c.bEnd.deviceId;
    if (a === b) continue;
    const sa = adj.get(a);
    const sb = adj.get(b);
    if (!sa || !sb) continue;
    sa.add(b);
    sb.add(a);
  }
  return adj;
}

/**
 * Cables that close a loop. Union-find over UNIQUE device pairs (so a bundle of parallel
 * links between the same two devices — link aggregation — is not mistaken for a ring). A
 * pair whose endpoints are already connected closes a cycle of length ≥ 3.
 */
function loopClosingCables(cables: RackCable[]): Set<string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) {
      const nx = parent.get(x)!;
      parent.set(x, r);
      x = nx;
    }
    return r;
  };
  const ensure = (x: string) => { if (!parent.has(x)) parent.set(x, x); };

  const seenPairs = new Set<string>();
  const loopCables = new Set<string>();
  for (const c of cables) {
    const a = c.aEnd.deviceId;
    const b = c.bEnd.deviceId;
    if (a === b) continue;
    const key = pairKey(a, b);
    if (seenPairs.has(key)) continue; // parallel bundle — collapse to one edge
    seenPairs.add(key);
    ensure(a); ensure(b);
    if (find(a) === find(b)) loopCables.add(c.id); // closes a ring
    else parent.set(find(a), find(b));
  }
  return loopCables;
}

/**
 * Analyze the physical cabling. Pure: builds a fresh issue list with stable per-run ids.
 * Every issue is severity 'warn' — this layer never blocks a connection.
 */
export function analyzeCabling(devices: Device[], cables: RackCable[]): CablingReport {
  const devById = new Map(devices.map((d) => [d.id, d]));
  const ifaceOf = (deviceId: string, ifaceId: string) =>
    devById.get(deviceId)?.interfaces?.find((i) => i.id === ifaceId);
  const nameOf = (deviceId: string) => devById.get(deviceId)?.name ?? deviceId;

  const issues: ValidationIssue[] = [];
  let n = 0;
  const push = (code: string, message: string, objectIds: string[]) =>
    issues.push({ id: `rc${n++}`, severity: 'warn', code, message, objectIds });

  // 1. Loops (STP) — cables that close a ring.
  const loopCables = loopClosingCables(cables);
  for (const c of cables) {
    if (!loopCables.has(c.id)) continue;
    push(
      'rack-loop',
      `Cable ${nameOf(c.aEnd.deviceId)} ↔ ${nameOf(c.bEnd.deviceId)} closes a physical loop — a switch will storm on this without spanning-tree (STP).`,
      [c.id, c.aEnd.deviceId, c.bEnd.deviceId],
    );
  }

  // 2 & 3. SPOF (cut vertices) + bridge cables, via the shared graph algorithm.
  const adj = cableAdjacency(devices, cables);
  const { cut, bridges } = cutVerticesAndBridges(adj);
  // only count pairs with exactly one cable as a true critical link (parallels are redundant)
  const pairCount = new Map<string, number>();
  for (const c of cables) {
    if (c.aEnd.deviceId === c.bEnd.deviceId) continue;
    const k = pairKey(c.aEnd.deviceId, c.bEnd.deviceId);
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  const spofIds = [...cut];
  for (const id of spofIds) {
    push('rack-spof', `${nameOf(id)} is a single point of failure — losing it splits the cabled network.`, [id]);
  }
  for (const key of bridges) {
    if ((pairCount.get(key) ?? 0) !== 1) continue;
    const [a, b] = key.split('|') as [string, string];
    // Only interesting when the cable joins two non-trivial sub-networks; a single uplink
    // to a leaf device (degree 1) is the normal, expected case and would just be noise.
    if ((adj.get(a)?.size ?? 0) < 2 || (adj.get(b)?.size ?? 0) < 2) continue;
    push('rack-bridge', `The single cable between ${nameOf(a)} and ${nameOf(b)} is critical — losing it splits the network. Consider a redundant run.`, [a, b]);
  }

  // 4. Per-cable lint: speed / media mismatch, unmounted endpoint, cross-rack-no-length.
  for (const c of cables) {
    const a = devById.get(c.aEnd.deviceId);
    const b = devById.get(c.bEnd.deviceId);
    const ia = ifaceOf(c.aEnd.deviceId, c.aEnd.ifaceId);
    const ib = ifaceOf(c.bEnd.deviceId, c.bEnd.ifaceId);
    if (ia?.speed && ib?.speed && ia.speed !== ib.speed) {
      push('rack-speed-mismatch', `Speed mismatch: ${nameOf(c.aEnd.deviceId)}:${ia.name} is ${ia.speed} but ${nameOf(c.bEnd.deviceId)}:${ib.name} is ${ib.speed} — the link negotiates down.`, [c.id]);
    }
    if (ia?.kind && ib?.kind && ia.kind.toLowerCase() !== ib.kind.toLowerCase()) {
      push('rack-media-mismatch', `Media mismatch: ${nameOf(c.aEnd.deviceId)}:${ia.name} is ${ia.kind} but ${nameOf(c.bEnd.deviceId)}:${ib.name} is ${ib.kind}.`, [c.id]);
    }
    if (ia?.vlan != null && ib?.vlan != null && ia.vlan !== ib.vlan) {
      push('rack-vlan-mismatch', `VLAN mismatch: ${nameOf(c.aEnd.deviceId)}:${ia.name} is VLAN ${ia.vlan} but ${nameOf(c.bEnd.deviceId)}:${ib.name} is VLAN ${ib.vlan} — the link won't pass that VLAN untagged.`, [c.id]);
    }
    for (const [dev, end] of [[a, c.aEnd] as const, [b, c.bEnd] as const]) {
      if (dev && dev.rackId == null) {
        push('rack-endpoint-unmounted', `${nameOf(end.deviceId)} is cabled but not mounted in any rack.`, [c.id, end.deviceId]);
      }
    }
    const crossRack = a && b && a.rackId != null && b.rackId != null && a.rackId !== b.rackId;
    if (crossRack && c.lengthFt == null) {
      push('rack-crossrack-nolength', `Cross-rack cable ${nameOf(c.aEnd.deviceId)} ↔ ${nameOf(c.bEnd.deviceId)} has no length set — set one to plan the run.`, [c.id]);
    }
  }

  return { issues, loopCableIds: [...loopCables], spofIds };
}
