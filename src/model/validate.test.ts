import { describe, it, expect, beforeEach } from 'vitest';
import { validate, resetIssueIds } from './validate';
import { createDevice, createLink, createVlan, createSubnet, createRack } from './schema';
import type { Device, Subnet } from './types';
import { cidrsOverlap, ipInCidr, isValidCidr } from '@/lib/ipcidr';

const LAYER = 'layer-1';

function dev(name: string, ip?: string): Device {
  return createDevice('router', 0, 0, LAYER, { name, managementIp: ip });
}

beforeEach(() => resetIssueIds());

describe('validate — MVP checks', () => {
  it('clean topology yields no issues', () => {
    const a = dev('core-1', '10.0.0.1');
    const b = dev('core-2', '10.0.0.2');
    const link = createLink(a.id, b.id, LAYER);
    expect(validate({ devices: [a, b], links: [link] })).toEqual([]);
  });

  it('flags duplicate IPs', () => {
    const a = dev('a', '10.0.0.1');
    const b = dev('b', '10.0.0.1');
    const issues = validate({ devices: [a, b], links: [] });
    const dup = issues.find((i) => i.code === 'duplicate-ip');
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe('error');
    expect(dup?.objectIds.sort()).toEqual([a.id, b.id].sort());
  });

  it('treats 10.0.0.1 and 10.0.0.1/24 as the same IP', () => {
    const a = dev('a', '10.0.0.1');
    const b = dev('b', '10.0.0.1/24');
    const issues = validate({ devices: [a, b], links: [] });
    expect(issues.some((i) => i.code === 'duplicate-ip')).toBe(true);
  });

  it('flags invalid CIDR and invalid IP', () => {
    const a = dev('a', '10.0.0.0/33');
    const b = dev('b', '999.1.1.1');
    const issues = validate({ devices: [a, b], links: [] });
    expect(issues.some((i) => i.code === 'invalid-cidr')).toBe(true);
    expect(issues.some((i) => i.code === 'invalid-ip')).toBe(true);
  });

  it('flags missing link endpoints', () => {
    const a = dev('a', '10.0.0.1');
    const link = createLink(a.id, 'ghost-id', LAYER);
    const issues = validate({ devices: [a], links: [link] });
    const missing = issues.find((i) => i.code === 'missing-endpoint');
    expect(missing).toBeDefined();
    expect(missing?.objectIds).toEqual([link.id]);
  });

  it('flags duplicate names case-insensitively', () => {
    const a = dev('Core-1');
    const b = dev('core-1');
    const issues = validate({ devices: [a, b], links: [] });
    const dup = issues.find((i) => i.code === 'duplicate-name');
    expect(dup).toBeDefined();
    expect(dup?.objectIds.sort()).toEqual([a.id, b.id].sort());
  });

  it('flags a device with no name', () => {
    const a = dev('   ');
    const issues = validate({ devices: [a], links: [] });
    expect(issues.some((i) => i.code === 'device-no-name')).toBe(true);
  });

  it('flags duplicate VLAN IDs and out-of-range VLANs', () => {
    const issues = validate({
      devices: [],
      links: [],
      vlans: [createVlan(10, 'A'), createVlan(10, 'B'), createVlan(9000, 'Bad')],
    });
    expect(issues.some((i) => i.code === 'duplicate-vlan')).toBe(true);
    expect(issues.some((i) => i.code === 'invalid-vlan-range')).toBe(true);
  });

  it('flags overlapping subnets and missing gateway', () => {
    const issues = validate({
      devices: [],
      links: [],
      subnets: [
        createSubnet('10.0.0.0/16'),
        createSubnet('10.0.1.0/24', { gateway: '10.0.1.1' }),
      ],
    });
    expect(issues.some((i) => i.code === 'overlapping-subnet')).toBe(true);
    expect(issues.some((i) => i.code === 'subnet-no-gateway')).toBe(true); // the /16 has none
  });

  it('flags an IP outside all defined subnets', () => {
    const a = dev('a', '192.168.99.5');
    const issues = validate({
      devices: [a],
      links: [],
      subnets: [createSubnet('10.0.0.0/24', { gateway: '10.0.0.1' })],
    });
    expect(issues.some((i) => i.code === 'ip-outside-subnet')).toBe(true);
  });

  it('does not flag ip-outside-subnet when no subnets are defined', () => {
    const a = dev('a', '192.168.99.5');
    const issues = validate({ devices: [a], links: [] });
    expect(issues.some((i) => i.code === 'ip-outside-subnet')).toBe(false);
  });

  it('flags rack RU collisions and overflow', () => {
    const rack = createRack('R1', 42);
    const a = createDevice('server', 0, 0, LAYER, {
      name: 'srv-a',
      rackId: rack.id,
      ru: 1,
      ruSpan: 2,
    });
    const b = createDevice('server', 0, 0, LAYER, {
      name: 'srv-b',
      rackId: rack.id,
      ru: 2,
      ruSpan: 1,
    }); // overlaps U2
    const c = createDevice('server', 0, 0, LAYER, {
      name: 'srv-c',
      rackId: rack.id,
      ru: 41,
      ruSpan: 4,
    }); // overflows 42U
    const issues = validate({ devices: [a, b, c], links: [], racks: [rack] });
    expect(issues.some((i) => i.code === 'rack-ru-collision')).toBe(true);
    expect(issues.some((i) => i.code === 'rack-ru-overflow')).toBe(true);
  });

  it('flags trunk without VLANs and access with multiple VLANs', () => {
    const a = dev('a');
    const b = dev('b');
    const trunk = createLink(a.id, b.id, LAYER, { mode: 'trunk' });
    const access = createLink(a.id, b.id, LAYER, { mode: 'access', vlan: '10,20,30' });
    const issues = validate({ devices: [a, b], links: [trunk, access] });
    expect(issues.some((i) => i.code === 'trunk-missing-vlan')).toBe(true);
    expect(issues.some((i) => i.code === 'access-multi-vlan')).toBe(true);
  });

  it('flags orphaned devices', () => {
    const a = dev('a');
    const b = dev('b');
    const c = dev('c');
    const issues = validate({
      devices: [a, b, c],
      links: [createLink(a.id, b.id, LAYER)],
    });
    const orphan = issues.find((i) => i.code === 'orphaned-device');
    expect(orphan?.objectIds).toEqual([c.id]);
  });

  it('is deterministic across runs', () => {
    const a = dev('a', '10.0.0.1');
    const b = dev('b', '10.0.0.1');
    resetIssueIds();
    const first = validate({ devices: [a, b], links: [] });
    resetIssueIds();
    const second = validate({ devices: [a, b], links: [] });
    expect(first).toEqual(second);
  });
});

describe('validate — first-class interfaces (schema v2)', () => {
  it('flags a link referencing an interface that does not exist on its device', () => {
    const a = createDevice('switch', 0, 0, LAYER, { name: 'SW1', interfaces: [] });
    const b = createDevice('server', 0, 0, LAYER, { name: 'Web1', interfaces: [] });
    const link = createLink(a.id, b.id, LAYER, { sourceIfaceId: 'ghost' });
    const issues = validate({ devices: [a, b], links: [link] });
    expect(issues.some((i) => i.code === 'dangling-interface')).toBe(true);
  });

  it('flags an over-subscribed interface (one port, two links)', () => {
    const a = createDevice('switch', 0, 0, LAYER, {
      name: 'SW1',
      interfaces: [{ id: 'i1', name: 'Gi0/1' }],
    });
    const b = createDevice('server', 0, 0, LAYER, { name: 'Web1', interfaces: [] });
    const c = createDevice('server', 0, 0, LAYER, { name: 'Web2', interfaces: [] });
    const l1 = createLink(a.id, b.id, LAYER, { sourceIfaceId: 'i1' });
    const l2 = createLink(a.id, c.id, LAYER, { sourceIfaceId: 'i1' });
    const issues = validate({ devices: [a, b, c], links: [l1, l2] });
    expect(issues.some((i) => i.code === 'oversubscribed-interface')).toBe(true);
  });

  it('accepts a valid single interface reference', () => {
    const a = createDevice('switch', 0, 0, LAYER, {
      name: 'SW1',
      interfaces: [{ id: 'i1', name: 'Gi0/1' }],
    });
    const b = createDevice('server', 0, 0, LAYER, { name: 'Web1', interfaces: [] });
    const link = createLink(a.id, b.id, LAYER, { sourceIfaceId: 'i1' });
    const issues = validate({ devices: [a, b], links: [link] });
    expect(issues.some((i) => i.code === 'dangling-interface')).toBe(false);
    expect(issues.some((i) => i.code === 'oversubscribed-interface')).toBe(false);
  });
});

describe('validate — per-port IP addresses (schema v5)', () => {
  const withPort = (name: string, ip?: string, mgmt?: string): Device =>
    createDevice('switch', 0, 0, LAYER, {
      name,
      managementIp: mgmt,
      interfaces: [{ id: `${name}-i1`, name: 'Gi0/1', ip }],
    });

  it('flags a duplicate IP shared between a port and a device management IP', () => {
    const a = createDevice('router', 0, 0, LAYER, { name: 'R1', managementIp: '10.0.0.1' });
    const b = withPort('SW1', '10.0.0.1'); // port clashes with R1's mgmt IP
    const dup = validate({ devices: [a, b], links: [] }).find((i) => i.code === 'duplicate-ip');
    expect(dup).toBeDefined();
    expect(dup?.objectIds.sort()).toEqual([a.id, b.id].sort());
  });

  it('flags a duplicate IP shared between two ports', () => {
    const a = withPort('SW1', '10.0.0.9');
    const b = withPort('SW2', '10.0.0.9');
    expect(validate({ devices: [a, b], links: [] }).some((i) => i.code === 'duplicate-ip')).toBe(true);
  });

  it('flags an invalid port IP', () => {
    const a = withPort('SW1', '10.0.0.999');
    expect(validate({ devices: [a], links: [] }).some((i) => i.code === 'invalid-ip')).toBe(true);
  });

  it('flags a port IP that sits outside every defined subnet', () => {
    const a = withPort('SW1', '192.168.9.9');
    const issues = validate({ devices: [a], links: [], subnets: [createSubnet('10.0.0.0/24')] });
    expect(issues.some((i) => i.code === 'ip-outside-subnet')).toBe(true);
  });

  it('accepts a valid, in-subnet, unique port IP', () => {
    const a = withPort('SW1', '10.0.0.5', '10.0.0.1');
    const issues = validate({ devices: [a], links: [], subnets: [createSubnet('10.0.0.0/24')] });
    expect(issues.some((i) => ['duplicate-ip', 'invalid-ip', 'ip-outside-subnet'].includes(i.code))).toBe(
      false,
    );
  });

  it('ignores interfaces with no IP (unaddressed ports are fine)', () => {
    const a = createDevice('switch', 0, 0, LAYER, {
      name: 'SW1',
      interfaces: [{ id: 'i1', name: 'Gi0/1' }, { id: 'i2', name: 'Gi0/2' }],
    });
    expect(validate({ devices: [a], links: [] })).toEqual([]);
  });
});

describe('validate — IPv6 addresses (#30)', () => {
  const v6 = (name: string, mgmt: string, port?: string): Device =>
    createDevice('router', 0, 0, LAYER, {
      name,
      managementIp: mgmt,
      interfaces: port ? [{ id: `${name}-i1`, name: 'Gi0/1', ip: port }] : [],
    });
  const codes = (devices: Device[]) => validate({ devices, links: [] }).map((i) => i.code);

  it.each([':', '1:2', '1:2:3:4:5:6:7', '1::2:3:4:5:6:7:8', '2001:db8:::1'])(
    'flags malformed IPv6 %s as an invalid IP',
    (ip) => {
      expect(codes([v6('R1', ip)])).toContain('invalid-ip');
    },
  );

  it.each(['2001:db8::1', '::1', '::ffff:192.0.2.1', 'fe80::1ff:fe23:4567:890a'])(
    'accepts well-formed IPv6 %s',
    (ip) => {
      expect(codes([v6('R1', ip)])).toEqual([]);
    },
  );

  it('accepts an IPv6 address with a /0–128 prefix and rejects a bad one', () => {
    expect(codes([v6('R1', '2001:db8::1/64')])).toEqual([]);
    expect(codes([v6('R1', '2001:db8::1/128')])).toEqual([]);
    expect(codes([v6('R1', '2001:db8::1/129')])).toEqual(['invalid-cidr']);
    expect(codes([v6('R1', '1:2/64')])).toEqual(['invalid-cidr']);
  });

  it.each([
    ['2001:db8::1', '2001:0db8:0:0:0:0:0:1'],
    ['2001:db8::1', '2001:DB8::1'],
    ['2001:db8::1/64', '2001:db8:0::1'],
    ['::ffff:192.0.2.1', '::ffff:c000:201'],
  ])('treats %s and %s as one address', (x, y) => {
    const a = v6('R1', x);
    const b = v6('R2', y);
    const dup = validate({ devices: [a, b], links: [] }).find((i) => i.code === 'duplicate-ip');
    expect(dup?.objectIds.sort()).toEqual([a.id, b.id].sort());
    expect(dup?.address).toBe(x.replace('/64', ''));
    expect(dup?.message).toBe(`IP ${x.replace('/64', '')} is assigned to 2 interfaces.`);
  });

  it('finds an equivalent duplicate between a port and another device', () => {
    const a = v6('R1', '10.0.0.1', '2001:db8::a');
    const b = v6('R2', '2001:0db8::000a');
    const dup = validate({ devices: [a, b], links: [] }).find((i) => i.code === 'duplicate-ip');
    expect(dup?.objectIds.sort()).toEqual([a.id, b.id].sort());
  });

  it('does not conflate an IPv4 address with its IPv4-mapped IPv6 form', () => {
    expect(codes([v6('R1', '192.0.2.1'), v6('R2', '::ffff:192.0.2.1')])).not.toContain('duplicate-ip');
  });

  it('names an IPv6 subnet as unsupported instead of calling it invalid', () => {
    const sn = createSubnet('2001:db8::/64');
    const issues = validate({ devices: [], links: [], subnets: [sn] });
    expect(issues.map((i) => [i.code, i.severity, i.objectIds])).toEqual([
      ['ipv6-subnet-unsupported', 'info', [sn.id]],
    ]);
    // A malformed IPv6-looking CIDR is still just invalid.
    expect(validate({ devices: [], links: [], subnets: [createSubnet('1:2/64')] })[0]?.code).toBe(
      'invalid-subnet-cidr',
    );
  });
});

describe('validate — subnet gateways (#31)', () => {
  const gw = (cidr: string, gateway?: string) => {
    const sn = createSubnet(cidr, { gateway });
    return { sn, issues: validate({ devices: [], links: [], subnets: [sn] }) };
  };

  it.each([
    ['10.0.0.0/24', '10.0.0.1'],
    ['10.0.0.0/24', '10.0.0.254'],
    ['10.0.0.0/24', '10.0.0.1/24'], // a prefix on the gateway is tolerated
    ['10.0.0.0/30', '10.0.0.2'],
    ['10.0.0.0/31', '10.0.0.0'], // RFC 3021: both /31 addresses are hosts
    ['10.0.0.0/31', '10.0.0.1'],
    ['10.0.0.7/32', '10.0.0.7'], // a /32's only address
    ['10.0.0.5/24', '10.0.0.1'], // an unmasked CIDR still names 10.0.0.0/24
  ])('accepts %s with gateway %s', (cidr, g) => {
    expect(gw(cidr, g).issues).toEqual([]);
  });

  it('keeps the missing-gateway finding for an empty gateway', () => {
    expect(gw('10.0.0.0/24').issues.map((i) => i.code)).toEqual(['subnet-no-gateway']);
    expect(gw('10.0.0.0/24', '   ').issues.map((i) => i.code)).toEqual(['subnet-no-gateway']);
  });

  it.each(['router', '10.0.0.256', '2001:db8::1'])('flags malformed gateway %s', (g) => {
    const { sn, issues } = gw('10.0.0.0/24', g);
    expect(issues).toEqual([
      {
        id: expect.any(String),
        severity: 'error',
        code: 'subnet-gateway-invalid',
        message: `Gateway "${g}" on 10.0.0.0/24 is not an IPv4 address — use a host in 10.0.0.1–10.0.0.254.`,
        objectIds: [sn.id],
      },
    ]);
  });

  it('flags a gateway outside its subnet', () => {
    const { sn, issues } = gw('10.0.0.0/24', '192.0.2.1');
    expect(issues).toEqual([
      {
        id: expect.any(String),
        severity: 'warn',
        code: 'subnet-gateway-outside',
        message: 'Gateway 192.0.2.1 is outside 10.0.0.0/24 — use a host in 10.0.0.1–10.0.0.254.',
        objectIds: [sn.id],
      },
    ]);
    // A neighbouring /31 address and a /32 that isn't its own address are both off-subnet.
    expect(gw('10.0.0.0/31', '10.0.0.2').issues[0]?.code).toBe('subnet-gateway-outside');
    expect(gw('10.0.0.7/32', '10.0.0.8').issues[0]?.message).toBe(
      'Gateway 10.0.0.8 is outside 10.0.0.7/32 — use 10.0.0.7.',
    );
  });

  it('flags the network and broadcast addresses as unusable gateways', () => {
    expect(gw('10.0.0.0/24', '10.0.0.0').issues.map((i) => [i.code, i.severity, i.message])).toEqual([
      [
        'subnet-gateway-unusable',
        'warn',
        'Gateway 10.0.0.0 is the network address of 10.0.0.0/24 — use a host in 10.0.0.1–10.0.0.254.',
      ],
    ]);
    expect(gw('10.0.0.0/30', '10.0.0.3').issues.map((i) => i.message)).toEqual([
      'Gateway 10.0.0.3 is the broadcast address of 10.0.0.0/30 — use a host in 10.0.0.1–10.0.0.2.',
    ]);
  });

  it('does not judge the gateway of an invalid subnet', () => {
    expect(gw('10.0.0.0/33', 'router').issues.map((i) => i.code)).toEqual(['invalid-subnet-cidr']);
  });
});

describe('validate — subnet overlap at scale (#43)', () => {
  /** The original pairwise rule, kept as the reference the sweep must match exactly. */
  function naiveOverlaps(subnets: Subnet[]) {
    const out: string[] = [];
    for (let i = 0; i < subnets.length; i++) {
      for (let j = i + 1; j < subnets.length; j++) {
        const a = subnets[i]!;
        const b = subnets[j]!;
        if (isValidCidr(a.cidr) && isValidCidr(b.cidr) && cidrsOverlap(a.cidr, b.cidr)) {
          out.push(`Subnets ${a.cidr} and ${b.cidr} overlap.|${a.id},${b.id}`);
        }
      }
    }
    return out;
  }
  const overlaps = (subnets: Subnet[]) =>
    validate({ devices: [], links: [], subnets })
      .filter((i) => i.code === 'overlapping-subnet')
      .map((i) => `${i.message}|${i.objectIds.join(',')}`);

  it('reports every nested, duplicate and same-network overlap, in the original order', () => {
    const subnets = [
      createSubnet('10.0.0.0/8'),
      createSubnet('10.1.0.0/16'),
      createSubnet('10.1.2.0/24'),
      createSubnet('10.1.2.0/24'), // duplicate
      createSubnet('10.1.2.5/24'), // same network, unmasked text
      createSubnet('192.168.0.0/24'),
      createSubnet('not a cidr'),
      createSubnet('10.1.2.128/25'),
      createSubnet('0.0.0.0/0'), // overlaps everything valid
      createSubnet('192.168.1.0/24'),
      createSubnet('10.1.2.0/32'),
    ];
    expect(overlaps(subnets)).toEqual(naiveOverlaps(subnets));
    expect(overlaps(subnets).length).toBeGreaterThan(20);
  });

  it('matches the pairwise rule on random plans', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let round = 0; round < 25; round++) {
      const subnets = Array.from({ length: 60 }, () =>
        createSubnet(`10.${rnd(4)}.${rnd(8)}.${rnd(4) * 64}/${[8, 16, 22, 24, 26, 30, 32][rnd(7)]}`),
      );
      expect(overlaps(subnets)).toEqual(naiveOverlaps(subnets));
    }
  });

  it('re-validates an unchanged plan to the same findings with fresh ids', () => {
    const subnets = [createSubnet('10.0.0.0/16'), createSubnet('10.0.1.0/24', { gateway: 'x' })];
    resetIssueIds();
    const first = validate({ devices: [], links: [], subnets });
    resetIssueIds();
    const again = validate({ devices: [], links: [], subnets: [...subnets] });
    expect(again).toEqual(first);
    // Editing a subnet in place (same object, new text) is never served stale.
    subnets[1]!.gateway = '10.0.1.1';
    expect(validate({ devices: [], links: [], subnets }).map((i) => i.code)).toEqual([
      'subnet-no-gateway',
      'overlapping-subnet',
    ]);
  });

  it('places addresses with the same verdict as the per-subnet membership test', () => {
    const subnets = [
      createSubnet('10.0.0.0/24'),
      createSubnet('10.0.0.128/25'),
      createSubnet('172.16.0.0/12'),
      createSubnet('bogus'),
    ];
    const ips = ['10.0.0.1', '10.0.0.200', '10.0.1.1', '172.31.255.255', '172.32.0.0', '9.255.255.255'];
    const devices = ips.map((ip) => dev(ip, ip));
    const outside = validate({ devices, links: [], subnets })
      .filter((i) => i.code === 'ip-outside-subnet')
      .map((i) => i.message.split(' ')[0]);
    expect(outside).toEqual(ips.filter((ip) => !subnets.some((s) => ipInCidr(ip, s.cidr))));
  });
});
