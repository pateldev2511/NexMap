import { describe, expect, it } from 'vitest';
import { planPatches } from './patchPlan';
import type { Device, Link, Rack, RackCable } from '@/model/types';

const racks: Rack[] = [{ id: 'r1', name: 'MDF', ruHeight: 42 }];
const dev = (id: string, ru: number | undefined, ports = 4): Device => ({
  id,
  kind: 'device',
  type: 'switch',
  name: id,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  layerId: 'L',
  ...(ru != null ? { rackId: 'r1', ru, ruSpan: 1 } : {}),
  interfaces: Array.from({ length: ports }, (_, i) => ({ id: `${id}-${i}`, name: `p${i}` })),
});
let n = 0;
const link = (a: string, b: string, over: Partial<Link> = {}): Link => ({
  id: `l${n++}`,
  kind: 'link',
  sourceId: a,
  targetId: b,
  layerId: 'L',
  ...over,
});

describe('planPatches', () => {
  it('cables each link between racked gear on free ports, numbered and measured', () => {
    const core = dev('core', 20);
    const acc = dev('acc', 10);
    const plan = planPatches([core, acc], [link('core', 'acc'), link('core', 'acc')], [], racks);
    expect(plan.items.map((i) => [i.aEnd.ifaceId, i.bEnd.ifaceId, i.label])).toEqual([
      ['core-0', 'acc-0', 'P-001'],
      ['core-1', 'acc-1', 'P-002'],
    ]);
    expect(plan.items[0]!.lengthFt).toBe(5); // 10U ≈ 1.5 ft + 3 ft slack → 5 ft stock
  });

  it('uses the ports a link names, and keeps them free of auto-picks', () => {
    const a = dev('a', 1);
    const b = dev('b', 2);
    const plan = planPatches(
      [a, b],
      [link('a', 'b'), link('a', 'b', { sourceIfaceId: 'a-0', targetIfaceId: 'b-3' })],
      [],
      racks,
    );
    expect(plan.items.map((i) => [i.aEnd.ifaceId, i.bEnd.ifaceId])).toEqual([
      ['a-1', 'b-0'], // auto-pick steps around a-0, which the second link names
      ['a-0', 'b-3'],
    ]);
  });

  it('counts links already cabled, continues label numbering, and skips used ports', () => {
    const a = dev('a', 1);
    const b = dev('b', 2);
    const existing: RackCable = { id: 'c', aEnd: { deviceId: 'a', ifaceId: 'a-0' }, bEnd: { deviceId: 'b', ifaceId: 'b-0' }, color: '#000', label: 'P-007' };
    const plan = planPatches([a, b], [link('a', 'b'), link('b', 'a')], [existing], racks);
    expect(plan.alreadyPatched).toBe(1);
    expect(plan.items.map((i) => [i.aEnd.ifaceId, i.bEnd.ifaceId, i.label])).toEqual([['b-1', 'a-1', 'P-008']]);
    expect(planPatches([a, b], [link('a', 'b')], [existing], racks).items).toEqual([]); // idempotent
  });

  it('leaves links outside a rack logical and reports who ran out of ports', () => {
    const a = dev('a', 1, 1);
    const b = dev('b', 2);
    const c = dev('c', 3);
    const cloud = dev('cloud', undefined);
    const plan = planPatches([a, b, c, cloud], [link('a', 'b'), link('a', 'c'), link('a', 'cloud'), link('a', 'a')], [], racks);
    expect(plan.items).toHaveLength(1);
    expect(plan.notRacked).toBe(1);
    expect(plan.noFreePort.map((s) => [s.device.name, s.links])).toEqual([['a', 1]]);
  });
});
