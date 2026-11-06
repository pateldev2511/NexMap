import { describe, it, expect } from 'vitest';
import type { Device, Rack } from '@/model/types';
import { planPowerCords, powerCordCsv } from './powerCords';

const rack: Rack = { id: 'r1', name: 'MDF', ruHeight: 12 };
const dev = (over: Partial<Device>): Device => ({
  id: 'd', kind: 'device', type: 'server', name: 'd', x: 0, y: 0, width: 56, height: 40, layerId: 'L',
  rackId: 'r1', ru: 1, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', ...over,
});
/** A full-height strip with `n` outlets: outlet 1 at the top, one per U when n = 12. */
const pdu = (id: string, feed: 'A' | 'B', n = 12, over: Partial<Device> = {}) =>
  dev({
    id, name: id, type: 'ups', mount: 'rail', side: 'rear', bay: feed === 'A' ? 'right' : 'left', ru: 1, ruSpan: 12,
    powerFeed: feed, interfaces: Array.from({ length: n }, (_, i) => ({ id: `${id}o${i}`, name: `C13-${i + 1}` })), ...over,
  });

describe('planPowerCords', () => {
  it('plugs each cord into the free outlet nearest its height', () => {
    const cords = planPowerCords(rack, [pdu('pa', 'A'), dev({ id: 'top', ru: 12 }), dev({ id: 'low', ru: 2 })]);
    expect(cords).toEqual([
      { deviceId: 'top', feed: 'A', pduId: 'pa', outlet: 'C13-1' }, // outlet 1 sits at U12
      { deviceId: 'low', feed: 'A', pduId: 'pa', outlet: 'C13-11' }, // outlet 11 sits at U2
    ]);
  });

  it('gives a dual-corded unit one cord on each feed', () => {
    const cords = planPowerCords(rack, [pdu('pa', 'A'), pdu('pb', 'B'), dev({ id: 's', ru: 6, ruSpan: 2, powerFeed: 'AB' })]);
    expect(cords).toEqual([
      { deviceId: 's', feed: 'A', pduId: 'pa', outlet: 'C13-6' },
      { deviceId: 's', feed: 'B', pduId: 'pb', outlet: 'C13-6' },
    ]);
  });

  it('a taken outlet goes to the next nearest, and a full feed reports the cord unplugged', () => {
    const gear = [dev({ id: 'a', ru: 5 }), dev({ id: 'b', ru: 5, bay: 'left' }), dev({ id: 'c', ru: 5, bay: 'right' })];
    const cords = planPowerCords(rack, [pdu('pa', 'A', 2, { ru: 4, ruSpan: 2 }), ...gear]);
    expect(cords.map((c) => [c.deviceId, c.outlet])).toEqual([
      ['a', 'C13-1'],
      ['b', 'C13-2'],
      ['c', null],
    ]);
    expect(cords[2]!.pduId).toBeNull();
  });

  it('skips passive gear, the strips themselves, a rack UPS and units outside the rack', () => {
    const cords = planPowerCords(rack, [
      pdu('pa', 'A'),
      dev({ id: 'pp', type: 'patch-panel', ru: 10 }),
      dev({ id: 'ups', type: 'ups', ru: 1, ruSpan: 2 }),
      dev({ id: 'other', rackId: 'r2', ru: 3 }),
      dev({ id: 'srv', ru: 8 }),
    ]);
    expect(cords.map((c) => c.deviceId)).toEqual(['srv']);
  });

  it('leaves a cord unplugged when its feed has no PDU', () => {
    expect(planPowerCords(rack, [pdu('pa', 'A'), dev({ id: 's', powerFeed: 'B' })])).toEqual([
      { deviceId: 's', feed: 'B', pduId: null, outlet: null },
    ]);
  });
});

describe('powerCordCsv', () => {
  it('lists every cord with its rack, unit, feed, PDU and outlet', () => {
    const csv = powerCordCsv([rack], [pdu('pdu-a', 'A'), dev({ id: 's', name: 'esxi-01', ru: 12, powerFeed: 'AB' })]);
    expect(csv.split('\n')).toEqual([
      'Rack,Device,U,Feed,PDU,Outlet',
      '"MDF","esxi-01","U12","A","pdu-a","C13-1"',
      '"MDF","esxi-01","U12","B","no free outlet",""',
    ]);
  });
});
