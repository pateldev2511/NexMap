import { describe, expect, it } from 'vitest';
import type { Device, Rack, RackCable, ValidationIssue } from '@/model/types';
import { rackInsights } from './rackInsights';
import { RACK_CATALOG } from './rackCatalog';

const rack = (over: Partial<Rack> = {}): Rack => ({ id: 'r1', name: 'Rack 1', ruHeight: 24, ...over });
const dev = (over: Partial<Device> = {}): Device => ({
  id: 'd1',
  kind: 'device',
  type: 'server',
  name: 'srv-01',
  x: 0,
  y: 0,
  width: 56,
  height: 40,
  layerId: 'L',
  rackId: 'r1',
  ru: 10,
  ruSpan: 2,
  mount: 'rack',
  side: 'front',
  bay: 'full',
  interfaces: [{ id: 'p1', name: 'nic0' }],
  watts: 600,
  powerFeed: 'A',
  ...over,
});
const cable = (over: Partial<RackCable> = {}): RackCable => ({
  id: 'c1',
  aEnd: { deviceId: 'd1', ifaceId: 'p1' },
  bEnd: { deviceId: 'd2', ifaceId: 'p1' },
  color: '#fff',
  ...over,
});

describe('rackInsights', () => {
  it('surfaces actionable selected-device management suggestions', () => {
    const insights = rackInsights({
      racks: [rack()],
      devices: [dev()],
      cables: [cable()],
      selectedDeviceId: 'd1',
      activeRackId: 'r1',
    });

    expect(insights.map((i) => i.action)).toContain('add-asset-tag');
    expect(insights.map((i) => i.action)).toContain('auto-length');
    expect(insights.map((i) => i.action)).toContain('go-to-u');
    expect(insights[0]?.severity).toBe('warn');
  });

  it('prioritizes capacity and health risks above informational suggestions', () => {
    const issue: ValidationIssue = {
      id: 'v1',
      code: 'rack-loop',
      severity: 'warn',
      message: 'Loop detected',
      objectIds: ['c1'],
    };
    const insights = rackInsights({
      racks: [rack({ maxWatts: 100 })],
      devices: [dev({ assetTag: 'A-1', vendor: 'Dell', model: 'R650' })],
      cables: [],
      issues: [issue],
      selectedDeviceId: 'd1',
      activeRackId: 'r1',
    });

    expect(insights[0]).toMatchObject({ action: 'review-rack', severity: 'error' });
    expect(insights.some((i) => i.action === 'review-health')).toBe(true);
  });
  it('says when a rack has a depth but its gear records none, and offers datasheet depths', () => {
    const m = RACK_CATALOG.find((c) => c.type === 'server' && c.depthMm)!;
    const insights = rackInsights({
      racks: [rack({ depthMm: 1000 })],
      devices: [
        dev({ id: 'd1', vendor: m.vendor, model: m.model }),
        dev({ id: 'd2', ru: 1, vendor: 'Homebrew', model: 'Box' }),
        dev({ id: 'd3', ru: 5, type: 'patch-panel', ruSpan: 1 }), // shallow: no depth needed
      ],
      cables: [],
    });
    const unchecked = insights.find((i) => i.id === 'depth-unchecked-r1')!;
    expect(unchecked).toMatchObject({ title: 'Depth not checked for 2 units', action: 'fill-depths', severity: 'info' });
    expect(unchecked.objectIds).toEqual(['d1', 'd2']);
    expect(unchecked.detail).toBe('Rack 1: 1 of them is a catalog model with a datasheet depth.');
  });

  it('stays quiet about depth when the rack records none, or every unit has one', () => {
    const noRackDepth = rackInsights({ racks: [rack()], devices: [dev()], cables: [] });
    expect(noRackDepth.some((i) => i.id.startsWith('depth-unchecked'))).toBe(false);
    const allKnown = rackInsights({ racks: [rack({ depthMm: 1000 })], devices: [dev({ depthMm: 700 })], cables: [] });
    expect(allKnown.some((i) => i.id.startsWith('depth-unchecked'))).toBe(false);
  });

  it('points at the rack when no unit is a known model', () => {
    const insights = rackInsights({ racks: [rack({ depthMm: 600 })], devices: [dev()], cables: [] });
    expect(insights.find((i) => i.id === 'depth-unchecked-r1')).toMatchObject({
      action: 'review-rack',
      detail: 'Rack 1: add a depth or apply a known model to check them against its 600 mm.',
    });
  });
});

describe('rackInsights — PDU feeds', () => {
  const pdu = (over: Partial<Device> = {}) =>
    dev({ id: 'pa', name: 'PDU A', type: 'ups', mount: 'rail', side: 'rear', ru: 1, ruSpan: 6, watts: 0, powerFeed: 'A', interfaces: Array.from({ length: 2 }, (_, i) => ({ id: `o${i}`, name: `C13-${i + 1}` })), ...over });
  const run = (devices: Device[]) => rackInsights({ racks: [rack()], devices, cables: [] });

  it('flags dual-corded gear whose second feed has no PDU, with an Add PDU fix', () => {
    const hit = run([pdu(), dev({ id: 's1', powerFeed: 'AB' })]).find((i) => i.id === 'pdu-missing-r1-B');
    expect(hit).toMatchObject({ title: 'No PDU on feed B', action: 'add-pdu', actionLabel: 'Add PDU B', rackId: 'r1', objectIds: ['s1'] });
    expect(hit!.detail).toBe('Rack 1: 1 unit needs a cord on feed B, but none of its PDUs is on it.');
  });

  it('flags a feed with more cords than outlets', () => {
    const gear = ['s1', 's2', 's3'].map((id, i) => dev({ id, ru: 10 + i * 2 }));
    const hit = run([pdu(), ...gear]).find((i) => i.id === 'pdu-outlets-r1-A');
    expect(hit?.detail).toBe('Rack 1: 3 cords on feed A, 2 outlets across its PDU.');
  });

  it('stays quiet when each feed has a PDU with room, and in racks with no PDU drawn', () => {
    const both = [pdu(), pdu({ id: 'pb', powerFeed: 'B', bay: 'left' }), dev({ id: 's1', powerFeed: 'AB' })];
    expect(run(both).filter((i) => i.action === 'add-pdu')).toEqual([]);
    expect(run([dev({ id: 's1', powerFeed: 'AB' })]).filter((i) => i.action === 'add-pdu')).toEqual([]);
  });
});

describe('rackInsights — PDU load', () => {
  const strip = (id: string, feed: 'A' | 'B', over: Partial<Device> = {}) =>
    dev({ id, name: `PDU ${feed}`, type: 'ups', mount: 'rail', side: 'rear', bay: feed === 'A' ? 'right' : 'left', ru: 1, ruSpan: 24, watts: 0, powerFeed: feed, ratedAmps: 10, ratedVolts: 200, interfaces: Array.from({ length: 8 }, (_, i) => ({ id: `${id}o${i}`, name: `C13-${i + 1}` })), ...over });
  // Two 2 kW strips (10 A × 200 V) and dual-corded gear.
  const run = (gear: Device[], a: Partial<Device> = {}) =>
    rackInsights({ racks: [rack()], devices: [strip('pa', 'A', a), strip('pb', 'B'), ...gear], cables: [] }).filter((i) => i.action === 'review-pdu');
  const gear = (watts: number[]) => watts.map((w, i) => dev({ id: `s${i}`, ru: 2 + i * 2, watts: w, powerFeed: 'AB' }));

  it('warns that a strip trips when the other feed fails', () => {
    // 2.4 kW of dual-corded gear: 1.2 kW per strip normally, all of it on one if a feed goes.
    const hits = run(gear([1200, 1200]));
    expect(hits.map((h) => h.id)).toEqual(['pdu-failover-pa', 'pdu-failover-pb']);
    expect(hits[0]).toMatchObject({ title: 'PDU A trips if feed B fails', severity: 'warn', rackId: 'r1', deviceId: 'pa', actionLabel: 'Review PDU' });
    expect(hits[0]!.detail).toBe("Rack 1: 2.40 kW lands on it when feed B goes; it's rated 2.00 kW (10 A × 200 V).");
  });

  it('warns that a strip is over its rating in normal operation', () => {
    const hits = run([dev({ id: 's0', ru: 2, watts: 2500, powerFeed: 'A' })]);
    expect(hits).toEqual([expect.objectContaining({ id: 'pdu-over-pa', title: 'PDU A is over its rating', detail: 'Rack 1: 2.50 kW on a 2.00 kW (10 A × 200 V) strip.' })]);
  });

  it('notes a strip past 80% under failover, and stays quiet below it', () => {
    expect(run(gear([1700]))).toEqual([
      expect.objectContaining({ id: 'pdu-80-pa', severity: 'info', detail: 'Rack 1: 85% of 2.00 kW (10 A × 200 V). Many electrical codes cap continuous load at 80%.' }),
      expect.objectContaining({ id: 'pdu-80-pb' }),
    ]);
    expect(run(gear([1500]))).toEqual([]);
  });

  it('checks a three-phase strip against √3 × A × V', () => {
    // 2.9 kW on failover trips the 10 A × 200 V single-phase strip (2 kW) but is only 84%
    // of the same rating three-phase (3.46 kW).
    const hits = run(gear([1450, 1450]), { ratedPhases: 3 });
    expect(hits.map((h) => h.id).sort()).toEqual(['pdu-80-pa', 'pdu-failover-pb']);
    expect(hits.find((h) => h.id === 'pdu-80-pa')!.detail).toContain('84% of 3.46 kW (10 A × 200 V 3-phase)');
  });

  it('leaves a strip without a full rating unchecked', () => {
    const hits = run(gear([5000]), { ratedVolts: undefined });
    expect(hits.map((h) => h.deviceId)).toEqual(['pb']);
  });
});

describe('rackInsights — UPS load', () => {
  it('warns that a UPS overloads if the other feed fails, and skips an unrated one', () => {
    const ups = (id: string, feed: 'A' | 'B', ratedWatts?: number) =>
      dev({ id, name: id, type: 'ups', ru: 1, ruSpan: 2, watts: 0, powerFeed: feed, interfaces: [], ...(ratedWatts ? { ratedWatts } : {}) });
    const gear = [dev({ id: 's1', ru: 5, watts: 1500, powerFeed: 'AB' })];
    const run = (devices: Device[]) => rackInsights({ racks: [rack()], devices, cables: [] }).filter((i) => i.id.startsWith('ups-'));
    expect(run([ups('ups-a', 'A', 2000), ups('ups-b', 'B', 1200), ...gear])).toEqual([
      expect.objectContaining({
        id: 'ups-failover-ups-b',
        title: 'ups-b overloads if feed A fails',
        detail: 'Rack 1: 1.50 kW lands on feed B when feed A goes, against 1.20 kW of UPS output.',
        action: 'review-pdu',
        actionLabel: 'Review UPS',
        deviceId: 'ups-b',
      }),
    ]);
    expect(run([ups('ups-a', 'A'), ups('ups-b', 'B'), ...gear])).toEqual([]);
  });
});
