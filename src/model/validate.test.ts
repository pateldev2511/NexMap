import { describe, it, expect, beforeEach } from 'vitest';
import { validate, resetIssueIds } from './validate';
import { createDevice, createLink, createVlan, createSubnet, createRack } from './schema';
import type { Device } from './types';

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
