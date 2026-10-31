import { describe, it, expect } from 'vitest';
import { planSegment, nextFreeSubnetCidr } from './segment';
import { createDevice } from '@/model/schema';
import type { Device, DeviceType } from '@/model/types';

const L = 'layer';
const dev = (type: DeviceType, name: string, ip?: string): Device =>
  createDevice(type, 0, 0, L, { name, managementIp: ip });

describe('nextFreeSubnetCidr', () => {
  it('starts at 10.0.0.0/24 when nothing exists', () => {
    expect(nextFreeSubnetCidr([])).toBe('10.0.0.0/24');
  });

  it('skips a /24 that an existing subnet already occupies', () => {
    expect(nextFreeSubnetCidr([{ cidr: '10.0.0.0/24' }])).toBe('10.0.1.0/24');
  });

  it('skips every /24 a broader existing subnet covers', () => {
    // A /16 covers 10.0.0.0/24 … 10.0.255.0/24, so the next free block is in 10.1.
    expect(nextFreeSubnetCidr([{ cidr: '10.0.0.0/16' }])).toBe('10.1.0.0/24');
  });

  it('avoids a block that already holds an in-use address', () => {
    expect(nextFreeSubnetCidr([], ['10.0.0.50'])).toBe('10.0.1.0/24');
  });
});

describe('planSegment', () => {
  it('carves a fresh /24 and addresses unaddressed members from .1', () => {
    const devices = [dev('server', 'A'), dev('server', 'B'), dev('server', 'C')];
    const plan = planSegment(devices, [])!;
    expect(plan).not.toBeNull();
    expect(plan.cidr).toBe('10.0.0.0/24');
    expect(plan.assignments.map((a) => a.ip)).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  });

  it('lands in the next free block when a subnet already exists', () => {
    const plan = planSegment([dev('server', 'A')], [{ cidr: '10.0.0.0/24' }])!;
    expect(plan.cidr).toBe('10.0.1.0/24');
    expect(plan.assignments[0]!.ip).toBe('10.0.1.1');
  });

  it('skips non-addressable members (ISP) and already-addressed ones', () => {
    const isp = dev('isp', 'Internet');
    const addressed = dev('server', 'Has IP', '192.168.9.9');
    const fresh = dev('server', 'Fresh');
    const plan = planSegment([isp, addressed, fresh], [])!;
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]!.deviceId).toBe(fresh.id);
  });

  it('returns null when nothing in the selection needs an address', () => {
    expect(planSegment([dev('isp', 'Internet')], [])).toBeNull();
    expect(planSegment([dev('server', 'A', '10.9.9.9')], [])).toBeNull();
    expect(planSegment([], [])).toBeNull();
  });

  it('adopts a single router/firewall as the gateway, addressing it .1', () => {
    const a = dev('server', 'A');
    const r = dev('router', 'R');
    const b = dev('server', 'B');
    // Router is not first in the selection — it still takes the lowest host.
    const plan = planSegment([a, r, b], [])!;
    expect(plan.gateway).toBe('10.0.0.1');
    expect(plan.assignments.find((x) => x.deviceId === r.id)!.ip).toBe('10.0.0.1');
    expect(plan.assignments.map((x) => x.ip).sort()).toEqual([
      '10.0.0.1',
      '10.0.0.2',
      '10.0.0.3',
    ]);
  });

  it('records no gateway for a pure-host segment or an ambiguous one', () => {
    expect(planSegment([dev('server', 'A'), dev('server', 'B')], [])!.gateway).toBeNull();
    // Two routers → ambiguous, no gateway picked.
    const two = planSegment([dev('router', 'R1'), dev('router', 'R2'), dev('server', 'S')], [])!;
    expect(two.gateway).toBeNull();
  });

  it('does not collide with an existing in-use address in the picked block', () => {
    // A device sits at 10.0.0.5 with no declaring subnet; the segment must avoid
    // that whole /24 rather than hand .5 to someone else.
    const plan = planSegment([dev('server', 'Fresh')], [], ['10.0.0.5'])!;
    expect(plan.cidr).toBe('10.0.1.0/24');
    expect(plan.assignments[0]!.ip).toBe('10.0.1.1');
  });
});
