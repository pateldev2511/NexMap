import { describe, it, expect } from 'vitest';
import { planUplink, pickEdgeDevice } from './uplink';
import type { DeviceType } from '@/model/types';

const d = (id: string, type: DeviceType) => ({ id, type });
const link = (sourceId: string, targetId: string) => ({ sourceId, targetId });

describe('pickEdgeDevice', () => {
  it('picks a single router when no firewall is present', () => {
    expect(pickEdgeDevice([d('r', 'router'), d('s', 'server')])!.id).toBe('r');
  });

  it('prefers the firewall over a router (firewall is the perimeter)', () => {
    expect(pickEdgeDevice([d('r', 'router'), d('f', 'firewall')])!.id).toBe('f');
  });

  it('returns null with no edge-capable device', () => {
    expect(pickEdgeDevice([d('s', 'server'), d('sw', 'switch')])).toBeNull();
  });

  it('returns null when two firewalls make the edge ambiguous', () => {
    expect(pickEdgeDevice([d('f1', 'firewall'), d('f2', 'firewall')])).toBeNull();
  });

  it('returns null when two routers and no firewall make it ambiguous', () => {
    expect(pickEdgeDevice([d('r1', 'router'), d('r2', 'router')])).toBeNull();
  });
});

describe('planUplink', () => {
  it('plans a fresh internet node when the diagram has none', () => {
    const plan = planUplink([d('r', 'router'), d('s', 'server')], [])!;
    expect(plan.edgeId).toBe('r');
    expect(plan.existingIspId).toBeNull();
  });

  it('reuses an existing internet node instead of making a second', () => {
    const plan = planUplink([d('isp', 'isp'), d('f', 'firewall')], [])!;
    expect(plan.edgeId).toBe('f');
    expect(plan.existingIspId).toBe('isp');
  });

  it('is a no-op once the edge already reaches an ISP (idempotent)', () => {
    const devices = [d('isp', 'isp'), d('f', 'firewall')];
    expect(planUplink(devices, [link('isp', 'f')])).toBeNull();
    // direction-agnostic
    expect(planUplink(devices, [link('f', 'isp')])).toBeNull();
  });

  it('still connects when a DIFFERENT device is already on the ISP', () => {
    // ISP wired to a router; the firewall is the edge and still unconnected → connect it.
    const devices = [d('isp', 'isp'), d('r', 'router'), d('f', 'firewall')];
    const plan = planUplink(devices, [link('isp', 'r')])!;
    expect(plan.edgeId).toBe('f');
    expect(plan.existingIspId).toBe('isp');
  });

  it('returns null when there is no unambiguous edge device', () => {
    expect(planUplink([d('s', 'server'), d('pc', 'end-user')], [])).toBeNull();
    expect(planUplink([d('r1', 'router'), d('r2', 'router')], [])).toBeNull();
  });

  it('scopes the edge pick to onlyIds but reuses an ISP outside the scope', () => {
    const devices = [d('isp', 'isp'), d('r', 'router'), d('f', 'firewall')];
    // Scope to the firewall only; the router is outside scope and ignored for the pick.
    const plan = planUplink(devices, [], { onlyIds: new Set(['f']) })!;
    expect(plan.edgeId).toBe('f');
    expect(plan.existingIspId).toBe('isp');
  });
});
