/**
 * Rack depth-fit: devices and racks can record a depth (mm). The designer uses it to
 * allow back-to-back placement that physically fits; everything else that doesn't fit
 * front-to-rear is a warning, never a block.
 */
import { describe, it, expect } from 'vitest';
import { backToBackClash, canFit, depthProblems, slotOf, slotsCollide } from './rackModel';
import { rackBudget } from './rackBudget';
import { rackHealthScore } from './rackHealthScore';
import { rackFieldsFromPreset, rackPresetById } from './rackTypes';
import { validate } from '@/model/validate';
import type { Device, Rack } from '@/model/types';

const rack = (over: Partial<Rack> = {}): Rack => ({ id: 'r1', name: 'MDF', ruHeight: 42, ...over });
let n = 0;
const dev = (over: Partial<Device> = {}): Device => ({
  id: `d${n++}`,
  kind: 'device',
  type: 'switch',
  name: `sw${n}`,
  x: 0,
  y: 0,
  width: 56,
  height: 40,
  layerId: 'L',
  rackId: 'r1',
  ru: 1,
  ruSpan: 1,
  ...over,
});

describe('back-to-back by millimetres', () => {
  it('two short full-depth switches can share a U front and rear when they fit', () => {
    const front = dev({ side: 'front', depthMm: 300 });
    const rear = dev({ side: 'rear', depthMm: 400 });
    expect(slotsCollide(slotOf(front), slotOf(rear), 900)).toBe(false);
    expect(slotsCollide(slotOf(front), slotOf(rear), 600)).toBe(true); // 700 > 600
    expect(backToBackClash(slotOf(front), slotOf(rear))).toBe(true); // no rack depth: category rule
  });

  it('without recorded depths the old full-depth rule stands (nothing newly blocked or freed)', () => {
    const front = dev({ side: 'front' });
    const rear = dev({ side: 'rear' });
    expect(slotsCollide(slotOf(front), slotOf(rear), 900)).toBe(true);
    const panel = dev({ side: 'rear', type: 'patch-panel' });
    expect(slotsCollide(slotOf(front), slotOf(panel), 900)).toBe(false); // shallow: never collided
  });

  it('canFit lets a short switch go on the rear behind another', () => {
    const r = rack({ depthMm: 900 });
    const front = dev({ side: 'front', depthMm: 300 });
    const candidate = slotOf(dev({ side: 'rear', depthMm: 400 }));
    expect(canFit(r, [front], candidate)).toEqual({ ok: true });
    expect(canFit(rack({ depthMm: 600 }), [front], candidate)).toEqual({ ok: false, reason: 'occupied' });
  });
});

describe('depthProblems / validation / budget', () => {
  it('flags a unit deeper than the rack, and a shallow pair too deep together — as warnings', () => {
    const r = rack({ depthMm: 600 });
    const deep = dev({ name: 'Server-1', type: 'server', ru: 10, depthMm: 750 });
    const front = dev({ name: 'PP-1', type: 'patch-panel', ru: 20, side: 'front', depthMm: 350 });
    const rear = dev({ name: 'PP-2', type: 'patch-panel', ru: 20, side: 'rear', depthMm: 300 });
    const ok = dev({ name: 'SW-1', ru: 30, depthMm: 400 });
    const unknown = dev({ name: 'SW-2', ru: 31 }); // no depth: not judged
    const devices = [deep, front, rear, ok, unknown];
    const p = depthProblems(r, devices);
    expect(p.tooDeep.map((d) => d.name)).toEqual(['Server-1']);
    expect(p.clashes.map(([a, b]) => [a.name, b.name])).toEqual([['PP-1', 'PP-2']]);

    const issues = validate({ devices, links: [], racks: [r] });
    const byCode = (c: string) => issues.filter((i) => i.code === c);
    expect(byCode('rack-depth-overflow').map((i) => [i.severity, i.message])).toEqual([
      ['warn', 'Server-1 is 750 mm deep; MDF fits 600 mm.'],
    ]);
    expect(byCode('rack-depth-clash').map((i) => i.severity)).toEqual(['warn']);
    expect(byCode('rack-depth-clash')[0]!.message).toBe(
      "PP-1 (350 mm) and PP-2 (300 mm) sit front and rear of the same U but need 650 mm of MDF's 600 mm.",
    );
    expect(byCode('rack-ru-collision')).toEqual([]); // front/rear patch panels don't collide

    const b = rackBudget(r, devices);
    expect([b.tooDeep, b.depthClashes, b.overDepth, b.depthMm]).toEqual([1, 1, true, 600]);
    const capacity = rackHealthScore(r, devices).dimensions.find((d) => d.key === 'capacity')!;
    expect(capacity.risk).toBe('1 unit is deeper than the rack.');
    expect(capacity.score).toBeGreaterThan(0); // a warning, not a hard fail
  });

  it('no rack depth → nothing judged; rail items never judged', () => {
    const devices = [dev({ depthMm: 2000 }), dev({ mount: 'rail', depthMm: 2000, ru: 5 })];
    expect(depthProblems(rack(), devices)).toEqual({ tooDeep: [], clashes: [] });
    expect(depthProblems(rack({ depthMm: 600 }), [devices[1]!]).tooDeep).toEqual([]);
  });

  it('validation no longer reports legitimate front/rear, half-bay and rail sharing as overlaps', () => {
    const r = rack();
    const devices = [
      dev({ type: 'patch-panel', ru: 1, side: 'front' }),
      dev({ type: 'patch-panel', ru: 1, side: 'rear' }),
      dev({ ru: 2, bay: 'left' }),
      dev({ ru: 2, bay: 'right' }),
      dev({ ru: 3, mount: 'rail' }),
      dev({ ru: 3 }),
    ];
    expect(validate({ devices, links: [], racks: [r] }).filter((i) => i.code === 'rack-ru-collision')).toEqual([]);
    // …while a real same-face overlap still is one.
    const clash = [dev({ ru: 8 }), dev({ ru: 8 })];
    expect(validate({ devices: clash, links: [], racks: [r] }).some((i) => i.code === 'rack-ru-collision')).toBe(true);
  });
});

describe('presets', () => {
  it('cabinets come with a typical usable depth; an open two-post has none', () => {
    expect(rackFieldsFromPreset(rackPresetById('std-42u')!).depthMm).toBe(900);
    expect(rackFieldsFromPreset(rackPresetById('open-42u')!).depthMm).toBeUndefined();
  });
});

describe('placeInRack uses the device’s own depth', () => {
  it('a short switch can be mounted behind another without the caller passing depths', async () => {
    const { useProjectStore } = await import('@/store/projectStore');
    const s = () => useProjectStore.getState();
    s().newProject('2026-01-01T00:00:00.000Z');
    const rackId = s().addRack('MDF');
    s().updateRack(rackId, {}, { depthMm: 900 });
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(a, {}, { depthMm: 450 });
    s().updateDevice(b, {}, { depthMm: 400 });
    const slot = (side: 'front' | 'rear') => ({ ru: 20, ruSpan: 1, mount: 'rack' as const, side, bay: 'full' as const, depth: 'full' as const });
    expect(s().placeInRack(a, rackId, slot('front'))).toEqual({ ok: true });
    expect(s().placeInRack(b, rackId, slot('rear'))).toEqual({ ok: true });
    s().updateDevice(b, {}, { rackId: undefined, ru: undefined });
    s().updateDevice(b, {}, { depthMm: 500 }); // 950 > 900: no longer fits behind it
    expect(s().placeInRack(b, rackId, slot('rear'))).toEqual({ ok: false, reason: 'occupied' });
  });
});

describe('rack insights · depth', () => {
  it('names which depth problem it is', async () => {
    const { rackInsights } = await import('./rackInsights');
    const r = rack({ depthMm: 600 });
    const pair = [
      dev({ name: 'PP-1', type: 'patch-panel', ru: 20, side: 'front', depthMm: 350 }),
      dev({ name: 'PP-2', type: 'patch-panel', ru: 20, side: 'rear', depthMm: 300 }),
    ];
    const titles = (devices: Device[]) => rackInsights({ racks: [r], devices, cables: [] }).map((i) => i.title);
    expect(titles(pair)).toContain('Front and rear gear too deep together');
    expect(titles([dev({ name: 'Srv', type: 'server', depthMm: 900 })])).toContain('Gear deeper than the rack');
  });
});
