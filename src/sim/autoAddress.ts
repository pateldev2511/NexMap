/**
 * Auto-address — give a drawn topology real IP addresses in one move.
 *
 * Conductor scaffolds and weaves the shape; this closes the loop from "boxes and
 * lines" to "a network that's actually specified." It walks the addressable
 * devices that have no management IP yet and assigns each the next free host from
 * the project's subnets, never colliding with an address already in use. When no
 * subnet exists (the common case right after inserting a template, which drops
 * IPs), it proposes a single default /24 for the caller to create alongside.
 *
 * Pure and canvas-free, built on lib/ipam's `nextFreeHost` so the inspector's
 * one-at-a-time "Suggest" and this bulk pass share the exact same allocation
 * policy (lowest free host, skipping network/broadcast/gateway/used).
 */
import type { Device, DeviceType, Subnet } from '@/model/types';
import { nextFreeHost } from '@/lib/ipam';
import { cidrsOverlap, ipInCidr, isValidCidr, isValidIpv4, stripPrefix } from '@/lib/ipcidr';

/** The default subnet synthesized when a topology has none to address from. */
export const DEFAULT_SUBNET_CIDR = '10.0.0.0/24';

/**
 * Types that don't carry a host management IP: external clouds, abstract cloud
 * constructs, and passive/physical infrastructure. Everything else is addressable.
 */
const NON_ADDRESSABLE: ReadonlySet<DeviceType> = new Set<DeviceType>([
  'isp',
  'cloud',
  'vpc',
  'cloud-subnet',
  'route-table',
  'security-group',
  'rack',
  'patch-panel',
  'ups',
]);

export function isAddressable(type: DeviceType): boolean {
  return !NON_ADDRESSABLE.has(type);
}

/**
 * Every address already assigned in the diagram — device management IPs plus
 * per-port interface IPs (schema v5), in raw form (may carry a /prefix). Seeds
 * the allocators so a new assignment never collides with an existing address,
 * management or port.
 */
export function usedAddresses(devices: readonly Device[]): string[] {
  const out: string[] = [];
  for (const d of devices) {
    if (d.managementIp) out.push(d.managementIp);
    for (const iface of d.interfaces ?? []) {
      if (iface.ip) out.push(iface.ip);
    }
  }
  return out;
}

/**
 * Types that route between subnets, i.e. can serve as a subnet's default gateway.
 * Deliberately narrow — a generic `switch` is treated as L2, so we don't guess its
 * L3-ness; routers and firewalls are the unambiguous gateways.
 */
export const GATEWAY_TYPES: ReadonlySet<DeviceType> = new Set<DeviceType>(['router', 'firewall']);

/**
 * The one gateway-capable device in a group, or null when zero or several qualify
 * (ambiguous — we don't pick a gateway for you). Generic over anything with a type.
 */
export function pickGatewayDevice<T extends { type: DeviceType }>(devices: readonly T[]): T | null {
  const gws = devices.filter((d) => GATEWAY_TYPES.has(d.type));
  return gws.length === 1 ? gws[0]! : null;
}

export interface AddressAssignment {
  deviceId: string;
  ip: string;
}

/**
 * A re-address target: a device's management IP (no `ifaceId`) or one of its
 * ports (`ifaceId` set). Used by the duplicate-IP fixer, which now spans both.
 */
export interface AddressTarget extends AddressAssignment {
  ifaceId?: string;
}

export interface AddressPlan {
  /** Device → newly-allocated IP, in assignment order. */
  assignments: AddressAssignment[];
  /** A subnet the caller must create first (CIDR), or null if existing ones sufficed. */
  createdSubnetCidr: string | null;
  /** Gateway IP for the created subnet (a router/firewall's own address), or null. */
  createdSubnetGateway: string | null;
  /** Addressable devices that needed an IP but every subnet was full. */
  unassigned: string[];
}

/**
 * Plan IP assignments for a topology. Only addressable devices WITHOUT an IP are
 * touched (existing addresses are never overwritten). Pass `onlyIds` to scope the
 * pass to a selection. Allocation accumulates as it goes, so a single pass never
 * hands out the same address twice.
 */
export function planAddresses(
  devices: Device[],
  subnets: Subnet[],
  opts: { onlyIds?: Set<string>; defaultCidr?: string } = {},
): AddressPlan {
  let targets = devices.filter(
    (d) =>
      isAddressable(d.type) &&
      !d.managementIp &&
      (!opts.onlyIds || opts.onlyIds.has(d.id)),
  );

  // Seed "used" with every address already assigned anywhere in the diagram
  // (device management IPs AND per-port interface IPs).
  const used: string[] = usedAddresses(devices);

  let subs = subnets.map((s) => ({ cidr: s.cidr, gateway: s.gateway }));
  let createdSubnetCidr: string | null = null;
  let gatewayDevice: Device | null = null;
  if (targets.length > 0 && subs.length === 0) {
    createdSubnetCidr = opts.defaultCidr ?? DEFAULT_SUBNET_CIDR;
    subs = [{ cidr: createdSubnetCidr, gateway: undefined }];
    // Adopt a single router/firewall as the new subnet's gateway: address it first
    // so it takes the lowest host, and report that address as the gateway.
    gatewayDevice = pickGatewayDevice(targets);
    if (gatewayDevice) {
      targets = [gatewayDevice, ...targets.filter((t) => t.id !== gatewayDevice!.id)];
    }
  }

  const assignments: AddressAssignment[] = [];
  const unassigned: string[] = [];
  for (const d of targets) {
    let ip: string | null = null;
    for (const s of subs) {
      ip = nextFreeHost(s.cidr, used, { gateway: s.gateway });
      if (ip) break;
    }
    if (ip) {
      assignments.push({ deviceId: d.id, ip });
      used.push(ip);
    } else {
      unassigned.push(d.id);
    }
  }
  const createdSubnetGateway = gatewayDevice
    ? assignments.find((a) => a.deviceId === gatewayDevice!.id)?.ip ?? null
    : null;
  return { assignments, createdSubnetCidr, createdSubnetGateway, unassigned };
}

export interface GatewayAssignment {
  subnetId: string;
  /** The adopted gateway host (a router/firewall's own address inside the subnet). */
  gateway: string;
}

/**
 * Adopt gateways for EXISTING subnets that have none. For each gateway-less subnet,
 * if exactly one addressed router/firewall sits inside its CIDR, that device's IP
 * becomes the subnet's gateway. Completes the gateway story: auto-address/segment set
 * a gateway on the subnets they create, and this closes it on subnets drawn by hand
 * or imported, clearing the honest "subnet has no gateway" warning truthfully.
 *
 * Pure. Refuses the ambiguous case: a subnet with zero or several in-CIDR L3 devices
 * is left untouched (we don't guess which box is the gateway).
 */
export function planGateways(
  subnets: readonly Subnet[],
  devices: readonly Device[],
): GatewayAssignment[] {
  const l3 = devices
    .filter((d) => GATEWAY_TYPES.has(d.type) && d.managementIp)
    .map((d) => ({ id: d.id, ip: stripPrefix(d.managementIp!) }));
  const assignments: GatewayAssignment[] = [];
  for (const s of subnets) {
    if (s.gateway) continue; // already has a gateway — never overwrite it
    const inSubnet = l3.filter((d) => ipInCidr(d.ip, s.cidr));
    if (inSubnet.length === 1) assignments.push({ subnetId: s.id, gateway: inSubnet[0]!.ip });
  }
  return assignments;
}

/** One address in the diagram: a device's management IP, or one of its ports. */
interface AddressSlot {
  deviceId: string;
  ifaceId?: string; // present → a port; absent → the management IP
  ip: string; // raw, may carry a /prefix
}
function addressSlots(devices: readonly Device[]): AddressSlot[] {
  const out: AddressSlot[] = [];
  for (const d of devices) {
    if (d.managementIp?.trim()) out.push({ deviceId: d.id, ip: d.managementIp });
    for (const iface of d.interfaces ?? []) {
      if (iface.ip?.trim()) out.push({ deviceId: d.id, ifaceId: iface.id, ip: iface.ip });
    }
  }
  return out;
}
/** Deterministic order: by device id, then management (no ifaceId) before ports. */
function bySlot(a: AddressSlot, b: AddressSlot): number {
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  const ai = a.ifaceId ?? '';
  const bi = b.ifaceId ?? '';
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/**
 * Plan to resolve duplicate IPs — across device management IPs AND per-port IPs
 * (schema v5). The kind of error a paste, a clone, or an import leaves behind. For
 * each address shared by several interfaces, ONE keeps it (deterministically: lowest
 * device id, management before ports) and the rest are re-addressed to the next free
 * host in the subnet that contains the clashing address, never colliding with anything
 * already in use.
 *
 * Pure, built on the same `nextFreeHost` allocator. Honest about its limits: a clash
 * whose address falls in no defined subnet is left alone (no range to re-home into),
 * as is any slot a full subnet can't fit — those stay flagged for you to resolve.
 */
export function planDeduplicateIps(
  devices: readonly Device[],
  subnets: readonly Subnet[],
): AddressTarget[] {
  const slots = addressSlots(devices);
  const groups = new Map<string, AddressSlot[]>();
  for (const slot of slots) {
    const ip = stripPrefix(slot.ip);
    const g = groups.get(ip);
    if (g) g.push(slot);
    else groups.set(ip, [slot]);
  }
  // Seed "used" with every address already in the diagram so re-homes never collide.
  const used: string[] = slots.map((s) => stripPrefix(s.ip));
  const assignments: AddressTarget[] = [];
  for (const [ip, members] of groups) {
    if (members.length < 2) continue; // no clash
    const sub = subnets.find((s) => ipInCidr(ip, s.cidr));
    if (!sub) continue; // no containing subnet — can't re-home safely; leave it flagged
    // The first slot keeps the address; re-address the rest.
    const extras = [...members].sort(bySlot).slice(1);
    for (const m of extras) {
      const next = nextFreeHost(sub.cidr, used, { gateway: sub.gateway });
      if (!next) break; // subnet full — leave this one flagged rather than guess
      assignments.push(m.ifaceId ? { deviceId: m.deviceId, ifaceId: m.ifaceId, ip: next } : { deviceId: m.deviceId, ip: next });
      used.push(next);
    }
  }
  assignments.sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
  return assignments;
}

/** A per-port address assignment (schema v5 bulk auto-address). */
export interface InterfaceAddress {
  deviceId: string;
  ifaceId: string;
  ip: string;
}

/**
 * Bulk auto-address interfaces. Policy: each port inherits the subnet of its
 * device's MANAGEMENT IP — the next free host from that subnet is given to every
 * interface that has no IP yet.
 *
 * Honest refusals, in the spirit of every other Conductor move: a device with no
 * management IP, or whose management IP sits in no defined subnet, is skipped —
 * we won't guess which subnet its ports belong to. A port is left for the user if
 * its subnet is full. Existing port IPs are never overwritten, and nothing is ever
 * given an address already in use (management or port). Deterministic by device id.
 */
export function planInterfaceAddresses(
  devices: readonly Device[],
  subnets: readonly Subnet[],
): InterfaceAddress[] {
  const used = usedAddresses(devices).map((ip) => stripPrefix(ip));
  const assignments: InterfaceAddress[] = [];
  const ordered = [...devices].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const d of ordered) {
    if (!d.managementIp) continue; // no anchor → skip (won't guess the ports' subnet)
    const mgmt = stripPrefix(d.managementIp);
    const subnet = subnets.find((s) => ipInCidr(mgmt, s.cidr));
    if (!subnet) continue; // management IP outside every subnet → skip
    for (const iface of d.interfaces ?? []) {
      if (iface.ip?.trim()) continue; // never overwrite an existing port IP
      const next = nextFreeHost(subnet.cidr, used, { gateway: subnet.gateway });
      if (!next) break; // subnet full → leave the remaining ports for the user
      assignments.push({ deviceId: d.id, ifaceId: iface.id, ip: next });
      used.push(next);
    }
  }
  return assignments;
}

/** A subnet to draw: its CIDR and the orphan IPs it will bring in-range. */
export interface CoveringSubnetPlan {
  cidr: string;
  ips: string[];
}

/**
 * Draw subnets to cover addresses that sit outside every defined range — the
 * `ip-outside-subnet` warning. For each orphan IPv4 we derive its natural /24
 * (the common LAN prefix, matching DEFAULT_SUBNET_CIDR) and propose one subnet
 * per distinct /24.
 *
 * This is the one planner that *picks* a prefix instead of reading one off the
 * model, so it is deliberately conservative — the IP itself fixes the network;
 * only the /24 boundary is a convention. It only covers IPs the validator
 * actually flags (so: only when subnets already exist — with none, that's
 * auto-address's job and nothing is flagged), and it REFUSES any /24 that would
 * overlap an existing subnet, leaving that address flagged rather than drawing a
 * range that collides. Created subnets are gateway-less, consistent with
 * auto-address; run "Assign gateways" afterward to adopt one.
 */
export function planCoveringSubnets(
  devices: readonly Device[],
  subnets: readonly Subnet[],
): CoveringSubnetPlan[] {
  const existing = subnets.map((s) => s.cidr).filter((c) => isValidCidr(c));
  if (existing.length === 0) return []; // no subnets → no ip-outside-subnet warning fires
  // Orphan IPv4s — management AND per-port — valid and inside none of the existing
  // ranges (mirrors validate.ts, which now flags port IPs the same way).
  const orphanIps = new Set<string>();
  for (const raw of usedAddresses(devices)) {
    const ip = stripPrefix(raw);
    if (!isValidIpv4(ip)) continue;
    if (!existing.some((c) => ipInCidr(ip, c))) orphanIps.add(ip);
  }
  // Group orphans by their /24 base so one subnet can cover several.
  const byBase = new Map<string, string[]>();
  for (const ip of orphanIps) {
    const base = `${ip.split('.').slice(0, 3).join('.')}.0`;
    const g = byBase.get(base);
    if (g) g.push(ip);
    else byBase.set(base, [ip]);
  }
  const plans: CoveringSubnetPlan[] = [];
  for (const base of [...byBase.keys()].sort()) {
    const cidr = `${base}/24`;
    // Refuse to collide with a range the user already drew (distinct /24s never
    // overlap each other, so only the existing subnets can conflict).
    if (existing.some((c) => cidrsOverlap(cidr, c))) continue;
    plans.push({ cidr, ips: byBase.get(base)!.sort() });
  }
  return plans;
}
