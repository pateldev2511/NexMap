/**
 * Power-cord plan: which PDU outlet each unit's cord goes into, for install day. A
 * single-corded unit gets one cord on its feed; a dual-corded unit one on each. Each cord
 * takes the free outlet on that feed's PDUs nearest its own height, top of the rack first,
 * so cords run short and sideways. Derived, never stored; deterministic. A cord with no
 * free outlet left on its feed is reported, never doubled up.
 */
import type { Device, Rack } from '@/model/types';
import { cordsIntoPdu, isPdu } from './rackPower';

export interface PowerCord {
  deviceId: string;
  feed: 'A' | 'B';
  /** The PDU and outlet it plugs into; null when the feed has no free outlet. */
  pduId: string | null;
  outlet: string | null;
}

interface Outlet {
  pduId: string;
  name: string;
  /** Height of the outlet in U (continuous: U1 spans 0.5–1.5). */
  u: number;
}

const mounted = (d: Device, rackId: string) => d.rackId === rackId && d.ru != null;
/** A unit's vertical center in U. */
const centerU = (d: Device) => (d.ru ?? 1) + (Math.max(1, d.ruSpan ?? 1) - 1) / 2;

/** Outlets of one feed's PDUs, outlet 1 at the top of each strip (as the strip art draws). */
function outletsOn(feed: 'A' | 'B', pdus: Device[]): Outlet[] {
  const out: Outlet[] = [];
  for (const p of pdus) {
    if ((p.powerFeed === 'B' ? 'B' : 'A') !== feed) continue;
    const ifaces = p.interfaces ?? [];
    const span = Math.max(1, p.ruSpan ?? 1);
    const top = (p.ru ?? 1) + span - 0.5;
    ifaces.forEach((iface, i) => {
      out.push({ pduId: p.id, name: iface.name, u: top - ((i + 0.5) * span) / ifaces.length });
    });
  }
  return out;
}

/** Plan every power cord in one rack. Cords come out top of the rack first, A before B. */
export function planPowerCords(rack: Pick<Rack, 'id'>, devices: readonly Device[]): PowerCord[] {
  const inRack = devices.filter((d) => mounted(d, rack.id));
  const pdus = inRack.filter(isPdu).sort((a, b) => (a.ru ?? 0) - (b.ru ?? 0) || a.id.localeCompare(b.id));
  const gear = inRack
    .filter(cordsIntoPdu)
    .sort((a, b) => centerU(b) - centerU(a) || a.id.localeCompare(b.id));
  const cords: PowerCord[] = [];
  for (const feed of ['A', 'B'] as const) {
    const free = outletsOn(feed, pdus);
    for (const d of gear) {
      const f = d.powerFeed ?? 'A';
      if (f !== feed && f !== 'AB') continue;
      const c = centerU(d);
      // Nearest free outlet; `free` is in rank order, so a tie keeps the earlier one.
      let best = -1;
      for (let i = 0; i < free.length; i++) {
        if (best < 0 || Math.abs(free[i]!.u - c) < Math.abs(free[best]!.u - c) - 1e-9) best = i;
      }
      const o = best < 0 ? null : free.splice(best, 1)[0]!;
      cords.push({ deviceId: d.id, feed, pduId: o?.pduId ?? null, outlet: o?.name ?? null });
    }
  }
  return cords;
}

/** One CSV row per cord across every rack: where each unit plugs in. */
export function powerCordCsv(racks: readonly Rack[], devices: readonly Device[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const byId = new Map(devices.map((d) => [d.id, d]));
  const rows = ['Rack,Device,U,Feed,PDU,Outlet'];
  for (const rack of racks) {
    for (const c of planPowerCords(rack, devices)) {
      const d = byId.get(c.deviceId)!;
      const pdu = c.pduId ? byId.get(c.pduId)?.name ?? c.pduId : 'no free outlet';
      rows.push([q(rack.name), q(d.name), q(`U${d.ru}`), q(c.feed), q(pdu), q(c.outlet ?? '')].join(','));
    }
  }
  return rows.join('\n');
}
