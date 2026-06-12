/**
 * VLAN id helpers (schema v3). A port carries an access/native VLAN in `Interface.vlan`.
 * Pure + deterministic so the input parsing, validation, and display are unit-testable and
 * shared by the inspector, health check, and cable schedule.
 */
import type { Interface } from '@/model/types';

/** Valid 802.1Q VLAN id range. 0 and 4095 are reserved; 1–4094 are usable. */
export const VLAN_MIN = 1;
export const VLAN_MAX = 4094;

export function isValidVlanId(n: number): boolean {
  return Number.isInteger(n) && n >= VLAN_MIN && n <= VLAN_MAX;
}

/** Parse a single VLAN id from free text; undefined if blank or out of range. */
export function parseVlanId(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return isValidVlanId(n) ? n : undefined;
}

/** Short label for a port's VLAN, e.g. "VLAN 10" or "" when untagged. */
export function vlanLabel(iface: Pick<Interface, 'vlan'>): string {
  return iface.vlan != null ? `VLAN ${iface.vlan}` : '';
}
