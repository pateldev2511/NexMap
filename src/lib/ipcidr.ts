/**
 * IPv4/IPv6 + CIDR helpers backing NexMap's network validations.
 *
 * Kept dependency-free and pure so the validation engine, import mapping, and
 * tests all share one source of truth. IPv4 is fully supported. IPv6 addresses are
 * parsed properly (group count, "::" placement, an IPv4 tail) and canonicalized per
 * RFC 5952, so equivalent spellings compare equal; an IPv6 address may carry a
 * /0–128 prefix. IPv6 *subnet* math (the IP Plan) is still IPv4-only (Post-MVP).
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

const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;

/** Parse one side of a "::" into 16-bit groups; only the last part may be a dotted quad. */
function ipv6Groups(side: string, allowIpv4Tail: boolean): number[] | null {
  if (side === '') return [];
  const parts = side.split(':');
  const out: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (allowIpv4Tail && i === parts.length - 1 && part.includes('.')) {
      const v4 = parseIpv4(part);
      if (v4 === null) return null;
      out.push(v4 >>> 16, v4 & 0xffff);
    } else if (IPV6_GROUP.test(part)) {
      out.push(parseInt(part, 16));
    } else {
      return null; // an empty group from a stray ":" or ":::", or not hex
    }
  }
  return out;
}

/**
 * Parse an IPv6 address into its eight 16-bit groups, or null if malformed. Accepts
 * one "::" (standing for at least one zero group) and a trailing dotted quad
 * ("::ffff:192.0.2.1"). Zone ids ("fe80::1%eth0") are not supported.
 */
export function parseIpv6(ip: string): number[] | null {
  const s = ip.trim();
  if (!s.includes(':')) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const groups = ipv6Groups(s, true);
    return groups && groups.length === 8 ? groups : null;
  }
  const head = ipv6Groups(halves[0]!, false);
  const tail = ipv6Groups(halves[1]!, true);
  if (!head || !tail || head.length + tail.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/** True for a syntactically valid IPv6 address. */
export function isValidIpv6(ip: string): boolean {
  return parseIpv6(ip) !== null;
}

/**
 * RFC 5952 text for eight groups: lowercase, no leading zeros, the longest run of
 * two or more zero groups (leftmost on a tie) as "::", and an IPv4-mapped tail
 * written as a dotted quad.
 */
function formatIpv6(g: number[]): string {
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `::ffff:${g[6]! >>> 8}.${g[6]! & 255}.${g[7]! >>> 8}.${g[7]! & 255}`;
  }
  let bestStart = -1;
  let bestLen = 1;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (bestStart === -1) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
}

/**
 * The one spelling of an address (any /prefix dropped), or null if it isn't one:
 * IPv4 as a dotted quad, IPv6 per RFC 5952. "2001:0db8:0:0:0:0:0:1" and "2001:db8::1"
 * both come back "2001:db8::1", so duplicate checks compare addresses, not text.
 */
export function canonicalIp(ipOrCidr: string): string | null {
  const ip = stripPrefix(ipOrCidr);
  if (parseIpv4(ip) !== null) return ip; // leading zeros are rejected, so already canonical
  const v6 = parseIpv6(ip);
  return v6 ? formatIpv6(v6) : null;
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

/**
 * True for an interface address written with a prefix, in either family:
 * "10.0.0.5/24" (/0–32) or "2001:db8::1/64" (/0–128). Subnet CIDRs stay IPv4-only
 * (`parseCidr`); this is the check for a device's management or port address.
 */
export function isValidIpWithPrefix(s: string): boolean {
  const slash = s.indexOf('/');
  if (slash === -1) return false;
  const addr = s.slice(0, slash);
  if (!addr.includes(':')) return parseCidr(s) !== null;
  const prefixStr = s.slice(slash + 1).trim();
  if (!/^(0|[1-9]\d{0,2})$/.test(prefixStr) || Number(prefixStr) > 128) return false;
  return parseIpv6(addr) !== null;
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
