/**
 * VLAN-ID hygiene. Conductor's remedy for VLANs that collide on the same 802.1Q
 * ID — the number, not the object. Pure and canvas-free, mirroring the naming
 * planners it sits beside.
 */
import type { Vlan } from './types';

/** A planned renumber: give VLAN `id` (the object) the new, now-distinct `vlanId`. */
export interface VlanRenumber {
  id: string;
  vlanId: number;
}

const VLAN_MIN = 1;
const VLAN_MAX = 4094;

/**
 * The smallest valid 802.1Q ID (1–4094) not already in `used`, recorded there as
 * it's handed out. Returns null when the range is somehow full (4094 live VLANs).
 */
function nextFreeVlan(used: Set<number>): number | null {
  for (let v = VLAN_MIN; v <= VLAN_MAX; v++) {
    if (!used.has(v)) {
      used.add(v);
      return v;
    }
  }
  return null;
}

/**
 * Conductor: resolve VLANs that share an 802.1Q ID. For each clashing group the
 * lowest-id VLAN keeps its number and the rest are moved to the next free valid
 * ID — clearing validate.ts's `duplicate-vlan` error.
 *
 * Only the duplication is fixed: a group that collides on an out-of-range number
 * (e.g. two VLANs at 0) still leaves one at that value, which is the separate
 * `invalid-vlan-range` error with no safe auto-guess. Allocations never reuse a
 * number already live on the board — including the kept duplicate — so the fix
 * can't trade one clash for another.
 */
export function planDeduplicateVlans(vlans: readonly Vlan[]): VlanRenumber[] {
  const groups = new Map<number, Vlan[]>();
  for (const v of vlans) {
    const g = groups.get(v.vlanId);
    if (g) g.push(v);
    else groups.set(v.vlanId, [v]);
  }
  const used = new Set<number>(vlans.map((v) => v.vlanId));
  const out: VlanRenumber[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Lowest id keeps its number; the rest move to fresh free IDs.
    for (const v of sorted.slice(1)) {
      const next = nextFreeVlan(used);
      if (next === null) break;
      out.push({ id: v.id, vlanId: next });
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
