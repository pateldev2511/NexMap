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

  it('a cable on other ports does not satisfy a link that names its ports', () => {
    const a = dev('a', 1, 2);
    const b = dev('b', 2, 2);
    const a1b1: RackCable = { id: 'c', aEnd: { deviceId: 'a', ifaceId: 'a-0' }, bEnd: { deviceId: 'b', ifaceId: 'b-0' }, color: '#000' };
    const plan = planPatches([a, b], [link('a', 'b', { sourceIfaceId: 'a-1', targetIfaceId: 'b-1' })], [a1b1], racks);
    expect(plan.alreadyPatched).toBe(0);
    expect(plan.items.map((i) => [i.aEnd.ifaceId, i.bEnd.ifaceId])).toEqual([['a-1', 'b-1']]);
  });

  it('matches a named link to its cable in either direction, and a half-named one by its named end', () => {
    const a = dev('a', 1);
    const b = dev('b', 2);
    const reversed: RackCable = { id: 'c1', aEnd: { deviceId: 'b', ifaceId: 'b-2' }, bEnd: { deviceId: 'a', ifaceId: 'a-2' }, color: '#000' };
    const half: RackCable = { id: 'c2', aEnd: { deviceId: 'a', ifaceId: 'a-3' }, bEnd: { deviceId: 'b', ifaceId: 'b-0' }, color: '#000' };
    const plan = planPatches(
      [a, b],
      [link('a', 'b', { sourceIfaceId: 'a-2', targetIfaceId: 'b-2' }), link('b', 'a', { targetIfaceId: 'a-3' })],
      [reversed, half],
      racks,
    );
    expect(plan.alreadyPatched).toBe(2);
    expect(plan.items).toEqual([]);
    expect(plan.portConflicts).toEqual([]);
  });

  it('named links claim their cables before unnamed parallels take any', () => {
    const a = dev('a', 1);
    const b = dev('b', 2);
    // The only cable is the one the named link asks for; the unnamed link listed first
    // must not consume it (which would leave the named link "conflicting" with itself).
    const named: RackCable = { id: 'c', aEnd: { deviceId: 'a', ifaceId: 'a-1' }, bEnd: { deviceId: 'b', ifaceId: 'b-1' }, color: '#000', label: 'P-001' };
    const plan = planPatches([a, b], [link('a', 'b'), link('a', 'b', { sourceIfaceId: 'a-1', targetIfaceId: 'b-1' })], [named], racks);
    expect(plan.alreadyPatched).toBe(1);
    expect(plan.portConflicts).toEqual([]);
    expect(plan.items.map((i) => [i.aEnd.ifaceId, i.bEnd.ifaceId, i.label])).toEqual([['a-0', 'b-0', 'P-002']]);
  });

  it('reports a named port held by a different cable instead of patching around it', () => {
    const a = dev('a', 1);
    const b = dev('b', 2);
    const c = dev('c', 3);
    const elsewhere: RackCable = { id: 'cx', aEnd: { deviceId: 'a', ifaceId: 'a-1' }, bEnd: { deviceId: 'c', ifaceId: 'c-0' }, color: '#000', label: 'P-004' };
    const l = link('a', 'b', { sourceIfaceId: 'a-1', targetIfaceId: 'b-1' });
    const plan = planPatches([a, b, c], [l], [elsewhere], racks);
    expect(plan.items).toEqual([]);
    expect(plan.alreadyPatched).toBe(0);
    expect(plan.portConflicts.map((p) => [p.linkId, p.device.name, p.ifaceId, p.cableLabel])).toEqual([[l.id, 'a', 'a-1', 'P-004']]);
  });

  it('two links naming one free port: the first gets it, the second is reported', () => {
    const a = dev('a', 1);
    const b = dev('b', 2);
    const first = link('a', 'b', { sourceIfaceId: 'a-0' });
    const second = link('a', 'b', { sourceIfaceId: 'a-0' });
    const plan = planPatches([a, b], [first, second], [], racks);
    expect(plan.items.map((i) => [i.linkId, i.aEnd.ifaceId])).toEqual([[first.id, 'a-0']]);
    expect(plan.portConflicts.map((p) => [p.linkId, p.ifaceId, p.cableLabel])).toEqual([[second.id, 'a-0', 'P-001']]);
  });

  it('named and unnamed parallel links together: applying the plan twice adds nothing', () => {
    const a = dev('a', 1);
    const b = dev('b', 2);
    const links = [
      link('a', 'b'),
      link('a', 'b', { sourceIfaceId: 'a-2', targetIfaceId: 'b-2' }),
      link('b', 'a', { sourceIfaceId: 'b-3' }),
      link('a', 'b'),
    ];
    const first = planPatches([a, b], links, [], racks);
    expect(first.items).toHaveLength(4);
    expect(first.portConflicts).toEqual([]);
    const applied: RackCable[] = first.items.map((it, i) => ({ id: `n${i}`, aEnd: it.aEnd, bEnd: it.bEnd, color: '#000', label: it.label }));
    const again = planPatches([a, b], links, applied, racks);
    expect(again.items).toEqual([]);
    expect(again.alreadyPatched).toBe(4);
    expect(again.portConflicts).toEqual([]);
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
