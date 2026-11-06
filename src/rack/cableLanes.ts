/**
 * Cable-management lanes: which cable managers dress each patch cord, how full each
 * manager is, and which dense gear has no manager near it. Pure + deterministic.
 *
 * Model: a horizontal manager dresses the cords of gear within MANAGER_REACH_U of it on the
 * same face. A vertical manager (a cable manager on the 0U rail) carries the run along the
 * rack for the stretch of U it covers, and dresses gear beside it directly (finger ducts).
 * A cable runs out of its A-end device into the nearest horizontal manager, down or up the
 * vertical manager, and out of the nearest horizontal manager at its B end. A cord that
 * stays inside one horizontal manager never needs the vertical run; a cross-rack cord runs
 * up each rack's vertical manager to the overhead tray. All of it is advice. Nothing here
 * blocks a placement or a cable (Pillar C: warn, never block).
 */
import type { Device, RackCable } from '@/model/types';
import { isCableManager } from './panelKind';

/** A horizontal manager dresses gear up to this many U away (adjacent = 1). */
export const MANAGER_REACH_U = 3;
/** Rule of thumb: a 1U finger-duct manager dresses about 24 Cat6 patch cords. */
export const CABLES_PER_MANAGER_U = 24;
/** Gear with at least this many cords and no manager in reach gets a suggestion. */
export const DENSE_CABLED_PORTS = 12;

export interface ManagerFill {
  manager: Device;
  cables: number;
  /**
   * About how many cords it holds. Null for a vertical manager: its capacity depends on
   * its width and depth, which vendors publish only through sizing calculators.
   */
  capacity: number | null;
}

export interface UnmanagedDevice {
  device: Device;
  cables: number;
}

export interface CableLanes {
  /** Cable id → the managers it runs through, A end first (empty: no manager in reach). */
  routes: Map<string, Device[]>;
  /** Every mounted manager, in rack/U order (horizontals first), with how many cords run through it. */
  fill: ManagerFill[];
  /** Dense gear whose cords have nowhere to go, most cords first. */
  unmanaged: UnmanagedDevice[];
}

const top = (d: Device) => d.ru! + (d.ruSpan ?? 1) - 1;
const onRail = (d: Device) => d.mount === 'rail';
const placed = (d: Device) => d.rackId != null && d.ru != null;
const racked = (d: Device) => placed(d) && !onRail(d);
const face = (d: Device) => d.side ?? 'front';

/** A cable manager mounted on the 0U rail: it runs vertically. */
export function isVerticalManager(d: Device): boolean {
  return isCableManager(d) && placed(d) && onRail(d);
}

/** U between two units' nearest edges: 1 when they touch, 0 when they overlap. */
function uGap(a: Device, b: Device): number {
  if (top(a) < b.ru!) return b.ru! - top(a);
  if (top(b) < a.ru!) return a.ru! - top(b);
  return 0;
}

const byRackThenU = (a: Device, b: Device) =>
  a.rackId! < b.rackId! ? -1 : a.rackId! > b.rackId! ? 1 : a.ru! - b.ru!;

/** The horizontal manager that dresses `device`'s cords: same rack and face, closest, lowest U on a tie. */
export function nearestManager(device: Device, managers: Device[]): Device | null {
  if (!racked(device) || isCableManager(device)) return null;
  let best: Device | null = null;
  let bestGap = Infinity;
  for (const m of managers) {
    if (m.rackId !== device.rackId || face(m) !== face(device) || onRail(m)) continue;
    const gap = uGap(device, m);
    if (gap > MANAGER_REACH_U) continue;
    if (gap < bestGap || (gap === bestGap && best && m.ru! < best.ru!)) {
      best = m;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * The vertical manager beside `device`: same rack and face, covering at least one of its U.
 * The one covering more of it wins, then the lower one.
 */
export function verticalManagerFor(device: Device, verticals: Device[]): Device | null {
  if (!racked(device) || isCableManager(device)) return null;
  let best: Device | null = null;
  let bestOverlap = 0;
  for (const v of verticals) {
    if (v.rackId !== device.rackId || face(v) !== face(device)) continue;
    const overlap = Math.min(top(v), top(device)) - Math.max(v.ru!, device.ru!) + 1;
    if (overlap <= 0) continue;
    if (overlap > bestOverlap || (overlap === bestOverlap && best && v.ru! < best.ru!)) {
      best = v;
      bestOverlap = overlap;
    }
  }
  return best;
}

export function cableLanes(devices: Device[], cables: RackCable[]): CableLanes {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const managers = devices.filter((d) => isCableManager(d) && placed(d));
  const horizontals = managers.filter((d) => !onRail(d)).sort(byRackThenU);
  const verticals = managers.filter(onRail).sort(byRackThenU);
  const memo = new Map<string, { h: Device | null; v: Device | null }>();
  const lanesOf = (d: Device) => {
    let got = memo.get(d.id);
    if (!got) {
      got = { h: nearestManager(d, horizontals), v: verticalManagerFor(d, verticals) };
      memo.set(d.id, got);
    }
    return got;
  };

  const routes = new Map<string, Device[]>();
  const through = new Map<string, number>();
  const loose = new Map<string, number>();
  for (const c of cables) {
    const a = byId.get(c.aEnd.deviceId);
    const b = byId.get(c.bEnd.deviceId);
    const la = a ? lanesOf(a) : { h: null, v: null };
    const lb = b ? lanesOf(b) : { h: null, v: null };
    // One horizontal manager holding both ends keeps the cord off the vertical run.
    const vertical = !(la.h && la.h === lb.h);
    const via: Device[] = [];
    const add = (m: Device | null) => {
      if (m && !via.includes(m)) via.push(m);
    };
    add(la.h);
    if (vertical) add(la.v);
    if (vertical) add(lb.v);
    add(lb.h);
    for (const [d, l] of [[a, la], [b, lb]] as const) {
      if (d && racked(d) && !isCableManager(d) && !l.h && !l.v) loose.set(d.id, (loose.get(d.id) ?? 0) + 1);
    }
    routes.set(c.id, via);
    for (const m of via) through.set(m.id, (through.get(m.id) ?? 0) + 1);
  }

  const fill: ManagerFill[] = [
    ...horizontals.map((m) => ({ manager: m, cables: through.get(m.id) ?? 0, capacity: CABLES_PER_MANAGER_U * (m.ruSpan ?? 1) })),
    ...verticals.map((m) => ({ manager: m, cables: through.get(m.id) ?? 0, capacity: null })),
  ];
  const unmanaged = [...loose]
    .filter(([, n]) => n >= DENSE_CABLED_PORTS)
    .map(([id, n]) => ({ device: byId.get(id)!, cables: n }))
    .sort((a, b) => b.cables - a.cables || a.device.name.localeCompare(b.device.name));
  return { routes, fill, unmanaged };
}

/** Where a manager sits: "U22" for a horizontal one, "U1–42" for a vertical run. */
export function managerSpanLabel(m: Device): string {
  return onRail(m) && (m.ruSpan ?? 1) > 1 ? `U${m.ru}–${top(m)}` : `U${m.ru}`;
}

/** "cm-01 (U22)" or "cm-01 (U22) → Vertical manager 1 (U1–42) → cm-02 (U35)"; empty when the cord isn't dressed. */
export function routeLabel(via: Device[]): string {
  return via.map((m) => `${m.name} (${managerSpanLabel(m)})`).join(' → ');
}
