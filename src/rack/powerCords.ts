/**
 * Power-cord plan: which PDU outlet each unit's cord goes into, for install day. A
 * single-corded unit gets one cord on its feed; a dual-corded unit one on each. Each cord
 * takes the free outlet on that feed's PDUs nearest its own height, top of the rack first,
 * so cords run short and sideways. Derived, never stored; deterministic. A cord with no
 * free outlet left on its feed is reported, never doubled up.
 */
import type { Device, Rack } from '@/model/types';
import { cordsIntoPdu, isPdu, isRackUps } from './rackPower';

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
    if (feedOf(p) !== feed) continue;
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

/** "1.20 kW" — every power figure the rack designer shows. */
export const kw = (w: number) => `${(w / 1000).toFixed(2)} kW`;

/** The feed a strip or UPS is on; unset counts as A. */
const feedOf = (d: Pick<Device, 'powerFeed'>): 'A' | 'B' => (d.powerFeed === 'B' ? 'B' : 'A');

export interface PduLoad {
  pduId: string;
  feed: 'A' | 'B';
  /** Watts on the strip in normal operation (a unit's draw splits across its live cords). */
  normalW: number;
  /** Watts on the strip if the other feed fails (every dual-corded unit shifts fully here). */
  failoverW: number;
  /** amps × volts, or null when the strip has no rating to check against. */
  ratedW: number | null;
}

/**
 * A PDU's capacity in watts from its rating, or null when amps or volts is missing.
 * Three-phase takes line-to-line volts: √3 × A × V.
 */
export function pduRatedWatts(d: Pick<Device, 'ratedAmps' | 'ratedVolts' | 'ratedPhases'>): number | null {
  const a = d.ratedAmps ?? 0;
  const v = d.ratedVolts ?? 0;
  if (!(a > 0 && v > 0)) return null;
  return d.ratedPhases === 3 ? Math.round(Math.sqrt(3) * a * v) : a * v;
}

/** "30 A × 208 V" or "30 A × 208 V 3-phase" — how a rating reads in text. */
export function pduRatingLabel(d: Pick<Device, 'ratedAmps' | 'ratedVolts' | 'ratedPhases'>): string {
  return `${d.ratedAmps} A × ${d.ratedVolts} V${d.ratedPhases === 3 ? ' 3-phase' : ''}`;
}

export interface UpsLoad {
  feed: 'A' | 'B';
  /** The rated UPSes backing this feed in the rack. */
  upsIds: string[];
  /** Watts on the feed in normal operation. */
  normalW: number;
  /** Watts on the feed if the other feed fails. */
  failoverW: number;
  /** The UPSes' combined output rating. */
  ratedW: number;
}

/** One rack's power, worked out once: the cord plan and every strip's and UPS's load. */
export interface RackPower {
  rackId: string;
  /** The rack's mounted units. */
  devices: Device[];
  byId: Map<string, Device>;
  cords: PowerCord[];
  cordsByDevice: Map<string, PowerCord[]>;
  pdus: Device[];
  pduLoads: PduLoad[];
  upsLoads: UpsLoad[];
}

/** Each rack's mounted units, keyed by rack id: one pass over the fleet. */
export function devicesByRack(devices: readonly Device[]): Map<string, Device[]> {
  const out = new Map<string, Device[]>();
  for (const d of devices) {
    if (d.rackId == null || d.ru == null) continue;
    const list = out.get(d.rackId);
    if (list) list.push(d);
    else out.set(d.rackId, [d]);
  }
  return out;
}

/**
 * A cord is live when it reaches a strip, or always in a rack with no PDU drawn (judged by
 * feed alone). A unit's draw splits across its live cords in normal operation, so a
 * dual-corded unit with one cord unplugged puts its full draw on the other.
 *
 * A rated UPS backs the feed in its `powerFeed` and carries every live cord on it; several
 * on one feed add up. A UPS without an output rating isn't checked, and neither is one on
 * 'AB' (dual input), which backs no single feed. Pure.
 */
export function analyzeRackPower(rack: Pick<Rack, 'id'>, devices: readonly Device[]): RackPower {
  const inRack = devices.filter((d) => mounted(d, rack.id));
  const byId = new Map(inRack.map((d) => [d.id, d]));
  const cords = planPowerCords(rack, inRack);
  const cordsByDevice = new Map<string, PowerCord[]>();
  for (const c of cords) {
    const mine = cordsByDevice.get(c.deviceId);
    if (mine) mine.push(c);
    else cordsByDevice.set(c.deviceId, [c]);
  }
  const pdus = inRack.filter(isPdu);
  const hasPdus = pdus.length > 0;
  const strips = new Map<string, PduLoad>(pdus.map((p) => [p.id, { pduId: p.id, feed: feedOf(p), normalW: 0, failoverW: 0, ratedW: pduRatedWatts(p) }]));
  const ups = new Map<'A' | 'B', UpsLoad>();
  for (const u of inRack) {
    if (!isRackUps(u) || !(u.ratedWatts && u.ratedWatts > 0) || u.powerFeed === 'AB') continue;
    const feed = feedOf(u);
    const l = ups.get(feed) ?? { feed, upsIds: [], normalW: 0, failoverW: 0, ratedW: 0 };
    l.upsIds.push(u.id);
    l.ratedW += u.ratedWatts;
    ups.set(feed, l);
  }
  for (const [id, mine] of cordsByDevice) {
    const live = hasPdus ? mine.filter((c) => c.pduId) : mine;
    if (live.length === 0) continue;
    const w = Math.max(0, byId.get(id)?.watts ?? 0);
    for (const c of live) {
      for (const l of [c.pduId ? strips.get(c.pduId) : undefined, ups.get(c.feed)]) {
        if (!l) continue;
        l.normalW += w / live.length;
        l.failoverW += w;
      }
    }
  }
  return {
    rackId: rack.id,
    devices: inRack,
    byId,
    cords,
    cordsByDevice,
    pdus,
    pduLoads: [...strips.values()],
    upsLoads: [...ups.values()].sort((a, b) => a.feed.localeCompare(b.feed)),
  };
}

/** Load on each PDU in a rack, from the cords that plug into it (see analyzeRackPower). Pure. */
export function pduLoads(rack: Pick<Rack, 'id'>, devices: readonly Device[]): PduLoad[] {
  return analyzeRackPower(rack, devices).pduLoads;
}

/** Load on each feed a rated UPS backs in a rack (see analyzeRackPower). Pure. */
export function upsLoads(rack: Pick<Rack, 'id'>, devices: readonly Device[]): UpsLoad[] {
  return analyzeRackPower(rack, devices).upsLoads;
}

/**
 * Why a unit is dark when a feed fails. 'unpowered' units have no live cord even with
 * both feeds up (no outlet or no PDU), so a failure changes nothing for them.
 */
export type DarkReason = 'unpowered' | 'single-corded' | 'no-pdu' | 'no-outlet' | 'ups-overload' | 'strip-trips';

export interface FeedFailure {
  failed: 'A' | 'B';
  /** Units without power once the feed fails, and why. */
  dark: Map<string, DarkReason>;
  /** Units that keep a live cord. */
  up: Set<string>;
  /** Strips and rated UPSes that go down: the failed feed's, and strips behind an overloaded UPS. */
  deadSources: Set<string>;
  /** Strips on the surviving feed that trip under the load shifted onto them. */
  trippedPdus: Set<string>;
  /** Rated UPSes backing the surviving feed that can't carry the load shifted onto it. */
  overloadedUps: Set<string>;
}

/** One rack's share of a feed failure, from its worked-out power. Adds to `out`. */
function rackFailure(power: RackPower, failed: 'A' | 'B', out: FeedFailure): void {
  const hasPdus = power.pdus.length > 0;
  // A UPS that can't carry its feed's failover load takes the whole feed down with it.
  let upsDown = false;
  for (const l of power.upsLoads) {
    if (l.feed === failed) l.upsIds.forEach((id) => out.deadSources.add(id));
    else if (l.failoverW > l.ratedW) {
      l.upsIds.forEach((id) => out.overloadedUps.add(id));
      upsDown = true;
    }
  }
  for (const l of power.pduLoads) {
    if (l.feed === failed || upsDown) out.deadSources.add(l.pduId);
    else if (l.ratedW != null && l.failoverW > l.ratedW) out.trippedPdus.add(l.pduId);
  }
  const feedHasPdu = (f: 'A' | 'B') => power.pdus.some((p) => feedOf(p) === f);
  for (const [id, mine] of power.cordsByDevice) {
    const live = (c: PowerCord) => !hasPdus || c.pduId != null;
    const offFailed = mine.find((c) => c.feed !== failed);
    const surviving = mine.find((c) => c.feed !== failed && live(c));
    let reason: DarkReason | null = null;
    if (!mine.some(live)) reason = 'unpowered';
    else if (!offFailed) reason = 'single-corded';
    else if (!surviving) reason = feedHasPdu(offFailed.feed) ? 'no-outlet' : 'no-pdu';
    else if (upsDown) reason = 'ups-overload';
    else if (surviving.pduId && out.trippedPdus.has(surviving.pduId)) reason = 'strip-trips';
    if (reason) out.dark.set(id, reason);
    else out.up.add(id);
  }
}

/**
 * What happens when one feed fails: every cord on it dies, every dual-corded unit shifts
 * its full draw onto its other cord, a rated strip that can't carry that trips and takes
 * its cords with it, and a rated UPS that can't carry its feed's load takes the whole feed
 * down. A rack with no PDU drawn is modelled by feed alone; in a rack with PDUs, a
 * surviving cord with no strip or no free outlet is no cord at all. Strips and UPSes
 * without a rating never trip. Pure.
 */
export function feedFailure(racks: readonly Pick<Rack, 'id'>[], devices: readonly Device[], failed: 'A' | 'B'): FeedFailure {
  const out: FeedFailure = { failed, dark: new Map(), up: new Set(), deadSources: new Set(), trippedPdus: new Set(), overloadedUps: new Set() };
  const grouped = devicesByRack(devices);
  for (const rack of racks) rackFailure(analyzeRackPower(rack, grouped.get(rack.id) ?? []), failed, out);
  return out;
}

/** A unit's fate on its Power tab; `bad` when the failure costs it (or its gear) power. */
export interface UnitFate {
  text: string;
  bad: boolean;
}

/**
 * What one unit does when feed `failed` fails, for its Power tab: gear stays up (on which
 * strip) or loses power and why; a PDU or rated UPS goes down with its feed, or holds,
 * trips or overloads under the load shifted onto it. Null for a unit with no power cord
 * and an unrated UPS. Pass the rack's worked-out `power` (and that feed's `failure`) to
 * reuse them. Pure.
 */
export function unitFate(power: RackPower, deviceId: string, failed: 'A' | 'B', failure?: FeedFailure): UnitFate | null {
  const d = power.byId.get(deviceId);
  if (!d) return null;
  const f = failure ?? (() => {
    const out: FeedFailure = { failed, dark: new Map(), up: new Set(), deadSources: new Set(), trippedPdus: new Set(), overloadedUps: new Set() };
    rackFailure(power, failed, out);
    return out;
  })();
  const other = failed === 'A' ? 'B' : 'A';
  const nameOf = (id: string) => power.byId.get(id)?.name ?? id;
  const overloaded = [...f.overloadedUps].filter((id) => power.byId.has(id));
  const upsVerdict = `${overloaded.map(nameOf).join(' + ')} overload${overloaded.length === 1 ? 's' : ''}`;
  const pct = (w: number, of: number) => `${Math.round((w / of) * 100)}%`;
  if (isRackUps(d)) {
    const l = power.upsLoads.find((x) => x.upsIds.includes(d.id));
    if (!l) return null;
    if (l.feed === failed) return { text: 'goes down with it', bad: false };
    const n = l.upsIds.length - 1;
    const shared = n > 0 ? ` with ${n} other UPS${n === 1 ? '' : 'es'}` : '';
    if (l.failoverW > l.ratedW) return { text: `overloads: ${kw(l.failoverW)} on ${kw(l.ratedW)}${shared}`, bad: true };
    return { text: `holds ${kw(l.failoverW)} (${pct(l.failoverW, l.ratedW)})${shared}`, bad: false };
  }
  if (isPdu(d)) {
    if (feedOf(d) === failed) return { text: 'goes down with it', bad: false };
    if (overloaded.length) return { text: `goes down: ${upsVerdict}`, bad: true };
    const l = power.pduLoads.find((x) => x.pduId === d.id)!;
    if (l.ratedW == null) return { text: `carries ${kw(l.failoverW)}; add a rating to check it`, bad: false };
    if (l.failoverW > l.ratedW) return { text: `trips: ${kw(l.failoverW)} on ${kw(l.ratedW)}`, bad: true };
    return { text: `holds ${kw(l.failoverW)} (${pct(l.failoverW, l.ratedW)})`, bad: false };
  }
  const reason = f.dark.get(d.id);
  if (!reason && !f.up.has(d.id)) return null;
  const surviving = power.cordsByDevice.get(d.id)?.find((c) => c.feed !== failed);
  if (!reason) return { text: surviving?.pduId ? `stays up on ${nameOf(surviving.pduId)}` : 'stays up', bad: false };
  const why: Record<DarkReason, string> = {
    unpowered: 'no power even now: none of its cords reaches an outlet',
    'single-corded': `loses power: single-corded on feed ${failed}`,
    'no-pdu': `loses power: no PDU on feed ${other}`,
    'no-outlet': `loses power: no free outlet on feed ${other}`,
    'ups-overload': `loses power: ${upsVerdict}`,
    'strip-trips': `loses power: ${surviving?.pduId ? nameOf(surviving.pduId) : 'its strip'} trips`,
  };
  return { text: why[reason], bad: true };
}

/** "If feed A fails: 3 units lose power (2 single-corded, 1 on a tripped strip) · PDU 2 trips · 6 stay up". */
export function feedFailureSummary(f: FeedFailure, devices: readonly Device[]): string {
  const other = f.failed === 'A' ? 'B' : 'A';
  const why: Record<Exclude<DarkReason, 'unpowered'>, string> = {
    'single-corded': 'single-corded',
    'no-pdu': `no PDU on feed ${other}`,
    'no-outlet': 'no free outlet',
    'ups-overload': 'on an overloaded UPS',
    'strip-trips': 'on a tripped strip',
  };
  const counts = new Map<DarkReason, number>();
  for (const r of f.dark.values()) counts.set(r, (counts.get(r) ?? 0) + 1);
  const unpowered = counts.get('unpowered') ?? 0;
  const n = f.dark.size - unpowered;
  const parts = [`If feed ${f.failed} fails: `];
  if (n === 0) parts.push(f.up.size ? `nothing loses power (${f.up.size} unit${f.up.size === 1 ? ' stays' : 's stay'} up)` : 'no racked unit draws power');
  else {
    const reasons = (Object.keys(why) as (keyof typeof why)[]).filter((r) => counts.has(r)).map((r) => `${counts.get(r)} ${why[r]}`);
    parts.push(`${n} unit${n === 1 ? '' : 's'} lose${n === 1 ? 's' : ''} power (${reasons.join(', ')})`);
  }
  const named = new Set([...f.overloadedUps, ...f.trippedPdus]);
  const names = new Map(devices.filter((d) => named.has(d.id)).map((d) => [d.id, d.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const ups = [...f.overloadedUps].map(nameOf);
  if (ups.length) parts.push(` · ${ups.join(', ')} overload${ups.length === 1 ? 's' : ''}`);
  const strips = [...f.trippedPdus].map(nameOf);
  if (strips.length) parts.push(` · ${strips.join(', ')} trip${strips.length === 1 ? 's' : ''}`);
  if (n > 0 && f.up.size) parts.push(` · ${f.up.size} stay${f.up.size === 1 ? 's' : ''} up`);
  if (unpowered) parts.push(` · ${unpowered} ${unpowered === 1 ? 'has' : 'have'} no power even now`);
  return parts.join('');
}

/** One PDU or UPS in the power-strip schedule, as text ready for a table or CSV. */
export interface PowerStripRow {
  rack: string;
  /** The strip, or the UPS(es) backing a feed. */
  pdu: string;
  feed: string;
  /** "16 A × 230 V · 3.68 kW", or "" without a rating. */
  rating: string;
  /** "1.20 kW · 58%" (the percent only with a rating). */
  normal: string;
  /** Load if the other feed fails. */
  failover: string;
  status: string;
}

/**
 * Over its rating now, over it if the other feed fails ("trips" for a strip, "overloads"
 * for a UPS), past 80% then, or ok. Shared by the schedule and the insights.
 */
export function loadStatus(l: { feed: 'A' | 'B'; normalW: number; failoverW: number; ratedW: number | null }, verb: 'trips' | 'overloads'): string {
  const other = l.feed === 'A' ? 'B' : 'A';
  if (l.ratedW == null) return 'no rating';
  if (l.normalW > l.ratedW) return 'over its rating';
  if (l.failoverW > l.ratedW) return `${verb} if ${other} fails`;
  if (l.failoverW > l.ratedW * 0.8) return `past 80% if ${other} fails`;
  return 'ok';
}

/**
 * Every PDU in the racks, then each feed's rated UPSes, with the rating, the load now and
 * the load if the other feed fails, and what that means (see loadStatus). Racks in the
 * order given. Pure.
 */
export function powerStripRows(racks: readonly Rack[], devices: readonly Device[]): PowerStripRow[] {
  const rows: PowerStripRow[] = [];
  const row = (rack: Rack, name: string, l: { feed: 'A' | 'B'; normalW: number; failoverW: number; ratedW: number | null }, rating: string, verb: 'trips' | 'overloads') => {
    const pct = (w: number) => (l.ratedW ? ` · ${Math.round((w / l.ratedW) * 100)}%` : '');
    rows.push({
      rack: rack.name,
      pdu: name,
      feed: l.feed,
      rating,
      normal: `${kw(l.normalW)}${pct(l.normalW)}`,
      failover: `${kw(l.failoverW)}${pct(l.failoverW)}`,
      status: loadStatus(l, verb),
    });
  };
  const grouped = devicesByRack(devices);
  for (const rack of racks) {
    const power = analyzeRackPower(rack, grouped.get(rack.id) ?? []);
    for (const l of [...power.pduLoads].sort((a, b) => a.feed.localeCompare(b.feed))) {
      const p = power.byId.get(l.pduId)!;
      row(rack, p.name, l, l.ratedW == null ? '' : `${pduRatingLabel(p)} · ${kw(l.ratedW)}`, 'trips');
    }
    for (const l of power.upsLoads) {
      row(rack, l.upsIds.map((id) => power.byId.get(id)?.name ?? id).join(' + '), l, `UPS · ${kw(l.ratedW)} output`, 'overloads');
    }
  }
  return rows;
}

/** One CSV row per PDU and per UPS-backed feed: rating, load, and load if the other feed fails. */
export function powerStripCsv(racks: readonly Rack[], devices: readonly Device[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = ['Rack,PDU / UPS,Feed,Rating,Load,If other feed fails,Status'];
  for (const r of powerStripRows(racks, devices)) rows.push([r.rack, r.pdu, r.feed, r.rating, r.normal, r.failover, r.status].map(q).join(','));
  return rows.join('\n');
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
