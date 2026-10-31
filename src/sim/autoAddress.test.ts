import { describe, it, expect } from 'vitest';
import {
  planAddresses,
  planGateways,
  planDeduplicateIps,
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
});
