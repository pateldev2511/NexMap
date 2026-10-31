/**
 * Resilience scan — find every single point of failure, proactively.
 *
 * The Flow lens lets you pull one device at a time and watch the blast radius. This
 * does that pull for *every* device at once and reports the ones that matter: the
 * devices whose failure isolates something else from the network. It turns failure
 * reasoning from a manual hunt ("which box should I click?") into an exhaustive
 * answer ("these three are your weak points, worst first").
 *
 * Pure and canvas-free, built on the exact `blastRadius` engine Flow uses on click —
 * so a scan result and a click on the same device always agree. The store action
 * selects the reported devices so each can be hardened with "Add a redundant twin".
 */
import type { Device, DeviceType, Link } from '@/model/types';
import { blastRadius } from './blastRadius';
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
 * O(V·(V+E)) — one blast per linked device; fine for diagram-sized graphs.
 */
export function findSpofs(devices: Device[], links: Link[]): Spof[] {
  const degree = new Map<string, number>();
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    degree.set(l.sourceId, (degree.get(l.sourceId) ?? 0) + 1);
    degree.set(l.targetId, (degree.get(l.targetId) ?? 0) + 1);
  }
  const spofs: Spof[] = [];
  for (const d of devices) {
    if ((degree.get(d.id) ?? 0) === 0) continue; // unlinked — can't isolate anyone
    const isolates = blastRadius(devices, links, [d.id]).isolated.size;
    if (isolates > 0) spofs.push({ deviceId: d.id, isolates });
  }
  spofs.sort(
    (a, b) =>
      b.isolates - a.isolates ||
      (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0),
  );
  return spofs;
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
