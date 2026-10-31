/**
 * Redundancy — turn a single point of failure into a resilient pair, in one move.
 *
 * This is where Conductor and the Flow lens meet: Flow *reveals* that losing one
 * device isolates everything behind it; this *fixes* it. It plans a twin of the
 * chosen device that re-connects to the same neighbors, so traffic has a parallel
 * path and failing the original no longer cuts anyone off. Re-run Flow afterward and
 * the blast radius collapses.
 *
 * Pure and canvas-free: the decision (which neighbors the twin inherits) lives here;
 * the store clones the device, places it, and wires the parallel links. The twin is
 * created WITHOUT the original's management IP — a duplicate address would be a real
 * error, so it lands unaddressed and auto-address can fill it next.
 */
export interface TwinPlan {
  /** The device being duplicated. */
  deviceId: string;
  /** Neighbor device ids the twin should also connect to (the parallel paths). */
  neighborIds: string[];
}

/**
 * Plan a redundant twin for one device. The twin inherits the device's neighbor set
 * (direction-agnostic, de-duplicated), giving every neighbor a second path that
 * doesn't pass through the original. Returns null when the device has no neighbors —
 * a twin there would be a disconnected island, not redundancy, and we don't pretend
 * otherwise.
 */
export function planTwin(
  deviceId: string,
  links: readonly { sourceId: string; targetId: string }[],
): TwinPlan | null {
  const neighbors = new Set<string>();
  for (const l of links) {
    if (l.sourceId === deviceId) neighbors.add(l.targetId);
    else if (l.targetId === deviceId) neighbors.add(l.sourceId);
  }
  // A self-loop (source === target === deviceId) would add deviceId itself; drop it.
  neighbors.delete(deviceId);
  if (neighbors.size === 0) return null;
  return { deviceId, neighborIds: [...neighbors] };
}
