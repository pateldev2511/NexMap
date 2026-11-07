/**
 * Patch schedule from the topology: turn every logical link between two rack-mounted
 * devices into a physical patch cable, picking free ports, numbering labels and
 * estimating lengths. Pure + deterministic; the store applies the plan as one undo step.
 *
 * Honest by design: a link with an end outside a rack stays logical, and a device with no
 * free port is reported, never double-patched. A link counts as patched only when a cable
 * between the same two devices lands on the ports it names (either direction; an unnamed
 * end takes any port), and each cable satisfies one link (two links ⇒ two cables). A named
 * port already held by another cable is reported as a conflict, never patched around.
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
  /** Ports a link names that another cable (drawn, or earlier in this plan) already holds. */
  portConflicts: PortConflict[];
}

export interface PortConflict {
  linkId: string;
  device: Device;
  ifaceId: string;
  /** The port's display name. */
  port: string;
  /** Label of the cable holding the port, when it has one. */
  cableLabel?: string;
}

const racked = (d: Device | undefined): d is Device => !!d && d.rackId != null && d.ru != null;
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const portKey = (deviceId: string, ifaceId: string) => `${deviceId}:${ifaceId}`;
/** The port a link names on `d`, if that port exists (a stale id names nothing). */
const namedPort = (d: Device, ifaceId: string | undefined) =>
  ifaceId && (d.interfaces ?? []).some((i) => i.id === ifaceId) ? ifaceId : undefined;

/** A racked link's two ends and the ports it insists on. */
interface Want {
  link: Link;
  a: Device;
  b: Device;
  pa?: string;
  pb?: string;
}

/** Does cable `c` run a→b on the wanted ports (an unnamed end takes any port)? */
function lands(c: RackCable, w: Want): boolean {
  const fits = (x: RackCableEnd, y: RackCableEnd) =>
    x.deviceId === w.a.id && y.deviceId === w.b.id && (!w.pa || x.ifaceId === w.pa) && (!w.pb || y.ifaceId === w.pb);
  return fits(c.aEnd, c.bEnd) || fits(c.bEnd, c.aEnd);
}

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
  // Who holds each port: the drawn cable's label ('' when unlabelled), then this plan's.
  const used = new Map<string, string>();
  const openByPair = new Map<string, RackCable[]>();
  for (const c of cables) {
    used.set(portKey(c.aEnd.deviceId, c.aEnd.ifaceId), c.label ?? '');
    used.set(portKey(c.bEnd.deviceId, c.bEnd.ifaceId), c.label ?? '');
    const k = pairKey(c.aEnd.deviceId, c.bEnd.deviceId);
    openByPair.set(k, [...(openByPair.get(k) ?? []), c]);
  }

  const plan: PatchPlan = { items: [], alreadyPatched: 0, notRacked: 0, noFreePort: [], portConflicts: [] };
  const wants: Want[] = [];
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    const a = byId.get(l.sourceId);
    const b = byId.get(l.targetId);
    if (!racked(a) || !racked(b)) {
      plan.notRacked++;
      continue;
    }
    wants.push({ link: l, a, b, pa: namedPort(a, l.sourceIfaceId), pb: namedPort(b, l.targetIfaceId) });
  }

  // Most-specific links claim their cable first, so an any-port parallel can't take the
  // cable a named link needs. Each cable satisfies one link.
  const named = (w: Want) => (w.pa ? 1 : 0) + (w.pb ? 1 : 0);
  const patched = new Set<Want>();
  for (const w of [...wants].sort((x, y) => named(y) - named(x))) {
    const pool = openByPair.get(pairKey(w.a.id, w.b.id)) ?? [];
    const i = pool.findIndex((c) => lands(c, w));
    if (i < 0) continue;
    pool.splice(i, 1);
    patched.add(w);
    plan.alreadyPatched++;
  }
  const todo = wants.filter((w) => !patched.has(w));

  // A port a link names is kept for that link; auto-picked ports go around it.
  const reserved = new Set<string>();
  for (const w of todo) {
    if (w.pa) reserved.add(portKey(w.a.id, w.pa));
    if (w.pb) reserved.add(portKey(w.b.id, w.pb));
  }
  const pick = (device: Device): string | null => {
    const free = (device.interfaces ?? []).find(
      (i) => !used.has(portKey(device.id, i.id)) && !reserved.has(portKey(device.id, i.id)),
    );
    return free?.id ?? null;
  };

  const nextLabel = labelCounter(cables);
  const short = new Map<string, number>();
  for (const w of todo) {
    const { link: l, a, b } = w;
    // A named port someone else holds: report it rather than patch the link elsewhere.
    const conflicts = ([[a, w.pa], [b, w.pb]] as const).filter(
      (e): e is readonly [Device, string] => !!e[1] && used.has(portKey(e[0].id, e[1])),
    );
    if (conflicts.length) {
      for (const [d, ifaceId] of conflicts) {
        const cableLabel = used.get(portKey(d.id, ifaceId));
        plan.portConflicts.push({
          linkId: l.id,
          device: d,
          ifaceId,
          port: d.interfaces?.find((i) => i.id === ifaceId)?.name ?? ifaceId,
          ...(cableLabel ? { cableLabel } : {}),
        });
      }
      continue;
    }
    const pa = w.pa ?? pick(a);
    const pb = w.pb ?? pick(b);
    if (!pa || !pb) {
      for (const [d, p] of [[a, pa], [b, pb]] as const) if (!p) short.set(d.id, (short.get(d.id) ?? 0) + 1);
      continue;
    }
    const label = nextLabel();
    used.set(portKey(a.id, pa), label);
    used.set(portKey(b.id, pb), label);
    plan.items.push({
      linkId: l.id,
      aEnd: { deviceId: a.id, ifaceId: pa },
      bEnd: { deviceId: b.id, ifaceId: pb },
      label,
      lengthFt: estimateCableLengthFt(a, b, racks),
    });
  }
  plan.noFreePort = [...short].map(([id, n]) => ({ device: byId.get(id)!, links: n }));
  return plan;
}
