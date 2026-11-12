import { describe, it, expect } from 'vitest';
import { intToIpv4, usableHostRange, nextFreeHost, subnetUsage, createHostAllocator } from './ipam';

describe('intToIpv4', () => {
  it('formats unsigned ints, including the high bit', () => {
    expect(intToIpv4(0x0a000001)).toBe('10.0.0.1');
    expect(intToIpv4(0xffffffff)).toBe('255.255.255.255');
    expect(intToIpv4(0xc0a80001)).toBe('192.168.0.1');
  });
});

describe('usableHostRange', () => {
  it('excludes network and broadcast for a /24', () => {
    const r = usableHostRange('10.0.0.0/24')!;
    expect(intToIpv4(r.firstInt)).toBe('10.0.0.1');
    expect(intToIpv4(r.lastInt)).toBe('10.0.0.254');
    expect(r.count).toBe(254);
  });

  it('treats a /31 as two usable hosts (RFC 3021)', () => {
    const r = usableHostRange('10.0.0.0/31')!;
    expect(r.count).toBe(2);
    expect(intToIpv4(r.firstInt)).toBe('10.0.0.0');
    expect(intToIpv4(r.lastInt)).toBe('10.0.0.1');
  });

  it('treats a /32 as a single host', () => {
    const r = usableHostRange('10.0.0.5/32')!;
    expect(r.count).toBe(1);
    expect(intToIpv4(r.firstInt)).toBe('10.0.0.5');
  });

  it('returns null for an invalid CIDR', () => {
    expect(usableHostRange('nope')).toBeNull();
  });
});

describe('nextFreeHost', () => {
  it('returns the lowest free host, skipping used + gateway', () => {
    const used = ['10.0.0.1', '10.0.0.2', '10.0.0.4'];
    expect(nextFreeHost('10.0.0.0/24', used, { gateway: '10.0.0.3' })).toBe('10.0.0.5');
  });

  it('starts at .1 in an empty subnet', () => {
    expect(nextFreeHost('192.168.1.0/24', [])).toBe('192.168.1.1');
  });

  it('strips a /prefix suffix from assigned IPs', () => {
    expect(nextFreeHost('10.0.0.0/24', ['10.0.0.1/24'])).toBe('10.0.0.2');
  });

  it('returns null when the subnet is exhausted', () => {
    // /30 has two usable hosts: .1 and .2
    expect(nextFreeHost('10.0.0.0/30', ['10.0.0.1', '10.0.0.2'])).toBeNull();
  });

  it('handles a /31 point-to-point link', () => {
    expect(nextFreeHost('10.0.0.0/31', ['10.0.0.0'])).toBe('10.0.0.1');
    expect(nextFreeHost('10.0.0.0/31', ['10.0.0.0', '10.0.0.1'])).toBeNull();
  });

  it('ignores assigned IPs that fall outside the subnet', () => {
    expect(nextFreeHost('10.0.0.0/24', ['192.168.0.1'])).toBe('10.0.0.1');
  });
});

describe('subnetUsage', () => {
  it('computes capacity, used, free, and utilization', () => {
    const u = subnetUsage('10.0.0.0/24', ['10.0.0.1', '10.0.0.2'], { gateway: '10.0.0.254' })!;
    expect(u.capacity).toBe(254);
    expect(u.used).toBe(3); // two hosts + gateway
    expect(u.free).toBe(251);
    expect(u.utilization).toBeCloseTo(3 / 254, 5);
    expect(u.exhausted).toBe(false);
  });

  it('counts each address once even if listed twice', () => {
    const u = subnetUsage('10.0.0.0/24', ['10.0.0.1', '10.0.0.1'])!;
    expect(u.used).toBe(1);
  });

  it('does not count out-of-range or invalid addresses', () => {
    const u = subnetUsage('10.0.0.0/24', ['192.168.0.1', 'garbage', '10.0.0.5'])!;
    expect(u.used).toBe(1);
  });

  it('flags an exhausted subnet', () => {
    const u = subnetUsage('10.0.0.0/30', ['10.0.0.1', '10.0.0.2'])!;
    expect(u.exhausted).toBe(true);
    expect(u.free).toBe(0);
  });
});

describe('createHostAllocator — matches repeated nextFreeHost', () => {
  function lcg(seed: number) {
    let x = seed;
    return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  }

  it('reproduces the exact sequence across prefixes, gateways, pre-used and cross-subnet addresses', () => {
    const cidrs = ['10.0.0.0/24', '10.0.1.0/30', '10.0.2.0/31', '10.0.3.4/32', '10.0.0.0/24'];
    const gateways: Array<string | undefined> = [undefined, '10.0.0.1', '10.0.0.7', '10.0.1.2', '10.0.2.1', '10.0.3.4'];
    for (let seed = 1; seed <= 25; seed++) {
      const rnd = lcg(seed);
      const pre: string[] = [];
      for (let i = 0; i < 30; i++) {
        const sn = Math.floor(rnd() * 4);
        pre.push(`10.0.${sn}.${Math.floor(rnd() * 12)}${rnd() < 0.2 ? '/24' : ''}`);
      }
      const used = [...pre];
      const alloc = createHostAllocator(pre);
      for (let i = 0; i < 120; i++) {
        const cidr = cidrs[Math.floor(rnd() * cidrs.length)]!;
        const gw = gateways[Math.floor(rnd() * gateways.length)];
        const expected = nextFreeHost(cidr, used, gw ? { gateway: gw } : {});
        expect(alloc.next(cidr, gw)).toBe(expected);
        if (expected) used.push(expected);
      }
    }
  });

  it('a gateway only excludes within its own call', () => {
    const a = createHostAllocator();
    expect(a.next('10.0.0.0/24', '10.0.0.1')).toBe('10.0.0.2');
    expect(a.next('10.0.0.0/24')).toBe('10.0.0.1');
  });

  it('add() marks addresses used; invalid CIDR returns null', () => {
    const a = createHostAllocator();
    a.add('10.0.0.1/24');
    expect(a.next('10.0.0.0/24')).toBe('10.0.0.2');
    expect(a.next('nope')).toBeNull();
  });
});
