import { describe, it, expect } from 'vitest';
import { rackBudget, fleetBudget } from './rackBudget';
import type { Device, Rack } from '@/model/types';

const rack = (over: Partial<Rack> = {}): Rack => ({ id: 'r1', name: 'R', ruHeight: 42, ...over });
function dev(over: Partial<Device>): Device {
  return {
    id: 'd', kind: 'device', type: 'server', name: 'd', x: 0, y: 0, width: 56, height: 40, layerId: 'L',
    rackId: 'r1', ru: 1, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', interfaces: [],
    ...over,
  };
}

describe('rackBudget — U utilization', () => {
  it('counts distinct occupied U, capped at height', () => {
    const b = rackBudget(rack({ ruHeight: 10 }), [
      dev({ id: 'a', ru: 1, ruSpan: 2 }), // U1,2
      dev({ id: 'b', ru: 5, ruSpan: 1 }), // U5
    ]);
    expect(b.usedU).toBe(3);
    expect(b.freeU).toBe(7);
    expect(b.pct).toBeCloseTo(0.3);
  });

  it('front + rear at the same U share the depth (not double-counted)', () => {
    const b = rackBudget(rack({ ruHeight: 10 }), [
      dev({ id: 'a', ru: 4, ruSpan: 1, side: 'front' }),
      dev({ id: 'b', ru: 4, ruSpan: 1, side: 'rear' }),
    ]);
    expect(b.usedU).toBe(1);
  });

  it('rail-mounted (0U) gear consumes no U but still counts toward watts/weight', () => {
    const b = rackBudget(rack({ ruHeight: 10 }), [dev({ id: 'pdu', mount: 'rail', watts: 0, weightKg: 5 })]);
    expect(b.usedU).toBe(0);
    expect(b.weightKg).toBe(5);
  });
});

describe('rackBudget — power & weight', () => {
  it('sums watts and weight and flags overload against caps', () => {
    const b = rackBudget(rack({ maxWatts: 1000, maxWeightKg: 50 }), [
      dev({ id: 'a', watts: 700, weightKg: 30 }),
      dev({ id: 'b', watts: 400, weightKg: 25 }),
    ]);
    expect(b.watts).toBe(1100);
    expect(b.weightKg).toBe(55);
    expect(b.overWatts).toBe(true);
    expect(b.overWeight).toBe(true);
  });

  it('never reports overload when no caps are set', () => {
    const b = rackBudget(rack(), [dev({ watts: 9999, weightKg: 9999 })]);
    expect(b.overWatts).toBe(false);
    expect(b.overWeight).toBe(false);
    expect(b.maxWatts).toBeUndefined();
  });

  it('ignores devices in other racks', () => {
    const b = rackBudget(rack(), [dev({ id: 'x', rackId: 'other', watts: 500 })]);
    expect(b.watts).toBe(0);
    expect(b.usedU).toBe(0);
  });
});

describe('fleetBudget — aggregate across racks', () => {
  it('sums U, power, and weight across every rack and flags any overload', () => {
    const r1: Rack = { id: 'r1', name: 'A', ruHeight: 10, maxWatts: 100 };
    const r2: Rack = { id: 'r2', name: 'B', ruHeight: 20 };
    const devices: Device[] = [
      { id: 'a', kind: 'device', type: 'server', name: 'a', x: 0, y: 0, width: 56, height: 40, layerId: 'L', rackId: 'r1', ru: 1, ruSpan: 2, mount: 'rack', side: 'front', bay: 'full', watts: 150, weightKg: 10 },
      { id: 'b', kind: 'device', type: 'server', name: 'b', x: 0, y: 0, width: 56, height: 40, layerId: 'L', rackId: 'r2', ru: 1, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', watts: 50, weightKg: 5 },
    ];
    const f = fleetBudget([r1, r2], devices);
    expect(f.rackCount).toBe(2);
    expect(f.totalU).toBe(30);
    expect(f.usedU).toBe(3); // 2U in r1 + 1U in r2
    expect(f.freeU).toBe(27);
    expect(f.watts).toBe(200);
    expect(f.weightKg).toBe(15);
    expect(f.anyOver).toBe(true); // r1 draws 150W against a 100W cap
  });

  it('is zero/clean for no racks', () => {
    const f = fleetBudget([], []);
    expect(f).toMatchObject({ rackCount: 0, totalU: 0, usedU: 0, freeU: 0, watts: 0, anyOver: false });
  });
});
