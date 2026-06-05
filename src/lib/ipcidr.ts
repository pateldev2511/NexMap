/**
 * IPv4/IPv6 + CIDR helpers backing NexMap's network validations.
 *
 * Kept dependency-free and pure so the validation engine, import mapping, and
 * tests all share one source of truth. IPv4 is fully supported; IPv6 parsing is
 * intentionally minimal (presence + basic shape) for MVP validations — the heavy
 * IPv6 subnet math lands when cloud/IPv6 validations do (Post-MVP).
 */

export interface ParsedCidr {
  /** Network address as an unsigned 32-bit int (IPv4). */
  network: number;
  prefix: number;
  version: 4;
}

const IPV4_OCTET = /^\d{1,3}$/;

/** Parse a dotted-quad IPv4 string into a uint32, or null if malformed. */
export function parseIpv4(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    // Reject leading zeros like "01" which are ambiguous.
    if (part.length > 1 && part[0] === '0') return null;
    value = (value << 8) | octet;
  }
  // Coerce to unsigned.
  return value >>> 0;
}

/** True for a syntactically valid IPv4 address. */
export function isValidIpv4(ip: string): boolean {
  return parseIpv4(ip) !== null;
}

/** Minimal IPv6 validity check (shape only — full math is Post-MVP). */
export function isValidIpv6(ip: string): boolean {
  const s = ip.trim();
  if (!s.includes(':')) return false;
  // At most one "::" compression, hex groups of 1-4 digits.
  const doubleColons = s.match(/::/g);
  if (doubleColons && doubleColons.length > 1) return false;
  const groups = s.split(':');
  if (groups.length > 8) return false;
  for (const g of groups) {
    if (g === '') continue; // from "::" or leading/trailing
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
  }
  return true;
}

export function isValidIp(ip: string): boolean {
  return isValidIpv4(ip) || isValidIpv6(ip);
}

/**
 * Parse "a.b.c.d/n" (IPv4) into network + prefix. Returns null if either the
 * address or the /prefix is invalid. The address need not already be the network
 * address — we mask it down to the network for you.
 */
export function parseCidr(cidr: string): ParsedCidr | null {
  const s = cidr.trim();
  const slash = s.indexOf('/');
  if (slash === -1) return null;
  const addr = s.slice(0, slash);
  const prefixStr = s.slice(slash + 1);
  if (!/^\d{1,2}$/.test(prefixStr)) return null;
  const prefix = Number(prefixStr);
  if (prefix < 0 || prefix > 32) return null;
  const ip = parseIpv4(addr);
  if (ip === null) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (ip & mask) >>> 0, prefix, version: 4 };
}

/** True for a syntactically valid IPv4 CIDR like "10.0.0.0/24". */
export function isValidCidr(cidr: string): boolean {
  return parseCidr(cidr) !== null;
}

/** True if an IPv4 address falls within the given CIDR range. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  const value = parseIpv4(ip);
  if (parsed === null || value === null) return false;
  const mask = parsed.prefix === 0 ? 0 : (0xffffffff << (32 - parsed.prefix)) >>> 0;
  return (value & mask) >>> 0 === parsed.network;
}

/** True if two IPv4 CIDR ranges overlap (either contains the other's network). */
export function cidrsOverlap(a: string, b: string): boolean {
  const pa = parseCidr(a);
  const pb = parseCidr(b);
  if (!pa || !pb) return false;
  const broader = pa.prefix <= pb.prefix ? pa : pb;
  const narrower = pa.prefix <= pb.prefix ? pb : pa;
  const mask = broader.prefix === 0 ? 0 : (0xffffffff << (32 - broader.prefix)) >>> 0;
  return (narrower.network & mask) >>> 0 === broader.network;
}

/**
 * Strip a "/prefix" suffix if present, returning the bare address. Used when a
 * device's management IP is entered as "10.0.0.5/24".
 */
export function stripPrefix(ipOrCidr: string): string {
  const slash = ipOrCidr.indexOf('/');
  return slash === -1 ? ipOrCidr.trim() : ipOrCidr.slice(0, slash).trim();
}
