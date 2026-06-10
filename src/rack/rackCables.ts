/**
 * Pure rack-cable helpers (rack designer, schema v3).
 *
 * The store owns the rackCables Map; these pure functions own the RULES so they can
 * be unit-tested without React/Zustand. Two are CRITICAL (the eng review flagged them
 * as regression-class): cascade-prune on device delete, and cascade-prune on interface
 * change (E5 port re-population can orphan a cable's ifaceId while deviceId stays valid).
 */
import type { RackCable, RackCableEnd } from '@/model/types';

/** Does this cable touch the given device on EITHER end? */
export function cableTouchesDevice(cable: RackCable, deviceId: string): boolean {
  return cable.aEnd.deviceId === deviceId || cable.bEnd.deviceId === deviceId;
}

/** Does this cable use a specific port (device + interface) on either end? */
export function cableUsesPort(cable: RackCable, deviceId: string, ifaceId: string): boolean {
  const hit = (e: RackCableEnd) => e.deviceId === deviceId && e.ifaceId === ifaceId;
  return hit(cable.aEnd) || hit(cable.bEnd);
}

/** CRITICAL: drop every cable touching a deleted device (no dangling endpoints). */
export function pruneCablesForDevice(cables: RackCable[], deviceId: string): RackCable[] {
  return cables.filter((c) => !cableTouchesDevice(c, deviceId));
}

/**
 * CRITICAL: after a device's interfaces change (delete one, or regenerate the whole
 * set via auto-population), drop cables whose endpoint on THAT device references an
 * ifaceId that no longer exists. Cables on other devices are untouched.
 */
export function pruneCablesForInterfaces(
  cables: RackCable[],
  deviceId: string,
  validIfaceIds: Iterable<string>,
): RackCable[] {
  const valid = new Set(validIfaceIds);
  return cables.filter((c) => {
    const endStale = (e: RackCableEnd) => e.deviceId === deviceId && !valid.has(e.ifaceId);
    return !endStale(c.aEnd) && !endStale(c.bEnd);
  });
}

/** Is a port already used by an existing cable? Drives the "replace?" prompt. */
export function isPortCabled(
  cables: RackCable[],
  deviceId: string,
  ifaceId: string,
): boolean {
  return cables.some((c) => cableUsesPort(c, deviceId, ifaceId));
}

/** Cable to the same port on both ends — never valid. */
export function isSelfCable(aEnd: RackCableEnd, bEnd: RackCableEnd): boolean {
  return aEnd.deviceId === bEnd.deviceId && aEnd.ifaceId === bEnd.ifaceId;
}

export type ConnectCheck =
  | { ok: true }
  | { ok: false; reason: 'self' | 'a-cabled' | 'b-cabled' };

/**
 * Validate a proposed new cable against existing ones. Caller decides whether a
 * '*-cabled' result means block or replace.
 */
export function checkConnect(
  cables: RackCable[],
  aEnd: RackCableEnd,
  bEnd: RackCableEnd,
): ConnectCheck {
  if (isSelfCable(aEnd, bEnd)) return { ok: false, reason: 'self' };
  if (isPortCabled(cables, aEnd.deviceId, aEnd.ifaceId)) return { ok: false, reason: 'a-cabled' };
  if (isPortCabled(cables, bEnd.deviceId, bEnd.ifaceId)) return { ok: false, reason: 'b-cabled' };
  return { ok: true };
}
