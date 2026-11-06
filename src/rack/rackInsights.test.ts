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
