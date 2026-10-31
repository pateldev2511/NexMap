import { describe, it, expect } from 'vitest';
import {
  planAddresses,
  planGateways,
  planDeduplicateIps,
  planCoveringSubnets,
  planInterfaceAddresses,
  isAddressable,
  DEFAULT_SUBNET_CIDR,
} from './autoAddress';
import { createDevice, createSubnet } from '@/model/schema';
import type { Device, DeviceType } from '@/model/types';

/** Lowest device id, matching planDeduplicateIps' "who keeps the address" rule. */
const lowestId = (ds: Device[]) => [...ds].sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;

const L = 'layer';
const dev = (type: DeviceType, name: string, ip?: string): Device =>
  createDevice(type, 0, 0, L, { name, managementIp: ip });

describe('isAddressable', () => {
  it('hosts are addressable, external/abstract/physical nodes are not', () => {
    expect(isAddressable('server')).toBe(true);
    expect(isAddressable('switch')).toBe(true);
    expect(isAddressable('firewall')).toBe(true);
    expect(isAddressable('isp')).toBe(false);
    expect(isAddressable('cloud')).toBe(false);
    expect(isAddressable('rack')).toBe(false);
    expect(isAddressable('ups')).toBe(false);
  });
});

describe('planAddresses', () => {
  it('synthesizes a default /24 and assigns lowest-free hosts when no subnet exists', () => {
    const devices = [dev('router', 'R'), dev('server', 'S'), dev('end-user', 'PC')];
    const plan = planAddresses(devices, []);
    expect(plan.createdSubnetCidr).toBe(DEFAULT_SUBNET_CIDR);
    expect(plan.assignments.map((a) => a.ip)).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
    expect(plan.unassigned).toEqual([]);
  });

  it('skips non-addressable types (ISP / cloud) entirely', () => {
    const isp = dev('isp', 'ISP');
    const srv = dev('server', 'SRV');
    const plan = planAddresses([isp, srv], []);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]!.deviceId).toBe(srv.id);
  });

  it('never overwrites an existing IP and never collides with one', () => {
    const a = dev('server', 'A', '10.0.0.5');
    const b = dev('server', 'B'); // unaddressed
    const plan = planAddresses([a, b], [createSubnet('10.0.0.0/24')]);
    // A is left alone; B gets the lowest free host that isn't .5
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]!.deviceId).toBe(b.id);
    expect(plan.assignments[0]!.ip).toBe('10.0.0.1');
  });

  it('respects the subnet gateway (never hands it out)', () => {
    const b = dev('server', 'B');
    const plan = planAddresses([b], [createSubnet('10.0.0.0/24', { gateway: '10.0.0.1' })]);
    expect(plan.assignments[0]!.ip).toBe('10.0.0.2'); // .1 is the gateway
  });

  it('flows into the next subnet when the first is exhausted', () => {
    // A /30 has two usable hosts (.1, .2). Three devices → third spills to the /24.
    const subnets = [createSubnet('192.168.1.0/30'), createSubnet('10.0.0.0/24')];
    const devices = [dev('server', 'A'), dev('server', 'B'), dev('server', 'C')];
    const plan = planAddresses(devices, subnets);
    const ips = plan.assignments.map((a) => a.ip);
    expect(ips).toEqual(['192.168.1.1', '192.168.1.2', '10.0.0.1']);
    expect(plan.unassigned).toEqual([]);
  });

  it('reports devices it could not place when every subnet is full', () => {
    const subnets = [createSubnet('192.168.1.0/30')]; // 2 hosts only
    const devices = [dev('server', 'A'), dev('server', 'B'), dev('server', 'C')];
    const plan = planAddresses(devices, subnets);
    expect(plan.assignments).toHaveLength(2);
    expect(plan.unassigned).toEqual([devices[2]!.id]);
    expect(plan.createdSubnetCidr).toBeNull(); // a subnet existed; don't invent one
  });

  it('scopes to onlyIds when given', () => {
    const a = dev('server', 'A');
    const b = dev('server', 'B');
    const plan = planAddresses([a, b], [], { onlyIds: new Set([b.id]) });
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]!.deviceId).toBe(b.id);
  });

  it('adopts a single router/firewall as the created subnet gateway (.1)', () => {
    const s = dev('server', 'S');
    const r = dev('router', 'R');
    // Router is not first in the list — it still takes the lowest host.
    const plan = planAddresses([s, r], []);
    expect(plan.createdSubnetCidr).toBe(DEFAULT_SUBNET_CIDR);
    expect(plan.createdSubnetGateway).toBe('10.0.0.1');
    expect(plan.assignments.find((a) => a.deviceId === r.id)!.ip).toBe('10.0.0.1');
  });

  it('records no created-subnet gateway without a single L3 device', () => {
    const plan = planAddresses([dev('server', 'A'), dev('server', 'B')], []);
    expect(plan.createdSubnetGateway).toBeNull();
  });

  it('is a no-op (no subnet invented) when nothing needs addressing', () => {
    const a = dev('server', 'A', '10.0.0.9');
    const plan = planAddresses([a], []);
    expect(plan.assignments).toEqual([]);
    expect(plan.createdSubnetCidr).toBeNull();
  });
});

describe('planGateways', () => {
  it('adopts the one in-CIDR router as a gateway-less subnet gateway', () => {
    const sub = createSubnet('10.0.0.0/24'); // no gateway
    const r = dev('router', 'R', '10.0.0.1');
    const srv = dev('server', 'S', '10.0.0.5');
    const plan = planGateways([sub], [r, srv]);
    expect(plan).toEqual([{ subnetId: sub.id, gateway: '10.0.0.1' }]);
  });

  it('accepts a router IP written with a prefix', () => {
    const sub = createSubnet('10.0.0.0/24');
    const r = dev('firewall', 'FW', '10.0.0.1/24');
    expect(planGateways([sub], [r])).toEqual([{ subnetId: sub.id, gateway: '10.0.0.1' }]);
  });

  it('never overwrites a subnet that already has a gateway', () => {
    const sub = createSubnet('10.0.0.0/24', { gateway: '10.0.0.254' });
    const r = dev('router', 'R', '10.0.0.1');
    expect(planGateways([sub], [r])).toEqual([]);
  });

  it('leaves a subnet alone when zero or several L3 devices sit inside it', () => {
    const sub = createSubnet('10.0.0.0/24');
    // zero L3 in-CIDR (only a server)
    expect(planGateways([sub], [dev('server', 'S', '10.0.0.5')])).toEqual([]);
    // two routers in-CIDR → ambiguous
    const r1 = dev('router', 'R1', '10.0.0.1');
    const r2 = dev('router', 'R2', '10.0.0.2');
    expect(planGateways([sub], [r1, r2])).toEqual([]);
  });

  it('matches each subnet to the router that falls within it', () => {
    const a = createSubnet('10.0.0.0/24');
    const b = createSubnet('10.0.1.0/24');
    const ra = dev('router', 'RA', '10.0.0.1');
    const rb = dev('firewall', 'RB', '10.0.1.1');
    const plan = planGateways([a, b], [ra, rb]);
    expect(plan).toEqual([
      { subnetId: a.id, gateway: '10.0.0.1' },
      { subnetId: b.id, gateway: '10.0.1.1' },
    ]);
  });
});

describe('planDeduplicateIps', () => {
  it('keeps the lowest-id device and re-addresses the rest to free hosts', () => {
    const a = dev('server', 'A', '10.0.0.5');
    const b = dev('server', 'B', '10.0.0.5');
    const plan = planDeduplicateIps([a, b], [createSubnet('10.0.0.0/24')]);
    const keeper = lowestId([a, b]);
    const moved = a.id === keeper.id ? b : a;
    // Exactly one device moves — the higher-id one — to the lowest free host (.1).
    expect(plan).toEqual([{ deviceId: moved.id, ip: '10.0.0.1' }]);
  });

  it('skips the gateway and already-used hosts when re-homing', () => {
    const a = dev('server', 'A', '10.0.0.5');
    const b = dev('server', 'B', '10.0.0.5');
    const c = dev('server', 'C', '10.0.0.2'); // occupies .2
    const sub = createSubnet('10.0.0.0/24', { gateway: '10.0.0.1' });
    const plan = planDeduplicateIps([a, b, c], [sub]);
    // The mover skips .1 (gateway), .2 (used by C), .5 (the clash) → lands on .3.
    expect(plan).toHaveLength(1);
    expect(plan[0]!.ip).toBe('10.0.0.3');
  });

  it('re-addresses two of three devices sharing an address, to distinct hosts', () => {
    const a = dev('server', 'A', '10.0.0.5');
    const b = dev('server', 'B', '10.0.0.5');
    const c = dev('server', 'C', '10.0.0.5');
    const plan = planDeduplicateIps([a, b, c], [createSubnet('10.0.0.0/24')]);
    expect(plan).toHaveLength(2);
    const ips = plan.map((p) => p.ip);
    expect(new Set(ips).size).toBe(2); // distinct
    expect(ips).not.toContain('10.0.0.5'); // never re-uses the clash
    // The lowest-id device keeps .5 (is not moved).
    expect(plan.some((p) => p.deviceId === lowestId([a, b, c]).id)).toBe(false);
  });

  it('leaves a clash alone when its address is in no defined subnet', () => {
    const a = dev('server', 'A', '192.168.9.9');
    const b = dev('server', 'B', '192.168.9.9');
    // Only an unrelated subnet exists — no range to re-home into.
    expect(planDeduplicateIps([a, b], [createSubnet('10.0.0.0/24')])).toEqual([]);
  });

  it('is a no-op when no address is shared', () => {
    const a = dev('server', 'A', '10.0.0.5');
    const b = dev('server', 'B', '10.0.0.6');
    expect(planDeduplicateIps([a, b], [createSubnet('10.0.0.0/24')])).toEqual([]);
  });

  it('resolves a clash between two ports, re-homing the later one', () => {
    const a = createDevice('switch', 0, 0, L, { name: 'A', interfaces: [{ id: 'a1', name: 'p', ip: '10.0.0.9' }] });
    const b = createDevice('switch', 0, 0, L, { name: 'B', interfaces: [{ id: 'b1', name: 'p', ip: '10.0.0.9' }] });
    const plan = planDeduplicateIps([a, b], [createSubnet('10.0.0.0/24')]);
    const keeper = lowestId([a, b]);
    const moved = keeper.id === a.id ? b : a;
    expect(plan).toEqual([
      { deviceId: moved.id, ifaceId: moved.id === a.id ? 'a1' : 'b1', ip: '10.0.0.1' },
    ]);
  });

  it('keeps the management IP over a port clash within one address', () => {
    const a = createDevice('switch', 0, 0, L, { name: 'A', managementIp: '10.0.0.5' });
    const b = createDevice('server', 0, 0, L, { name: 'B', interfaces: [{ id: 'b1', name: 'p', ip: '10.0.0.5' }] });
    const plan = planDeduplicateIps([a, b], [createSubnet('10.0.0.0/24')]);
    // Lowest device id keeps its address; the other slot moves to the lowest free host.
    const expected =
      lowestId([a, b]).id === a.id
        ? { deviceId: b.id, ifaceId: 'b1', ip: '10.0.0.1' } // a's mgmt kept, b's port moved
        : { deviceId: a.id, ip: '10.0.0.1' }; //              b's port kept, a's mgmt moved
    expect(plan).toEqual([expected]);
  });
});

describe('planCoveringSubnets', () => {
  it('draws the natural /24 for an address that sits outside every subnet', () => {
    // 192.168.9.9 is outside the only defined range (10.0.0.0/24).
    const d = dev('server', 'S', '192.168.9.9');
    const plan = planCoveringSubnets([d], [createSubnet('10.0.0.0/24')]);
    expect(plan).toEqual([{ cidr: '192.168.9.0/24', ips: ['192.168.9.9'] }]);
  });

  it('covers several orphans sharing a /24 with one subnet', () => {
    const a = dev('server', 'A', '192.168.9.9');
    const b = dev('server', 'B', '192.168.9.40');
    const plan = planCoveringSubnets([a, b], [createSubnet('10.0.0.0/24')]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.cidr).toBe('192.168.9.0/24');
    expect(plan[0]!.ips).toEqual(['192.168.9.40', '192.168.9.9']); // sorted (string)
  });

  it('proposes one subnet per distinct /24', () => {
    const a = dev('server', 'A', '192.168.9.9');
    const b = dev('server', 'B', '172.16.4.2');
    const plan = planCoveringSubnets([a, b], [createSubnet('10.0.0.0/24')]);
    expect(plan.map((p) => p.cidr)).toEqual(['172.16.4.0/24', '192.168.9.0/24']);
  });

  it('refuses a /24 that would overlap an existing subnet, leaving the address flagged', () => {
    // 192.168.9.9 is outside 192.168.9.128/25, but its /24 would swallow that /25.
    const d = dev('server', 'S', '192.168.9.9');
    expect(planCoveringSubnets([d], [createSubnet('192.168.9.128/25')])).toEqual([]);
  });

  it('does nothing when no subnets exist (not a flagged case — auto-address owns it)', () => {
    const d = dev('server', 'S', '192.168.9.9');
    expect(planCoveringSubnets([d], [])).toEqual([]);
  });

  it('ignores addresses already inside a subnet, and unaddressed / non-IPv4 devices', () => {
    const inside = dev('server', 'A', '10.0.0.5');
    const blank = dev('server', 'B');
    const isp = dev('isp', 'ISP');
    expect(planCoveringSubnets([inside, blank, isp], [createSubnet('10.0.0.0/24')])).toEqual([]);
  });

  it('covers a port IP that sits outside every subnet', () => {
    const a = createDevice('switch', 0, 0, L, {
      name: 'A',
      managementIp: '10.0.0.1',
      interfaces: [{ id: 'a1', name: 'p', ip: '192.168.4.4' }],
    });
    const plan = planCoveringSubnets([a], [createSubnet('10.0.0.0/24')]);
    expect(plan).toEqual([{ cidr: '192.168.4.0/24', ips: ['192.168.4.4'] }]);
  });
});

describe('planInterfaceAddresses', () => {
  const withIfaces = (
    name: string,
    mgmt: string | undefined,
    ifaces: { id: string; name: string; ip?: string }[],
  ): Device => createDevice('switch', 0, 0, L, { name, managementIp: mgmt, interfaces: ifaces });

  it('addresses a device’s unaddressed ports from its management subnet', () => {
    const d = withIfaces('SW1', '10.0.0.1', [
      { id: 'i1', name: 'Gi0/1' },
      { id: 'i2', name: 'Gi0/2' },
    ]);
    const plan = planInterfaceAddresses([d], [createSubnet('10.0.0.0/24')]);
    // .1 is the device's mgmt IP (in use) → ports take .2, .3.
    expect(plan).toEqual([
      { deviceId: d.id, ifaceId: 'i1', ip: '10.0.0.2' },
      { deviceId: d.id, ifaceId: 'i2', ip: '10.0.0.3' },
    ]);
  });

  it('skips a device with no management IP (won’t guess the ports’ subnet)', () => {
    const d = withIfaces('SW1', undefined, [{ id: 'i1', name: 'Gi0/1' }]);
    expect(planInterfaceAddresses([d], [createSubnet('10.0.0.0/24')])).toEqual([]);
  });

  it('skips a device whose management IP sits outside every subnet', () => {
    const d = withIfaces('SW1', '192.168.9.1', [{ id: 'i1', name: 'Gi0/1' }]);
    expect(planInterfaceAddresses([d], [createSubnet('10.0.0.0/24')])).toEqual([]);
  });

  it('never overwrites an existing port IP, and never reuses it', () => {
    const d = withIfaces('SW1', '10.0.0.1', [
      { id: 'i1', name: 'Gi0/1', ip: '10.0.0.50' },
      { id: 'i2', name: 'Gi0/2' },
    ]);
    const plan = planInterfaceAddresses([d], [createSubnet('10.0.0.0/24')]);
    // i1 is left alone; i2 gets .2 (not .50, which is in use).
    expect(plan).toEqual([{ deviceId: d.id, ifaceId: 'i2', ip: '10.0.0.2' }]);
  });

  it('skips the subnet gateway and addresses already in use', () => {
    const d = withIfaces('SW1', '10.0.0.2', [{ id: 'i1', name: 'Gi0/1' }]);
    const plan = planInterfaceAddresses([d], [createSubnet('10.0.0.0/24', { gateway: '10.0.0.1' })]);
    // .1 is the gateway, .2 is the mgmt IP → port lands on .3.
    expect(plan).toEqual([{ deviceId: d.id, ifaceId: 'i1', ip: '10.0.0.3' }]);
  });

  it('addresses each device from its own management subnet', () => {
    const a = withIfaces('A', '10.0.0.1', [{ id: 'a1', name: 'p1' }]);
    const b = withIfaces('B', '10.0.1.1', [{ id: 'b1', name: 'p1' }]);
    const plan = planInterfaceAddresses(
      [a, b],
      [createSubnet('10.0.0.0/24'), createSubnet('10.0.1.0/24')],
    );
    const ipFor = (ifaceId: string) => plan.find((p) => p.ifaceId === ifaceId)!.ip;
    expect(ipFor('a1')).toBe('10.0.0.2');
    expect(ipFor('b1')).toBe('10.0.1.2');
  });
});
