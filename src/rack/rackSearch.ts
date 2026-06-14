/**
 * Deep device search for the rack designer. The old row-view search matched only name +
 * type; an ops user needs to find gear by asset tag, owner, serial, vendor/model, role,
 * status, management IP, and VLAN. All matching is case-insensitive substring over a
 * lazily-built haystack. Pure — no store access.
 */
import type { Device } from '@/model/types';

/** Every field a device can be found by, joined lowercase. */
function haystack(d: Device): string {
  const parts: (string | number | undefined)[] = [
    d.name,
    d.type,
    d.vendor,
    d.model,
    d.role,
    d.owner,
    d.assetTag,
    d.serial,
    d.status,
    d.location,
    d.managementIp,
    d.notes,
  ];
  for (const i of d.interfaces ?? []) {
    parts.push(i.name);
    if (i.vlan != null) parts.push(`vlan${i.vlan}`, String(i.vlan));
  }
  return parts.filter((p) => p != null && p !== '').join(' ').toLowerCase();
}

/** True if the device matches the (already-trimmed-or-not) query. Empty query → false. */
export function deviceMatchesQuery(device: Device, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return haystack(device).includes(q);
}

/** All devices matching the query, in input order. Empty query → empty (no implicit all). */
export function searchDevices(devices: Device[], query: string): Device[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return devices.filter((d) => haystack(d).includes(q));
}
