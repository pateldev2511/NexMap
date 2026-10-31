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

/** A link whose interface reference(s) point at a vanished interface. */
export interface IfaceRefClear {
  linkId: string;
  clearSource: boolean;
  clearTarget: boolean;
}

/**
 * Find links whose interface reference points at an interface that no longer
 * exists on its (present) endpoint device — the `dangling-interface` warning.
 * Like a dangling link, the editor can't produce this: deleting an interface
 * cascades its link refs clear, so these only arrive via import. The honest fix
 * keeps the link and clears the stale pointer. A ref whose endpoint *device* is
 * missing is left alone — that's the missing-endpoint error, prune's job, not
 * this one's — so the two cleanups never fight over the same link.
 */
export function planClearDanglingIfaces(
  devices: readonly Device[],
  links: readonly Link[],
): IfaceRefClear[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const dangling = (deviceId: string, ifaceId: string | undefined): boolean => {
    if (!ifaceId) return false;
    const dev = byId.get(deviceId);
    if (!dev) return false; // missing device → prune's job, not ours
    return !(dev.interfaces ?? []).some((i) => i.id === ifaceId);
  };
  const out: IfaceRefClear[] = [];
  for (const l of links) {
    const clearSource = dangling(l.sourceId, l.sourceIfaceId);
    const clearTarget = dangling(l.targetId, l.targetIfaceId);
    if (clearSource || clearTarget) out.push({ linkId: l.id, clearSource, clearTarget });
  }
  return out;
}
