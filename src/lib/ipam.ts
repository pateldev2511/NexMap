/**
 * IPAM — IP address-management helpers. The daily-habit win of Stage 1: suggest the
 * next free host in a subnet and show how full it is, so you stop hand-counting hosts.
 *
 * Pure and dependency-light: builds on ipcidr's parsing so the inspector, the IP Plan
 * panel, validation, and tests all share one source of truth. IPv4 only (matches the
 * subnet model); IPv6 lands when its subnet math does.
 *
 * Allocation policy (per the CEO plan): lowest free host first, skipping the network
 * and broadcast addresses, the gateway, and any already-assigned IP. /31 and /32 are
 * handled per RFC 3021 — a /31 has two usable hosts, a /32 exactly one.
 */
import { parseCidr, parseIpv4, stripPrefix } from './ipcidr';

/** Inclusive range of assignable host addresses, as unsigned 32-bit ints. */
export interface HostRange {
  firstInt: number;
  lastInt: number;
  /** Count of assignable hosts. */
  count: number;
}

export interface UsageOptions {
  /** Gateway address; counted as occupied and never suggested. */
  gateway?: string;
}

export interface SubnetUsage {
  capacity: number;
  used: number;
  free: number;
  /** 0..1 fraction of capacity in use. */
  utilization: number;
  exhausted: boolean;
}

/** Format an unsigned 32-bit int as a dotted-quad IPv4 string. */
export function intToIpv4(n: number): string {
  const u = n >>> 0;
  return `${(u >>> 24) & 255}.${(u >>> 16) & 255}.${(u >>> 8) & 255}.${u & 255}`;
}

/**
 * The range of assignable host addresses for a CIDR, or null if the CIDR is invalid.
 * For prefixes ≤ /30 this excludes the network and broadcast addresses; /31 and /32
 * follow RFC 3021 (all addresses usable).
 */
export function usableHostRange(cidr: string): HostRange | null {
  const p = parseCidr(cidr);
  if (!p) return null;
  const networkInt = p.network >>> 0;
  const size = p.prefix === 0 ? 0x100000000 : 2 ** (32 - p.prefix);

  if (p.prefix >= 31) {
    const count = p.prefix === 32 ? 1 : 2;
    return { firstInt: networkInt, lastInt: (networkInt + count - 1) >>> 0, count };
  }

  const first = (networkInt + 1) >>> 0;
  const broadcast = (networkInt + size - 1) >>> 0;
  const last = (broadcast - 1) >>> 0;
  return { firstInt: first, lastInt: last, count: size - 2 };
}

/** Collect the used-address set (assigned IPs + gateway) as unsigned ints. */
function usedSet(usedIps: Iterable<string>, gateway?: string): Set<number> {
  const set = new Set<number>();
  for (const ip of usedIps) {
    const v = parseIpv4(stripPrefix(ip));
    if (v !== null) set.add(v >>> 0);
  }
  if (gateway) {
    const g = parseIpv4(stripPrefix(gateway));
    if (g !== null) set.add(g >>> 0);
  }
  return set;
}

/**
 * The lowest free host address in a subnet, or null if the CIDR is invalid or the
 * subnet is exhausted. `usedIps` may carry a /prefix suffix — it is stripped.
 */
export function nextFreeHost(
  cidr: string,
  usedIps: Iterable<string>,
  opts: UsageOptions = {},
): string | null {
  const range = usableHostRange(cidr);
  if (!range) return null;
  const used = usedSet(usedIps, opts.gateway);
  for (let cur = range.firstInt; cur <= range.lastInt; cur++) {
    if (!used.has(cur >>> 0)) return intToIpv4(cur >>> 0);
  }
  return null;
}

/**
 * Utilization for a subnet: capacity (assignable hosts), how many are used (assigned
 * IPs + gateway that fall inside the host range), and the resulting fraction. Returns
 * null for an invalid CIDR.
 */
export function subnetUsage(
  cidr: string,
  usedIps: Iterable<string>,
  opts: UsageOptions = {},
): SubnetUsage | null {
  const range = usableHostRange(cidr);
  if (!range) return null;

  const inRange = new Set<number>();
  const consider = (ip?: string | null) => {
    if (!ip) return;
    const v = parseIpv4(stripPrefix(ip));
    if (v === null) return;
    const u = v >>> 0;
    if (u >= range.firstInt && u <= range.lastInt) inRange.add(u);
  };
  for (const ip of usedIps) consider(ip);
  consider(opts.gateway);

  const used = inRange.size;
  const capacity = range.count;
  const free = Math.max(0, capacity - used);
  return {
    capacity,
    used,
    free,
    utilization: capacity > 0 ? used / capacity : 0,
    exhausted: free === 0,
  };
}
