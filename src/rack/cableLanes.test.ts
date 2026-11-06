import { describe, expect, it } from 'vitest';
import { CABLES_PER_MANAGER_U, cableLanes, isVerticalManager, nearestManager, routeLabel, verticalManagerFor } from './cableLanes';
import { isCableManager, panelKindForDevice } from './panelKind';
import { rackInsights } from './rackInsights';
import { cableScheduleCsv } from './buildRackSvg';
import type { Device, RackCable } from '@/model/types';

const dev = (id: string, ru: number, over: Partial<Device> = {}): Device => ({
  id,
  kind: 'device',
  type: 'switch',
  name: id,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  layerId: 'L',
  rackId: 'r1',
  ru,
  ruSpan: 1,
  interfaces: Array.from({ length: 48 }, (_, i) => ({ id: `${id}-p${i}`, name: `${i + 1}` })),
  ...over,
});
const mgr = (id: string, ru: number, over: Partial<Device> = {}) =>
  dev(id, ru, { type: 'generic', rackAccessory: 'cable-manager', interfaces: [], ...over });
let k = 0;
const cable = (a: Device, b: Device, i = k): RackCable => ({
  id: `c${k++}`,
  aEnd: { deviceId: a.id, ifaceId: `${a.id}-p${i % 48}` },
  bEnd: { deviceId: b.id, ifaceId: `${b.id}-p${i % 48}` },
  color: '#000',
});

describe('which manager dresses a device', () => {
  it('nearest on the same face and rack, within 3U; the lower one on a tie', () => {
    const below = mgr('cm-low', 9);
    const above = mgr('cm-high', 13);
    const sw = dev('sw', 11);
    expect(nearestManager(sw, [above, below])).toBe(below);
    expect(nearestManager(dev('far', 20), [above, below])).toBeNull(); // 7U away
    expect(nearestManager(dev('rear', 10, { side: 'rear' }), [below])).toBeNull();
    expect(nearestManager(dev('other', 10, { rackId: 'r2' }), [below])).toBeNull();
    expect(nearestManager(dev('pdu', 10, { mount: 'rail' }), [below])).toBeNull();
  });

  it('knows unmarked managers from older designs by their stock names', () => {
    expect(isCableManager({ type: 'generic', name: 'cm-01' })).toBe(true);
    expect(isCableManager({ type: 'generic', name: 'Cable manager 2' })).toBe(true);
    expect(isCableManager({ type: 'generic', name: 'Blank' })).toBe(false);
    expect(isCableManager({ type: 'switch', name: 'cm-01' })).toBe(false);
    expect(panelKindForDevice(mgr('m', 1))).toBe('cable-mgr'); // draws as one, not a blank
  });

  it("a unit marked 'none' isn't one, whatever its name says", () => {
    expect(isCableManager({ type: 'generic', name: 'cm-01', rackAccessory: 'none' })).toBe(false);
  });
});

describe('cableLanes', () => {
  it('routes each cord through one or two managers and counts fill', () => {
    const cm1 = mgr('cm-01', 22);
    const cm2 = mgr('cm-02', 35);
    const patch = dev('patch', 23, { type: 'patch-panel' });
    const sw = dev('sw', 21);
    const core = dev('core', 36);
    const c1 = cable(patch, sw);
    const c2 = cable(patch, core);
    const lanes = cableLanes([cm1, cm2, patch, sw, core], [c1, c2]);
    expect(routeLabel(lanes.routes.get(c1.id)!)).toBe('cm-01 (U22)'); // both ends share it: counted once
    expect(routeLabel(lanes.routes.get(c2.id)!)).toBe('cm-01 (U22) → cm-02 (U35)');
    expect(lanes.fill.map((f) => [f.manager.name, f.cables, f.capacity])).toEqual([
      ['cm-01', 2, CABLES_PER_MANAGER_U],
      ['cm-02', 1, CABLES_PER_MANAGER_U],
    ]);
    expect(lanes.unmanaged).toEqual([]);
  });

  it('flags dense gear with nowhere to dress its cords', () => {
    const a = dev('tor', 10);
    const b = dev('srv', 30, { type: 'server' });
    const cables = Array.from({ length: 12 }, (_, i) => cable(a, b, i));
    const lanes = cableLanes([a, b], cables);
    expect(lanes.unmanaged.map((u) => [u.device.name, u.cables])).toEqual([
      ['srv', 12],
      ['tor', 12],
    ]);
    expect(cableLanes([a, b], cables.slice(0, 11)).unmanaged).toEqual([]); // below the threshold
  });

  it('surfaces as warn-level suggestions and a Route column in the schedule', () => {
    const cm = mgr('cm-01', 11);
    const a = dev('a', 10);
    const b = dev('b', 12);
    const cables = Array.from({ length: 25 }, (_, i) => cable(a, b, i));
    const titles = rackInsights({ racks: [{ id: 'r1', name: 'MDF', ruHeight: 42 }], devices: [cm, a, b], cables });
    const full = titles.find((t) => t.title === 'Cable manager over capacity')!;
    expect([full.severity, full.detail]).toEqual(['warn', 'cm-01 at U11 dresses 25 cords; a 1U manager holds about 24.']);
    expect(cableScheduleCsv([cm, a, b], cables.slice(0, 1)).split('\n')[1]).toMatch(/,"cm-01 \(U11\)"$/);

    const loose = rackInsights({ racks: [], devices: [a, b], cables: cables.slice(0, 12) });
    expect(loose.find((t) => t.title === 'Dense gear without a cable manager')!.detail).toBe(
      'a has 12 cords and no cable manager within 3U.',
    );
  });
});

describe('vertical cable managers', () => {
  const vcm = (id: string, over: Partial<Device> = {}) => mgr(id, 1, { mount: 'rail', ruSpan: 42, ...over });

  it('a manager on the 0U rail is vertical, and dresses the gear beside it on its face', () => {
    const v = vcm('vm-front');
    const rear = vcm('vm-rear', { side: 'rear' });
    expect(isVerticalManager(v)).toBe(true);
    expect(isVerticalManager(mgr('cm-01', 10))).toBe(false);
    expect(verticalManagerFor(dev('sw', 20), [rear, v])).toBe(v);
    expect(verticalManagerFor(dev('sw', 20, { side: 'rear' }), [v])).toBeNull();
    expect(verticalManagerFor(dev('sw', 20), [vcm('short', { ruSpan: 10 })])).toBeNull(); // covers U1–10 only
    expect(nearestManager(dev('sw', 2), [v])).toBeNull(); // never counted as a horizontal one
  });

  it('carries the run between two horizontal managers, but not a cord that stays in one', () => {
    const v = vcm('Vertical manager 1');
    const cm1 = mgr('cm-01', 22);
    const cm2 = mgr('cm-02', 35);
    const patch = dev('patch', 23, { type: 'patch-panel' });
    const sw = dev('sw', 21);
    const core = dev('core', 36);
    const short = cable(patch, sw);
    const long = cable(patch, core);
    const lanes = cableLanes([v, cm1, cm2, patch, sw, core], [short, long]);
    expect(routeLabel(lanes.routes.get(short.id)!)).toBe('cm-01 (U22)');
    expect(routeLabel(lanes.routes.get(long.id)!)).toBe('cm-01 (U22) → Vertical manager 1 (U1–42) → cm-02 (U35)');
    expect(lanes.fill.map((f) => [f.manager.name, f.cables, f.capacity])).toEqual([
      ['cm-01', 2, CABLES_PER_MANAGER_U],
      ['cm-02', 1, CABLES_PER_MANAGER_U],
      ['Vertical manager 1', 1, null],
    ]);
  });

  it('dresses dense gear with no horizontal manager, and runs a cross-rack cord up each rack', () => {
    const v1 = vcm('vm-1');
    const v2 = vcm('vm-2', { rackId: 'r2' });
    const a = dev('tor', 10);
    const b = dev('srv', 30, { type: 'server' });
    const c = dev('agg', 40, { rackId: 'r2' });
    const dense = Array.from({ length: 12 }, (_, i) => cable(a, b, i));
    const lanes = cableLanes([v1, v2, a, b, c], [...dense, cable(a, c)]);
    expect(lanes.unmanaged).toEqual([]); // the vertical manager's fingers take them
    expect(routeLabel(lanes.routes.get(dense[0]!.id)!)).toBe('vm-1 (U1–42)');
    expect(routeLabel(lanes.routes.get(`c${k - 1}`)!)).toBe('vm-1 (U1–42) → vm-2 (U1–42)');
  });

  it('is never reported over capacity: there is no published figure to judge it by', () => {
    const v = vcm('vm-1');
    const a = dev('a', 10);
    const b = dev('b', 30);
    const cables = Array.from({ length: 200 }, (_, i) => cable(a, b, i));
    const titles = rackInsights({ racks: [{ id: 'r1', name: 'MDF', ruHeight: 42 }], devices: [v, a, b], cables }).map((t) => t.title);
    expect(titles).not.toContain('Cable manager over capacity');
    expect(titles).not.toContain('Dense gear without a cable manager');
  });
});
