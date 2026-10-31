/**
 * Wire-to-hub — turn a lassoed cluster into a hub-and-spoke star.
 *
 * {@link fabricEdges} weaves a mesh (MST) by proximity; this does the other half
 * of the real-world vocabulary: access devices hanging off one piece of
 * infrastructure. You lasso some clients plus the switch/router they belong to,
 * and every client gets a link to that one hub.
 *
 * Honest scope: we do NOT guess which node is the hub. The hub is the selection's
 * single infrastructure node; if there are zero or several, the intent is
 * ambiguous and we refuse rather than pick for you. Pure and canvas-free so it is
 * unit-testable in isolation.
 */
import type { DeviceType } from '@/model/types';

/** Device roles that act as a wiring hub (distribution point) for other devices. */
export const HUB_TYPES: ReadonlySet<DeviceType> = new Set<DeviceType>([
  'switch',
  'router',
  'firewall',
  'load-balancer',
  'wireless-controller',
]);

export interface HubNode {
  id: string;
  type: DeviceType;
}

/**
 * The one device to treat as the hub: the selection's single infrastructure node.
 * Returns null when zero or more than one qualify — ambiguous, so we don't guess.
 */
export function pickHub(nodes: readonly HubNode[]): string | null {
  const infra = nodes.filter((n) => HUB_TYPES.has(n.type));
  return infra.length === 1 ? infra[0]!.id : null;
}

/** An undirected edge between two node ids, lexicographically ordered. */
export type StarEdge = readonly [string, string];

/**
 * Edges from `hubId` to each spoke. The hub is skipped if present in `spokeIds`,
 * duplicate spokes collapse to one edge, and each edge is normalized a < b so the
 * result is stable and dedup-friendly against existing links.
 */
export function starEdges(hubId: string, spokeIds: readonly string[]): StarEdge[] {
  const seen = new Set<string>();
  const edges: StarEdge[] = [];
  for (const s of spokeIds) {
    if (s === hubId) continue;
    const key = hubId < s ? `${hubId}|${s}` : `${s}|${hubId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(hubId < s ? [hubId, s] : [s, hubId]);
  }
  return edges;
}
