import { describe, it, expect } from 'vitest';
import {
  parseIpv4,
  isValidIpv4,
  isValidIpv6,
  parseIpv6,
  canonicalIp,
  isValidIpWithPrefix,
  parseCidr,
  isValidCidr,
  ipInCidr,
  cidrsOverlap,
  stripPrefix,
} from './ipcidr';

describe('parseIpv4', () => {
  it('parses valid dotted quads to uint32', () => {
    expect(parseIpv4('0.0.0.0')).toBe(0);
    expect(parseIpv4('255.255.255.255')).toBe(0xffffffff);
    expect(parseIpv4('192.168.1.1')).toBe(0xc0a80101);
  });

  it('rejects malformed addresses', () => {
    expect(parseIpv4('256.0.0.1')).toBeNull();
    expect(parseIpv4('1.2.3')).toBeNull();
    expect(parseIpv4('1.2.3.4.5')).toBeNull();
    expect(parseIpv4('a.b.c.d')).toBeNull();
    expect(parseIpv4('192.168.01.1')).toBeNull(); // leading zero
    expect(parseIpv4('')).toBeNull();
  });
});

describe('isValidIpv6', () => {
  it('accepts shape-valid addresses', () => {
    expect(isValidIpv6('::1')).toBe(true);
    expect(isValidIpv6('2001:db8::1')).toBe(true);
    expect(isValidIpv6('fe80::1ff:fe23:4567:890a')).toBe(true);
  });
  it('rejects non-v6', () => {
    expect(isValidIpv6('192.168.1.1')).toBe(false);
    expect(isValidIpv6('2001::db8::1')).toBe(false); // double ::
    expect(isValidIpv6('xyz')).toBe(false);
  });

  // #30: colon placement and group count, not just "has a colon and hex groups".
  it.each([
    ['::', true],
    ['::1', true],
    ['1::', true],
    ['2001:db8::1', true],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', true],
    ['2001:DB8:0:0:0:0:0:1', true],
    ['1:2:3:4:5:6:7::', true], // :: standing for one group
    ['::ffff:192.0.2.1', true], // IPv4-mapped tail
    ['64:ff9b::192.0.2.33', true],
    [':', false],
    [':::', false],
    ['1:2', false], // too few groups, no ::
    ['1:2:3:4:5:6:7', false],
    ['1:2:3:4:5:6:7:8:9', false],
    ['1::2:3:4:5:6:7:8', false], // :: with eight explicit groups
    [':1:2:3:4:5:6:7', false], // lone leading colon
    ['1:2:3:4:5:6:7:', false], // lone trailing colon
    ['1:::2', false],
    ['12345::1', false], // group too long
    ['g::1', false],
    ['::1.2.3', false],
    ['1.2.3.4::', false], // dotted quad only allowed at the end
    ['fe80::1%eth0', false], // zone ids aren't supported
  ])('isValidIpv6(%s) is %s', (ip, ok) => {
    expect(isValidIpv6(ip)).toBe(ok);
  });

  it('parses to eight 16-bit groups', () => {
    expect(parseIpv6('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('::ffff:192.0.2.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc000, 0x201]);
    expect(parseIpv6('1:2')).toBeNull();
  });
});

describe('canonicalIp', () => {
  it.each([
    ['2001:db8::1', '2001:db8::1'],
    ['2001:0db8:0:0:0:0:0:1', '2001:db8::1'],
    ['2001:DB8::0:1', '2001:db8::1'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'], // leftmost of equal runs
    ['2001:0:0:1:0:0:0:1', '2001:0:0:1::1'], // longest run wins
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'], // a single 0 group isn't compressed
    ['0:0:0:0:0:0:0:0', '::'],
    ['::ffff:c000:201', '::ffff:192.0.2.1'],
    ['2001:db8::1/64', '2001:db8::1'],
    [' 10.0.0.1/24 ', '10.0.0.1'],
  ])('%s → %s', (raw, canon) => {
    expect(canonicalIp(raw)).toBe(canon);
  });

  it('is null for anything that is not an address', () => {
    expect(canonicalIp('1:2')).toBeNull();
    expect(canonicalIp('router')).toBeNull();
    expect(canonicalIp('')).toBeNull();
  });
});

describe('isValidIpWithPrefix', () => {
  it.each([
    ['10.0.0.5/24', true],
    ['10.0.0.5/32', true],
    ['10.0.0.5/33', false],
    ['2001:db8::1/64', true],
    ['2001:db8::/0', true],
    ['2001:db8::1/128', true],
    ['2001:db8::1/129', false],
    ['2001:db8::1/', false],
    ['2001:db8::1/064', false],
    ['1:2/64', false],
    ['10.0.0.5', false], // no prefix
  ])('%s is %s', (raw, ok) => {
    expect(isValidIpWithPrefix(raw)).toBe(ok);
  });
});

describe('parseCidr / isValidCidr', () => {
  it('parses and masks to the network address', () => {
    expect(parseCidr('10.0.0.5/24')).toEqual({
      network: parseIpv4('10.0.0.0'),
      prefix: 24,
      version: 4,
    });
    expect(parseCidr('0.0.0.0/0')?.network).toBe(0);
  });

  it('handles boundary prefixes /0 /31 /32', () => {
    expect(isValidCidr('192.168.1.1/32')).toBe(true);
    expect(isValidCidr('192.168.1.0/31')).toBe(true);
    expect(isValidCidr('0.0.0.0/0')).toBe(true);
  });

  it('rejects invalid CIDR', () => {
    expect(isValidCidr('10.0.0.0/33')).toBe(false);
    expect(isValidCidr('10.0.0.0')).toBe(false); // no prefix
    expect(isValidCidr('999.0.0.0/8')).toBe(false);
    expect(isValidCidr('10.0.0.0/')).toBe(false);
  });
});

describe('ipInCidr', () => {
  it('detects membership', () => {
    expect(ipInCidr('10.0.0.55', '10.0.0.0/24')).toBe(true);
    expect(ipInCidr('10.0.1.55', '10.0.0.0/24')).toBe(false);
    expect(ipInCidr('192.168.1.1', '192.168.1.1/32')).toBe(true);
    expect(ipInCidr('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });
});

describe('cidrsOverlap', () => {
  it('detects containment both directions', () => {
    expect(cidrsOverlap('10.0.0.0/16', '10.0.1.0/24')).toBe(true);
    expect(cidrsOverlap('10.0.1.0/24', '10.0.0.0/16')).toBe(true);
    expect(cidrsOverlap('10.0.0.0/24', '10.0.1.0/24')).toBe(false);
    expect(cidrsOverlap('0.0.0.0/0', '8.8.8.0/24')).toBe(true);
  });
});

describe('stripPrefix', () => {
  it('removes a /prefix when present', () => {
    expect(stripPrefix('10.0.0.5/24')).toBe('10.0.0.5');
    expect(stripPrefix('10.0.0.5')).toBe('10.0.0.5');
  });
});

// Property: round-trip random IPv4s through parse and membership in /32.
describe('ipcidr properties', () => {
  it('every parseable IPv4 is a member of its own /32', () => {
    const seed = (n: number) => ((n * 2654435761) >>> 0) % 256;
    for (let i = 0; i < 500; i++) {
      const ip = `${seed(i)}.${seed(i + 1)}.${seed(i + 2)}.${seed(i + 3)}`;
      expect(isValidIpv4(ip)).toBe(true);
      expect(ipInCidr(ip, `${ip}/32`)).toBe(true);
    }
  });
});
