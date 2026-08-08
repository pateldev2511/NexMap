/**
 * Physical ↔ logical reconciliation (schema v5) — pure, no React, no store.
 *
 * Answers a question no incumbent tool does: **does my diagram match my patching?**
 * `links[]` is what you DESIGNED; `rackCables[]` + pass-throughs are what is
 * actually PATCHED. This module compares them and reports the delta.
 *
 * WHY A RECONCILER AND NOT A MERGE (plan SD-11): `RackCable` is deliberately kept
 * out of `links[]` so the physical layer never pollutes the logical topology —
 * validation, health, NexText and the topology renderer all assume `links[]` is
 * purely logical. Deriving the delta gives the same insight with none of that blast
 * radius, and stays trivially testable because it is a pure function.
 *
 * SCOPE RULE (load-bearing): only links whose BOTH endpoints are rack-mounted are
 * reconciled. Most projects have no racks at all, and flagging every link in a
 * rack-free diagram as "not cabled" would bury the real findings in noise. An
 * unmounted device simply has no physical layer to disagree with.
 */
import { isTransitive, traceFrom } from './cableTrace';
import type { Device, Link, PortRef, RackCable } from '@/model/types';

/** An end-to-end physical path between two ENDPOINT ports (panels are intermediate). */
export interface Circuit {
  a: PortRef;
  b: PortRef;
  /** Cables traversed, in walk order. */
  cableIds: string[];
  /** Ports touched, including both ends. 2 = a direct cable. */
  hops: number;
}

export interface BackedLink {
  linkId: string;
  circuit: Circuit;
}

export interface UnbackedLink {
  linkId: string;
  /**
   * `no-cable`   — neither endpoint has any cable on it; nothing has been patched.
   * `incomplete` — cabling exists but no complete path joins the two endpoints
   *                (a half-finished patch, or a break mid-chain).
   */
  reason: 'no-cable' | 'incomplete';
}

export interface Reconciliation {
  /** Designed AND patched. */
  backed: BackedLink[];
  /** Designed but not patched. */
  unbacked: UnbackedLink[];
  /** Patched but not designed. */
  undocumented: Circuit[];
  /** Links skipped because both endpoints are not rack-mounted (see SCOPE RULE). */
  outOfScope: number;
  /**
   * Cables that are part of no complete circuit — a run into a panel port that is
   * never punched through, or a panel-to-panel hop with no gear on either end.
   * Counted rather than listed: it is a nudge, not a work queue.
   */
  danglingCables: number;
}

const key = (p: PortRef) => `${p.deviceId}|${p.ifaceId}`;
/** Order-independent identity for a circuit, so A→B and B→A are the same run. */
const circuitKey = (a: PortRef, b: PortRef) => [key(a), key(b)].sort().join('::');

function isMounted(d: Device | undefined): boolean {
  return d != null && d.rackId != null && d.ru != null;
}

/**
 * Every complete end-to-end physical path, deduped.
 *
 * Walks outward only from ports on NON-transitive devices: a patch panel is a
 * waypoint, not an end, so starting there would manufacture half-circuits. Each run
 * is discovered twice (once from each end) and collapsed by `circuitKey`.
 */
export function enumerateCircuits(
  devices: readonly Device[],
  cables: readonly RackCable[],
): Circuit[] {
  const found = new Map<string, Circuit>();

  for (const d of devices) {
    if (isTransitive(d.type)) continue;
    for (const iface of d.interfaces ?? []) {
      const result = traceFrom(devices, cables, { deviceId: d.id, ifaceId: iface.id });
      if (result.end !== 'terminated') continue;
      const first = result.hops[0]!;
      const last = result.hops[result.hops.length - 1]!;
      const a: PortRef = { deviceId: first.deviceId, ifaceId: first.ifaceId };
      const b: PortRef = { deviceId: last.deviceId, ifaceId: last.ifaceId };
      const k = circuitKey(a, b);
      if (found.has(k)) continue;
      found.set(k, {
        a,
        b,
        cableIds: result.hops
          .map((h) => h.cableId)
          .filter((id): id is string => id != null),
        hops: result.hops.length,
      });
    }
  }
  // Stable order so the panel never reshuffles between renders.
  return [...found.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([, c]) => c);
}

/**
 * Compare designed links against patched circuits.
 *
 * Matching is greedy and one-to-one: each circuit backs at most one link, so two
 * cables between the same pair with only one documented link correctly leaves one
 * circuit undocumented. A link that names both ports is matched port-to-port; a
 * link that names only devices is matched device-to-device, which is the common case
 * since endpoint interface refs are optional.
 */
export function reconcile(
  devices: readonly Device[],
  links: readonly Link[],
  cables: readonly RackCable[],
): Reconciliation {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const circuits = enumerateCircuits(devices, cables);

  // Ports carrying at least one cable, for the `no-cable` vs `incomplete` distinction.
  const cabledPorts = new Set<string>();
  for (const c of cables) {
    cabledPorts.add(key(c.aEnd));
    cabledPorts.add(key(c.bEnd));
  }
  const deviceHasCable = new Set<string>();
  for (const c of cables) {
    deviceHasCable.add(c.aEnd.deviceId);
    deviceHasCable.add(c.bEnd.deviceId);
  }

  const consumed = new Set<number>();
  const backed: BackedLink[] = [];
  const unbacked: UnbackedLink[] = [];
  let outOfScope = 0;

  for (const link of links) {
    const src = byId.get(link.sourceId);
    const tgt = byId.get(link.targetId);
    // SCOPE RULE — an unmounted device has no physical layer to disagree with.
    if (!isMounted(src) || !isMounted(tgt)) {
      outOfScope += 1;
      continue;
    }

    const wantPorts = link.sourceIfaceId != null && link.targetIfaceId != null;
    const srcPort = key({ deviceId: link.sourceId, ifaceId: link.sourceIfaceId ?? '' });
    const tgtPort = key({ deviceId: link.targetId, ifaceId: link.targetIfaceId ?? '' });

    let matched = -1;
    for (let i = 0; i < circuits.length; i++) {
      if (consumed.has(i)) continue;
      const c = circuits[i]!;
      const ends = [key(c.a), key(c.b)];
      const devEnds = [c.a.deviceId, c.b.deviceId];
      const hit = wantPorts
        ? ends.includes(srcPort) && ends.includes(tgtPort)
        : devEnds.includes(link.sourceId) && devEnds.includes(link.targetId);
      if (hit) {
        matched = i;
        break;
      }
    }

    if (matched >= 0) {
      consumed.add(matched);
      backed.push({ linkId: link.id, circuit: circuits[matched]! });
    } else {
      // Any cabling on either endpoint at all? If not, nothing has been patched yet;
      // if there is, the patch exists but does not join these two.
      const touched =
        deviceHasCable.has(link.sourceId) || deviceHasCable.has(link.targetId);
      unbacked.push({ linkId: link.id, reason: touched ? 'incomplete' : 'no-cable' });
    }
  }

  const undocumented = circuits.filter((_, i) => !consumed.has(i));

  // Cables that no complete circuit traverses.
  const usedCables = new Set<string>();
  for (const c of circuits) for (const id of c.cableIds) usedCables.add(id);
  const danglingCables = cables.filter((c) => !usedCables.has(c.id)).length;

  return { backed, unbacked, undocumented, outOfScope, danglingCables };
}

/** True when there is nothing to report — used to keep the panel quiet by default. */
export function isClean(r: Reconciliation): boolean {
  return r.unbacked.length === 0 && r.undocumented.length === 0;
}
