/**
 * Uplink — connect a design to the outside world in one move.
 *
 * Conductor scaffolds the inside of a network (devices, fabric, subnets, gateways);
 * this is the last declarative step that most diagrams want: wire the edge device
 * to the internet. It finds the one box that faces the world, reuses the diagram's
 * internet node when it already has one, and refuses to guess when the edge is
 * ambiguous — the same honesty rule the rest of Conductor follows.
 *
 * Pure and canvas-free: the decision lives here; the store does placement + wiring.
 */
import type { DeviceType } from '@/model/types';

/**
 * The device that should face the internet. A firewall is the perimeter by
 * definition, so a single firewall wins even when routers are present; absent a
 * firewall, a single router is the edge. Zero candidates, two firewalls, or several
 * routers with no firewall → null (we don't guess which box is the front door).
 */
export function pickEdgeDevice<T extends { type: DeviceType }>(devices: readonly T[]): T | null {
  const firewalls = devices.filter((d) => d.type === 'firewall');
  if (firewalls.length === 1) return firewalls[0]!;
  if (firewalls.length > 1) return null;
  const routers = devices.filter((d) => d.type === 'router');
  return routers.length === 1 ? routers[0]! : null;
}

export interface UplinkPlan {
  /** The edge device that gets the uplink. */
  edgeId: string;
  /** An existing internet node to wire into, or null → the caller creates one. */
  existingIspId: string | null;
}

/**
 * Plan an uplink for a topology. Picks the edge device (optionally scoped to a
 * selection via `onlyIds`), reuses an existing internet node when the diagram has
 * one, and returns null when there's no unambiguous edge or the edge already reaches
 * an ISP (idempotent — running it twice does nothing the second time).
 */
export function planUplink(
  devices: readonly { id: string; type: DeviceType }[],
  links: readonly { sourceId: string; targetId: string }[],
  opts: { onlyIds?: Set<string> } = {},
): UplinkPlan | null {
  const pool = opts.onlyIds ? devices.filter((d) => opts.onlyIds!.has(d.id)) : devices;
  const edge = pickEdgeDevice(pool);
  if (!edge) return null;

  // Internet nodes are searched across the WHOLE diagram, not just the pool: "connect
  // this firewall" should reuse the internet that's already drawn, wherever it sits.
  const isps = devices.filter((d) => d.type === 'isp');
  const ispIds = new Set(isps.map((d) => d.id));

  // Idempotent: if the edge already reaches any ISP, there's nothing to do.
  for (const l of links) {
    if (
      (l.sourceId === edge.id && ispIds.has(l.targetId)) ||
      (l.targetId === edge.id && ispIds.has(l.sourceId))
    ) {
      return null;
    }
  }

  // Reuse the diagram's internet node when it has one (the first, in document order);
  // only synthesize a fresh one when none exists — never spawn a second cloud.
  const existingIspId = isps.length > 0 ? isps[0]!.id : null;
  return { edgeId: edge.id, existingIspId };
}
