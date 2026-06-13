import { describe, it, expect, beforeEach } from 'vitest';
import { estimateCableLengthFt, roundUpToStockFt, STOCK_LENGTHS_FT } from './cableLength';
import { useProjectStore } from '@/store/projectStore';
import type { Device, Rack } from '@/model/types';

const rack = (id: string, order?: number): Rack => ({ id, name: id, ruHeight: 42, order });
const dev = (over: Partial<Device>): Device => ({
  id: 'd' + Math.random().toString(36).slice(2), kind: 'device', type: 'switch', name: 'd',
  x: 0, y: 0, width: 56, height: 40, layerId: 'L', ...over,
});

describe('roundUpToStockFt', () => {
  it('rounds up to the next stocked length, clamping at the max', () => {
    expect(roundUpToStockFt(0.5)).toBe(1);
    expect(roundUpToStockFt(4)).toBe(5);
    expect(roundUpToStockFt(10)).toBe(10);
    expect(roundUpToStockFt(999)).toBe(STOCK_LENGTHS_FT[STOCK_LENGTHS_FT.length - 1]);
  });
});

describe('estimateCableLengthFt', () => {
  const r1 = rack('r1', 0);
  const r2 = rack('r2', 1);

  it('returns null when an endpoint is not mounted', () => {
    expect(estimateCableLengthFt(dev({ rackId: 'r1', ru: 10 }), dev({ ru: undefined }), [r1])).toBeNull();
  });

  it('intra-rack short run rounds to a small stocked length', () => {
    const a = dev({ rackId: 'r1', ru: 10 });
    const b = dev({ rackId: 'r1', ru: 12 });
    expect(estimateCableLengthFt(a, b, [r1])).toBe(5); // ~3ft slack + tiny vertical → 5
  });

  it('cross-rack run is longer than the same span intra-rack', () => {
    const a = dev({ rackId: 'r1', ru: 10 });
    const sameRack = estimateCableLengthFt(a, dev({ rackId: 'r1', ru: 20 }), [r1, r2])!;
    const crossRack = estimateCableLengthFt(a, dev({ rackId: 'r2', ru: 20 }), [r1, r2])!;
    expect(crossRack).toBeGreaterThan(sameRack);
  });
});

describe('autoLengthRackCables (store)', () => {
  const s = () => useProjectStore.getState();
  beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

  it('fills missing lengths from geometry, respects manual ones, and is undoable', () => {
    const r = s().addRack('MDF');
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 0, 0);
    const pa = s().addInterface(a, 'p1')!;
    const pb = s().addInterface(b, 'nic0')!;
    s().placeInRack(a, r, { ru: 40, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', depth: 'full' });
    s().placeInRack(b, r, { ru: 30, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', depth: 'full' });
    const c1 = s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#fff')!;
    // a manually-set cable should be left alone
    s().updateRackCable(c1, { lengthFt: undefined }, { lengthFt: 99 });
    const pa2 = s().addInterface(a, 'p2')!;
    const pb2 = s().addInterface(b, 'nic1')!;
    const c2 = s().connectRackCable({ deviceId: a, ifaceId: pa2 }, { deviceId: b, ifaceId: pb2 }, '#fff')!;

    const n = s().autoLengthRackCables();
    expect(n).toBe(1); // only c2 had no length
    expect(s().getRackCable(c1)!.lengthFt).toBe(99); // manual untouched
    expect(s().getRackCable(c2)!.lengthFt).toBeGreaterThan(0);

    s().undo();
    expect(s().getRackCable(c2)!.lengthFt).toBeUndefined();
  });
});
