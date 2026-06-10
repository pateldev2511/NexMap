import { describe, it, expect } from 'vitest';
import {
  cableTouchesDevice,
  cableUsesPort,
  pruneCablesForDevice,
  pruneCablesForInterfaces,
  isPortCabled,
  isSelfCable,
  checkConnect,
} from './rackCables';
import type { RackCable } from '@/model/types';

const cable = (a: [string, string], b: [string, string], id = a.join() + b.join()): RackCable => ({
  id,
  aEnd: { deviceId: a[0], ifaceId: a[1] },
  bEnd: { deviceId: b[0], ifaceId: b[1] },
  color: '#22d3ee',
});

const cables: RackCable[] = [
  cable(['sw', 'p1'], ['patch', 'k1']),
  cable(['sw', 'p2'], ['srv', 'nic0']),
  cable(['fw', 'wan'], ['patch', 'k24']),
];

describe('cableTouchesDevice / cableUsesPort', () => {
  it('detects a device on either end', () => {
    expect(cableTouchesDevice(cables[0]!, 'sw')).toBe(true);
    expect(cableTouchesDevice(cables[0]!, 'patch')).toBe(true);
    expect(cableTouchesDevice(cables[0]!, 'srv')).toBe(false);
  });
  it('detects a specific port', () => {
    expect(cableUsesPort(cables[1]!, 'srv', 'nic0')).toBe(true);
    expect(cableUsesPort(cables[1]!, 'srv', 'nic1')).toBe(false);
  });
});

describe('pruneCablesForDevice — CRITICAL cascade', () => {
  it('drops every cable touching a deleted device', () => {
    const out = pruneCablesForDevice(cables, 'patch');
    expect(out.map((c) => c.id)).toEqual([cables[1]!.id]); // only sw:p2→srv survives
  });
  it('is a no-op for a device with no cables', () => {
    expect(pruneCablesForDevice(cables, 'nobody')).toHaveLength(3);
  });
});

describe('pruneCablesForInterfaces — CRITICAL cascade on port re-population', () => {
  it('drops cables whose ifaceId on the changed device no longer exists', () => {
    // sw regenerated: p1 gone, p2 kept
    const out = pruneCablesForInterfaces(cables, 'sw', ['p2', 'p3']);
    expect(out.map((c) => c.id)).toEqual([cables[1]!.id, cables[2]!.id]); // sw:p1 cable pruned
  });
  it('keeps cables when all referenced ports still exist', () => {
    expect(pruneCablesForInterfaces(cables, 'sw', ['p1', 'p2'])).toHaveLength(3);
  });
  it('only affects the named device, not others sharing the cable', () => {
    // regenerate patch but keep k1; sw:p1→patch:k1 must survive
    const out = pruneCablesForInterfaces(cables, 'patch', ['k1']);
    expect(out.map((c) => c.id)).toEqual([cables[0]!.id, cables[1]!.id]); // patch:k24 pruned
  });
});

describe('isPortCabled / isSelfCable', () => {
  it('flags a port already in use', () => {
    expect(isPortCabled(cables, 'sw', 'p1')).toBe(true);
    expect(isPortCabled(cables, 'sw', 'p9')).toBe(false);
  });
  it('detects a self-cable', () => {
    expect(isSelfCable({ deviceId: 'sw', ifaceId: 'p1' }, { deviceId: 'sw', ifaceId: 'p1' })).toBe(true);
    expect(isSelfCable({ deviceId: 'sw', ifaceId: 'p1' }, { deviceId: 'sw', ifaceId: 'p2' })).toBe(false);
  });
});

describe('checkConnect', () => {
  it('accepts two free ports', () => {
    expect(checkConnect(cables, { deviceId: 'sw', ifaceId: 'p9' }, { deviceId: 'srv', ifaceId: 'nic9' })).toEqual({ ok: true });
  });
  it('rejects a self-cable', () => {
    expect(checkConnect(cables, { deviceId: 'sw', ifaceId: 'p9' }, { deviceId: 'sw', ifaceId: 'p9' })).toEqual({ ok: false, reason: 'self' });
  });
  it('reports which end is already cabled', () => {
    expect(checkConnect(cables, { deviceId: 'sw', ifaceId: 'p1' }, { deviceId: 'srv', ifaceId: 'nic9' })).toEqual({ ok: false, reason: 'a-cabled' });
    expect(checkConnect(cables, { deviceId: 'sw', ifaceId: 'p9' }, { deviceId: 'srv', ifaceId: 'nic0' })).toEqual({ ok: false, reason: 'b-cabled' });
  });
});
