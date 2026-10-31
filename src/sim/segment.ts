/**
 * Segment-into-a-subnet — the declarative "carve this selection into its own
 * network" move.
 *
 * Conductor can summon, scaffold, connect and address a topology; this adds the
 * missing verb — segmentation. You lasso a group (a DMZ, a server tier) and it
 * gets its own subnet with real host addresses, so a flat drawing becomes a
 * segmented design one command at a time.
 *
 * Honest scope: it picks the next free private /24 and addresses the selection's
 * addressable, UNADDRESSED members into it — it never re-homes a device that
 * already has an IP, and invents no empty subnet when nothing needs addressing.
 * Pure and canvas-free, built on lib/ipam + lib/ipcidr so it shares the project's
 * one allocation + CIDR source of truth.
 */
import type { Device } from '@/model/types';
import { nextFreeHost } from '@/lib/ipam';
import { cidrsOverlap, ipInCidr, stripPrefix } from '@/lib/ipcidr';
import { isAddressable, pickGatewayDevice } from './autoAddress';

/**
 * The lowest private /24 (10.a.b.0/24) that overlaps no existing subnet and
 * contains no address already in use — so a fresh segment can fill it from .1
 * without colliding with anything on the canvas.
 */
export function nextFreeSubnetCidr(
  existingSubnets: readonly { cidr: string }[],
  existingIps: readonly string[] = [],
): string {
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      const cidr = `10.${a}.${b}.0/24`;
      if (existingSubnets.some((s) => cidrsOverlap(cidr, s.cidr))) continue;
      if (existingIps.some((ip) => ipInCidr(stripPrefix(ip), cidr))) continue;
      return cidr;
    }
  }
  return '10.255.255.0/24'; // 65k /24s exhausted — practically unreachable.
}

export interface SegmentAssignment {
  deviceId: string;
  ip: string;
}

export interface SegmentPlan {
  /** CIDR of the subnet to create for this segment. */
  cidr: string;
  /** Device → newly-allocated IP within the segment, in order. */
  assignments: SegmentAssignment[];
  /** Gateway IP (a router/firewall in the selection), or null if none/ambiguous. */
  gateway: string | null;
}

/**
 * Plan a new subnet carved from `selected`: choose a free /24 and address the
 * selected addressable devices that have no IP yet. Returns null when nothing in
 * the selection needs an address (no empty subnet is invented). `existingIps` are
 * all addresses already on the canvas, so the chosen block avoids them.
 */
export function planSegment(
  selected: readonly Device[],
  existingSubnets: readonly { cidr: string }[],
  existingIps: readonly string[] = [],
  opts: { cidr?: string } = {},
): SegmentPlan | null {
  const unaddressed = selected.filter((d) => isAddressable(d.type) && !d.managementIp);
  if (unaddressed.length === 0) return null;

  const cidr = opts.cidr ?? nextFreeSubnetCidr(existingSubnets, existingIps);
  // Adopt a single router/firewall as the segment's gateway: address it first so it
  // takes the lowest host, and report that address as the gateway.
  const gatewayDevice = pickGatewayDevice(unaddressed);
  const targets = gatewayDevice
    ? [gatewayDevice, ...unaddressed.filter((t) => t.id !== gatewayDevice.id)]
    : unaddressed;

  const used: string[] = []; // fresh block — only what we hand out below.
  const assignments: SegmentAssignment[] = [];
  for (const d of targets) {
    const ip = nextFreeHost(cidr, used);
    if (!ip) break; // block full (a /24 won't happen for a sane selection).
    assignments.push({ deviceId: d.id, ip });
    used.push(ip);
  }
  if (assignments.length === 0) return null;
  const gateway = gatewayDevice
    ? assignments.find((a) => a.deviceId === gatewayDevice.id)?.ip ?? null
    : null;
  return { cidr, assignments, gateway };
}
