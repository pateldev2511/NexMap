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
import { ipInCidr, stripPrefix } from '@/lib/ipcidr';

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

  // Seed "used" with every address already assigned anywhere in the diagram.
  const used: string[] = devices
    .map((d) => d.managementIp)
    .filter((ip): ip is string => !!ip);

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

/**
 * Plan to resolve duplicate management IPs — the kind of error a paste, a clone, or
 * an import leaves behind (and that auto-address never touches, since it only fills
 * blanks). For each address shared by several devices, ONE keeps it (the lowest id,
 * deterministically) and the rest are re-addressed to the next free host in the subnet
 * that contains the clashing address, never colliding with anything already in use.
 *
 * Pure, built on the same `nextFreeHost` allocator. Honest about its limits: a clash
 * whose address falls in no defined subnet is left alone (no range to re-home into),
 * as is any device a full subnet can't fit — those stay flagged for you to resolve.
 */
export function planDeduplicateIps(
  devices: readonly Device[],
  subnets: readonly Subnet[],
): AddressAssignment[] {
  const groups = new Map<string, Device[]>();
  for (const d of devices) {
    if (!d.managementIp) continue;
    const ip = stripPrefix(d.managementIp);
    const g = groups.get(ip);
    if (g) g.push(d);
    else groups.set(ip, [d]);
  }
  // Seed "used" with every address already in the diagram so re-homes never collide.
  const used: string[] = devices
    .map((d) => (d.managementIp ? stripPrefix(d.managementIp) : null))
    .filter((ip): ip is string => !!ip);
  const assignments: AddressAssignment[] = [];
  for (const [ip, members] of groups) {
    if (members.length < 2) continue; // no clash
    const sub = subnets.find((s) => ipInCidr(ip, s.cidr));
    if (!sub) continue; // no containing subnet — can't re-home safely; leave it flagged
    // Lowest id keeps the address; re-address the rest.
    const extras = [...members]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(1);
    for (const d of extras) {
      const next = nextFreeHost(sub.cidr, used, { gateway: sub.gateway });
      if (!next) break; // subnet full — leave this one flagged rather than guess
      assignments.push({ deviceId: d.id, ip: next });
      used.push(next);
    }
  }
  assignments.sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
  return assignments;
}
