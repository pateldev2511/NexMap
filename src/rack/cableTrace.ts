/**
 * Multi-hop physical cable tracing (schema v5) — pure, no React, no store.
 *
 * NOT to be confused with `cablePath.ts`, which is SVG Bézier math for DRAWING a
 * cable. This module is topology: it answers "where does this port actually go?"
 * by walking alternately across cables and through patch-panel pass-throughs.
 *
 * Two edge classes:
 *  - CABLE edge: port ↔ port, across devices (a `RackCable`).
 *  - COUPLING edge: port ↔ port, inside one device (`Interface.throughTo`), i.e.
 *    a patch panel's front jack wired to its own rear punchdown.
 *
 * A walk therefore goes: start → cable → coupling → cable → coupling → … until it
 * reaches an endpoint device, runs out of edges, or hits a fault.
 *
 * HARD RULES
 *  1. Only `patch-panel` is transitive (SD-12). A switch port is an endpoint even
 *     if some exotic setup treats it as a pass-through. A trace that stops early
 *     is honest; one that walks through a switch is a lie.
 *  2. Broken couplings are IGNORED, never repaired or guessed. They surface as
 *     validation errors instead.
 *  3. Total function: every walk terminates. Cycles are caught by a visited set
 *     and the hop count is capped, so a corrupt file cannot hang the UI.
 */
import { coupledPartner, isCoupled } from '@/model/coupling';
import type { Device, DeviceType, Interface, RackCable, RackCableEnd } from '@/model/types';

/**
 * Hop ceiling. A real patch chain is 2–6 hops; 32 is far past any legitimate
 * cabling and exists so a pathological file yields a marked partial answer
 * instead of spinning.
 */
export const MAX_HOPS = 32;

/**
 * Device types a trace passes THROUGH rather than stopping at (SD-12).
 *
 * Deliberately one entry, and deliberately a function: widening this later — to
 * `generic` splices, or to a per-device `passThrough` flag — is a one-line change
 * plus tests rather than a refactor.
 */
export function isTransitive(type: DeviceType): boolean {
  return type === 'patch-panel';
}

/** How the walk arrived at a hop. */
export type HopVia = 'start' | 'cable' | 'coupling';

export interface TraceHop {
  deviceId: string;
  ifaceId: string;
  via: HopVia;
  /** Set when `via === 'cable'`. */
  cableId?: string;
}

/**
 * Why the walk stopped. Always surfaced to the UI — a trace that quietly looks
 * complete when it isn't is worse than no trace at all.
 *
 *  - `terminated`   reached a port on a non-transitive (endpoint) device. Success.
 *  - `open`         ran out of edges: no cable, or a panel port not punched through.
 *  - `loop`         the cabling revisits a port already on the path.
 *  - `ambiguous`    a port carries more than one cable, so "the" next hop isn't defined.
 *  - `depth-capped` exceeded MAX_HOPS.
 */
export type TraceEnd = 'terminated' | 'open' | 'loop' | 'ambiguous' | 'depth-capped';

export interface TraceResult {
  /** Ordered, starting at the requested port. Empty only if the start doesn't resolve. */
  hops: TraceHop[];
  end: TraceEnd;
}

const portKey = (deviceId: string, ifaceId: string) => `${deviceId}|${ifaceId}`;
const endKey = (e: RackCableEnd) => portKey(e.deviceId, e.ifaceId);

function ifaceOf(device: Device | undefined, ifaceId: string): Interface | undefined {
  return device?.interfaces?.find((i) => i.id === ifaceId);
}

/**
 * Walk the physical path outward from one port.
 *
 * `cables` may include cross-rack runs — they are ordinary cable edges and are
 * traversed the same way (E10).
 */
export function traceFrom(
  devices: readonly Device[],
  cables: readonly RackCable[],
  start: RackCableEnd,
): TraceResult {
  const devById = new Map(devices.map((d) => [d.id, d]));

  // Port → cables landing on it. Built once; a port normally has 0 or 1.
  // A cable whose two ends are the SAME port must be counted ONCE, not twice —
  // otherwise a degenerate self-cable reads as two cables and reports `ambiguous`
  // when it is really a loop.
  const byPort = new Map<string, RackCable[]>();
  for (const c of cables) {
    const keys = endKey(c.aEnd) === endKey(c.bEnd)
      ? [endKey(c.aEnd)]
      : [endKey(c.aEnd), endKey(c.bEnd)];
    for (const k of keys) {
      const list = byPort.get(k);
      if (list) list.push(c);
      else byPort.set(k, [c]);
    }
  }

  // E9: a start port whose device or interface no longer exists traces nowhere.
  const startDev = devById.get(start.deviceId);
  if (!startDev || !ifaceOf(startDev, start.ifaceId)) return { hops: [], end: 'open' };

  const hops: TraceHop[] = [
    { deviceId: start.deviceId, ifaceId: start.ifaceId, via: 'start' },
  ];
  const seen = new Set<string>([portKey(start.deviceId, start.ifaceId)]);

  /**
   * Append a hop unless we are at capacity. Guarding the PUSH (rather than only
   * the top of the loop) is what makes `hops.length <= MAX_HOPS` an invariant —
   * a loop-top check alone lets an iteration that adds two hops overshoot.
   */
  const pushHop = (h: TraceHop): boolean => {
    if (hops.length >= MAX_HOPS) return false;
    hops.push(h);
    return true;
  };

  // `cur` is always the port we are about to leave via a CABLE.
  let cur: RackCableEnd = { deviceId: start.deviceId, ifaceId: start.ifaceId };

  for (;;) {
    const here = byPort.get(endKey(cur)) ?? [];
    // E11: nothing plugged in — the path simply ends here.
    if (here.length === 0) return { hops, end: 'open' };
    // E6: two cables on one port. Surface it; never silently pick the first.
    if (here.length > 1) return { hops, end: 'ambiguous' };

    const cable = here[0]!;
    // Cross to the far end. A cable with both ends on the same port is degenerate
    // and falls through to the loop guard below.
    const far: RackCableEnd =
      endKey(cable.aEnd) === endKey(cur) ? cable.bEnd : cable.aEnd;

    // E5: revisiting a port means the cabling loops.
    if (seen.has(endKey(far))) return { hops, end: 'loop' };

    const farDev = devById.get(far.deviceId);
    const farIface = farDev ? ifaceOf(farDev, far.ifaceId) : undefined;
    // A cable pointing at gear that no longer exists: record the hop, stop honestly.
    if (!farDev || !farIface) {
      if (!pushHop({ ...far, via: 'cable', cableId: cable.id })) {
        return { hops, end: 'depth-capped' };
      }
      return { hops, end: 'open' };
    }

    if (
      !pushHop({
        deviceId: far.deviceId,
        ifaceId: far.ifaceId,
        via: 'cable',
        cableId: cable.id,
      })
    ) {
      return { hops, end: 'depth-capped' };
    }
    seen.add(endKey(far));

    // Endpoint device → done. This is the success case.
    if (!isTransitive(farDev.type)) return { hops, end: 'terminated' };

    // Transitive: continue through the panel's internal pass-through.
    const partner = coupledPartner(farDev, farIface);
    // A panel port that isn't punched through dead-ends.
    if (!partner) return { hops, end: 'open' };

    const partnerKey = portKey(farDev.id, partner.id);
    if (seen.has(partnerKey)) return { hops, end: 'loop' };

    if (!pushHop({ deviceId: farDev.id, ifaceId: partner.id, via: 'coupling' })) {
      return { hops, end: 'depth-capped' };
    }
    seen.add(partnerKey);
    cur = { deviceId: farDev.id, ifaceId: partner.id };
  }
}

/** The far end of a completed trace, or undefined when it did not terminate cleanly. */
export function traceEndpoint(result: TraceResult): TraceHop | undefined {
  if (result.end !== 'terminated') return undefined;
  return result.hops[result.hops.length - 1];
}

// ─── Pass-through pairing ────────────────────────────────────────────────────

export interface PassThroughPlan {
  /**
   * Front ports needing a NEW rear counterpart, with the suggested rear port name.
   * The STORE mints the ids — this module stays free of id generation so it is
   * deterministic under test.
   */
  createRear: { frontIfaceId: string; name: string }[];
  /** Existing front/rear ports to couple, matched positionally. */
  couple: { frontIfaceId: string; rearIfaceId: string }[];
  /** Ports that already have a sound coupling and are left untouched. */
  alreadyPaired: number;
}

/**
 * Plan a patch panel's front↔rear pass-throughs so a lazy user never hand-pairs 24
 * ports.
 *
 * Two situations, both handled:
 *  - Panel has only front ports (the default from the library presets) → mirror
 *    each into a new rear port and couple them.
 *  - Panel already has both faces → couple them positionally, front[i] ↔ rear[i].
 *
 * Idempotent: ports that already have a sound coupling are skipped, so running it
 * twice changes nothing. Surplus ports on one face are left unpaired rather than
 * mis-matched (E8) — an odd port count is a legitimate panel, not an error.
 *
 * Rear names get a suffix (default "r") so names stay UNIQUE within the device.
 * The physical port number is still readable ("12" ↔ "12r"), and `side` carries the
 * face, but uniqueness keeps cable schedules and CSV exports unambiguous.
 */
export function planPassThroughPairs(
  device: Device,
  rearName: (frontName: string) => string = (n) => `${n}r`,
): PassThroughPlan {
  const ifaces = device.interfaces ?? [];
  const plan: PassThroughPlan = { createRear: [], couple: [], alreadyPaired: 0 };

  const isSound = (i: Interface) => isCoupled(device, i);
  const fronts = ifaces.filter((i) => (i.side ?? 'front') === 'front');
  const rears = ifaces.filter((i) => i.side === 'rear');

  const freeRears = rears.filter((r) => !isSound(r));
  let nextRear = 0;

  for (const front of fronts) {
    if (isSound(front)) {
      plan.alreadyPaired += 1;
      continue;
    }
    const rear = freeRears[nextRear];
    if (rear) {
      nextRear += 1;
      plan.couple.push({ frontIfaceId: front.id, rearIfaceId: rear.id });
    } else {
      plan.createRear.push({ frontIfaceId: front.id, name: rearName(front.name) });
    }
  }
  return plan;
}
