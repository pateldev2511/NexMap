/**
 * Patch schedule from the topology: turn every logical link between two rack-mounted
 * devices into a physical patch cable, picking free ports, numbering labels and
 * estimating lengths. Pure + deterministic; the store applies the plan as one undo step.
 *
 * Honest by design: a link with an end outside a rack stays logical, and a device with no
 * free port is reported, never double-patched. Links that already have a cable between
 * the same two devices are counted as patched (two links ⇒ two cables).
 */
import type { Device, Link, Rack, RackCable, RackCableEnd } from '@/model/types';
import { estimateCableLengthFt } from './cableLength';

/** The Connect dialog's default swatch (CABLE_COLORS[0]). */
export const PATCH_COLOR = '#2563eb';

export interface PatchItem {
  linkId: string;
  aEnd: RackCableEnd;
  bEnd: RackCableEnd;
  label: string;
  lengthFt: number | null;
}

export interface PatchPlan {
  items: PatchItem[];
  /** Links between two racked devices that already have their cable. */
  alreadyPatched: number;
  /** Links with an end that isn't mounted in a rack (they stay logical). */
  notRacked: number;
  /** Devices that ran out of free ports, with how many links they couldn't take. */
  noFreePort: { device: Device; links: number }[];
}

const racked = (d: Device | undefined): d is Device => !!d && d.rackId != null && d.ru != null;
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const portKey = (deviceId: string, ifaceId: string) => `${deviceId}:${ifaceId}`;

/** Next free "P-###" number after any already used. */
function labelCounter(cables: RackCable[]): () => string {
  let n = 0;
  for (const c of cables) {
    const m = /^P-(\d+)$/.exec(c.label ?? '');
    if (m) n = Math.max(n, Number(m[1]));
  }
  return () => `P-${String(++n).padStart(3, '0')}`;
}

export function planPatches(devices: Device[], links: Link[], cables: RackCable[], racks: Rack[]): PatchPlan {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const used = new Set<string>();
  const cabledPairs = new Map<string, number>();
  for (const c of cables) {
    used.add(portKey(c.aEnd.deviceId, c.aEnd.ifaceId));
    used.add(portKey(c.bEnd.deviceId, c.bEnd.ifaceId));
    const k = pairKey(c.aEnd.deviceId, c.bEnd.deviceId);
    cabledPairs.set(k, (cabledPairs.get(k) ?? 0) + 1);
  }

  const plan: PatchPlan = { items: [], alreadyPatched: 0, notRacked: 0, noFreePort: [] };
  const todo: Link[] = [];
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    if (!racked(byId.get(l.sourceId)) || !racked(byId.get(l.targetId))) {
      plan.notRacked++;
      continue;
    }
    const k = pairKey(l.sourceId, l.targetId);
    const have = cabledPairs.get(k) ?? 0;
    if (have > 0) {
      cabledPairs.set(k, have - 1);
      plan.alreadyPatched++;
    } else {
      todo.push(l);
    }
  }

  // A port a link names is kept for that link; auto-picked ports go around it.
  const named = new Set<string>();
  for (const l of todo) {
    if (l.sourceIfaceId) named.add(portKey(l.sourceId, l.sourceIfaceId));
    if (l.targetIfaceId) named.add(portKey(l.targetId, l.targetIfaceId));
  }
  const pick = (device: Device, preferred?: string): string | null => {
    const ifaces = device.interfaces ?? [];
    if (preferred && ifaces.some((i) => i.id === preferred) && !used.has(portKey(device.id, preferred))) {
      return preferred;
    }
    const free = ifaces.find((i) => !used.has(portKey(device.id, i.id)) && !named.has(portKey(device.id, i.id)));
    return free?.id ?? null;
  };

  const nextLabel = labelCounter(cables);
  const short = new Map<string, number>();
  for (const l of todo) {
    const a = byId.get(l.sourceId)!;
    const b = byId.get(l.targetId)!;
    const pa = pick(a, l.sourceIfaceId);
    const pb = pick(b, l.targetIfaceId);
    if (!pa || !pb) {
      for (const [d, p] of [[a, pa], [b, pb]] as const) if (!p) short.set(d.id, (short.get(d.id) ?? 0) + 1);
      continue;
    }
    used.add(portKey(a.id, pa));
    used.add(portKey(b.id, pb));
    plan.items.push({
      linkId: l.id,
      aEnd: { deviceId: a.id, ifaceId: pa },
      bEnd: { deviceId: b.id, ifaceId: pb },
      label: nextLabel(),
      lengthFt: estimateCableLengthFt(a, b, racks),
    });
  }
  plan.noFreePort = [...short].map(([id, n]) => ({ device: byId.get(id)!, links: n }));
  return plan;
}
