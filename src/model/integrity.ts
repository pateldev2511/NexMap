/**
 * Topology-integrity planners — the "Conductor fixes what NexMap flags" family
 * for structural (not addressing) faults. Pure: take the model, return what to
 * change. The store wraps the result in an undoable transaction.
 */
import type { Device, Link } from './types';

/**
 * Find links whose source or target device no longer exists — the
 * `missing-endpoint` error validate.ts flags. A link to a vanished device is
 * unrecoverable garbage: normal device deletion cascades its incident links
 * (DeleteCommand), so these only arrive via import of a hand-edited or
 * externally generated `.nexmap`. There's nothing to preserve, so the honest
 * fix is to prune them. Returns the ids of the links to remove, in input order.
 */
export function planPruneDanglingLinks(
  devices: readonly Device[],
  links: readonly Link[],
): string[] {
  const ids = new Set(devices.map((d) => d.id));
  return links.filter((l) => !ids.has(l.sourceId) || !ids.has(l.targetId)).map((l) => l.id);
}
