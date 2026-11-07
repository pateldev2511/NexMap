import { describe, it, expect } from 'vitest';
import type { Device, Rack } from '@/model/types';
import { analyzeRackPower, feedFailure, feedFailureSummary, loadStatus, unitFate, upsLoads, pduLoads, pduRatedWatts, planPowerCords, powerCordCsv, powerStripCsv, powerStripRows } from './powerCords';

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

describe('pduLoads', () => {
  it('splits dual-corded draw across strips and puts all of it on each if the other feed fails', () => {
    const loads = pduLoads(rack, [
      pdu('pa', 'A', 12, { ratedAmps: 16, ratedVolts: 230 }),
      pdu('pb', 'B'),
      dev({ id: 's', ru: 6, watts: 400, powerFeed: 'AB' }),
      dev({ id: 'a', ru: 3, watts: 100 }),
      dev({ id: 'b', ru: 2, watts: 50, powerFeed: 'B' }),
    ]);
    expect(loads).toEqual([
      { pduId: 'pa', feed: 'A', normalW: 300, failoverW: 500, ratedW: 3680 },
      { pduId: 'pb', feed: 'B', normalW: 250, failoverW: 450, ratedW: null },
    ]);
  });

  it('a cord with no free outlet loads no strip', () => {
    const loads = pduLoads(rack, [pdu('pa', 'A', 1), dev({ id: 'x', ru: 9, watts: 100 }), dev({ id: 'y', ru: 2, watts: 100 })]);
    expect(loads[0]!.normalW).toBe(100);
  });

  it('needs both halves of a rating', () => {
    expect(pduRatedWatts({ ratedAmps: 30, ratedVolts: 208 })).toBe(6240);
    expect(pduRatedWatts({ ratedAmps: 30, ratedVolts: 208, ratedPhases: 3 })).toBe(10808); // √3 × 30 × 208
    expect(pduRatedWatts({ ratedAmps: 16, ratedVolts: 400, ratedPhases: 3 })).toBe(11085);
    expect(pduRatedWatts({ ratedAmps: 30 })).toBeNull();
    expect(pduRatedWatts({ ratedAmps: 0, ratedVolts: 208 })).toBeNull();
  });
});

describe('feedFailure', () => {
  const r2: Rack = { id: 'r2', name: 'IDF', ruHeight: 12 };
  it('single-corded gear on the failed feed goes dark; dual-corded gear rides the other strip', () => {
    const f = feedFailure([rack], [pdu('pa', 'A'), pdu('pb', 'B'), dev({ id: 'a', ru: 3 }), dev({ id: 'ab', ru: 5, powerFeed: 'AB' }), dev({ id: 'b', ru: 7, powerFeed: 'B' })], 'A');
    expect([...f.dark]).toEqual([['a', 'single-corded']]);
    expect([...f.up].sort()).toEqual(['ab', 'b']);
    expect([...f.deadSources]).toEqual(['pa']);
    expect([...f.trippedPdus]).toEqual([]);
  });

  it('a rated strip that cannot carry the shifted load trips and takes its gear with it', () => {
    const gear = [dev({ id: 's1', ru: 3, watts: 900, powerFeed: 'AB' }), dev({ id: 's2', ru: 6, watts: 900, powerFeed: 'AB' }), dev({ id: 'b', ru: 9, watts: 100, powerFeed: 'B' })];
    const f = feedFailure([rack], [pdu('pa', 'A'), pdu('pb', 'B', 12, { ratedAmps: 8, ratedVolts: 200 }), ...gear], 'A');
    expect([...f.trippedPdus]).toEqual(['pb']); // 1.9 kW on 1.6 kW
    expect(Object.fromEntries(f.dark)).toEqual({ s1: 'strip-trips', s2: 'strip-trips', b: 'strip-trips' });
    // The other way round, the unrated A strip never trips.
    expect(feedFailure([rack], [pdu('pa', 'A'), pdu('pb', 'B', 12, { ratedAmps: 8, ratedVolts: 200 }), ...gear], 'B').dark.get('s1')).toBeUndefined();
  });

  it('a surviving cord with no PDU or no free outlet is no cord at all', () => {
    const noPdu = feedFailure([rack], [pdu('pa', 'A'), dev({ id: 's', ru: 3, powerFeed: 'AB' })], 'A');
    expect(noPdu.dark.get('s')).toBe('no-pdu');
    const full = feedFailure([rack], [pdu('pa', 'A'), pdu('pb', 'B', 1), dev({ id: 'x', ru: 9, powerFeed: 'AB' }), dev({ id: 'y', ru: 2, powerFeed: 'AB' })], 'A');
    expect(Object.fromEntries(full.dark)).toEqual({ y: 'no-outlet' });
  });

  it('a rack with no PDU drawn is modelled by feed alone', () => {
    const f = feedFailure([rack, r2], [dev({ id: 's', ru: 3, powerFeed: 'AB' }), dev({ id: 't', rackId: 'r2', ru: 3 })], 'A');
    expect([...f.up]).toEqual(['s']);
    expect([...f.dark]).toEqual([['t', 'single-corded']]);
  });

  it('sums it up in one line', () => {
    const gear = [dev({ id: 's1', ru: 3, watts: 900, powerFeed: 'AB' }), dev({ id: 's2', ru: 6, watts: 900, powerFeed: 'AB' }), dev({ id: 'a', ru: 9 })];
    const devices = [pdu('pa', 'A'), pdu('pb', 'B', 12, { ratedAmps: 8, ratedVolts: 200, name: 'PDU B' }), ...gear, dev({ id: 'x', rackId: 'r2', ru: 1, powerFeed: 'AB' })];
    expect(feedFailureSummary(feedFailure([rack, r2], devices, 'A'), devices)).toBe('If feed A fails: 3 units lose power (1 single-corded, 2 on a tripped strip) · PDU B trips · 1 stays up');
    expect(feedFailureSummary(feedFailure([rack], [pdu('pa', 'A'), pdu('pb', 'B'), dev({ id: 's', powerFeed: 'AB' })], 'B'), [])).toBe('If feed B fails: nothing loses power (1 unit stays up)');
  });
});

describe('power-strip schedule', () => {
  const gear = (w: number) => [dev({ id: 's1', ru: 3, watts: w, powerFeed: 'AB' }), dev({ id: 'a', ru: 8, watts: 100 })];
  const strips = (over: Partial<Device> = {}) => [pdu('pb', 'B', 12, { ratedAmps: 10, ratedVolts: 200, ...over }), pdu('pa', 'A')];

  it('lists each strip A first, with its load now and if the other feed fails', () => {
    expect(powerStripRows([rack], [...strips(), ...gear(1700)])).toEqual([
      { rack: 'MDF', pdu: 'pa', feed: 'A', rating: '', normal: '0.95 kW', failover: '1.80 kW', status: 'no rating' },
      { rack: 'MDF', pdu: 'pb', feed: 'B', rating: '10 A × 200 V · 2.00 kW', normal: '0.85 kW · 43%', failover: '1.70 kW · 85%', status: 'past 80% if A fails' },
    ]);
  });

  it('says when a strip is over its rating, trips on failover, or is fine', () => {
    const status = (w: number, over: Partial<Device> = {}) => powerStripRows([rack], [...strips(over), dev({ id: 's', ru: 3, watts: w, powerFeed: 'B' }), ...gear(0)])[1]!.status;
    expect(status(2500)).toBe('over its rating');
    expect(status(1000, { ratedPhases: 3 })).toBe('ok');
    expect(powerStripRows([rack], [...strips(), ...gear(2400)])[1]!.status).toBe('trips if A fails');
  });

  it('exports the same rows as CSV', () => {
    expect(powerStripCsv([rack], [...strips(), ...gear(1700)]).split('\n')).toEqual([
      'Rack,PDU / UPS,Feed,Rating,Load,If other feed fails,Status',
      '"MDF","pa","A","","0.95 kW","1.80 kW","no rating"',
      '"MDF","pb","B","10 A × 200 V · 2.00 kW","0.85 kW · 43%","1.70 kW · 85%","past 80% if A fails"',
    ]);
  });
});

describe('unitFate', () => {
  const rated = { ratedAmps: 8, ratedVolts: 200 }; // 1.6 kW
  const devices = [
    pdu('pa', 'A'),
    pdu('pb', 'B', 12, { ...rated, name: 'PDU B' }),
    dev({ id: 's1', name: 's1', ru: 3, watts: 900, powerFeed: 'AB' }),
    dev({ id: 's2', ru: 6, watts: 900, powerFeed: 'AB' }),
    dev({ id: 'a', ru: 9, watts: 100 }),
    dev({ id: 'pp', type: 'patch-panel', ru: 11 }),
  ];
  const fate = (id: string, f: 'A' | 'B', ds = devices) => unitFate(analyzeRackPower(rack, ds), id, f)?.text ?? null;

  it('says how gear fares, and why it goes dark', () => {
    expect(fate('s1', 'B')).toBe('stays up on pa');
    expect(fate('s1', 'A')).toBe('loses power: PDU B trips'); // 1.8 kW on 1.6 kW
    expect(fate('a', 'A')).toBe('loses power: single-corded on feed A');
    expect(fate('a', 'B')).toBe('stays up on pa');
    expect(fate('s1', 'A', [pdu('pa', 'A'), devices[2]!])).toBe('loses power: no PDU on feed B');
    expect(fate('pp', 'A')).toBeNull(); // no cord
  });

  it('says how a strip fares', () => {
    expect(fate('pa', 'A')).toBe('goes down with it');
    expect(fate('pb', 'A')).toBe('trips: 1.80 kW on 1.60 kW');
    expect(fate('pa', 'B')).toBe('carries 1.90 kW; add a rating to check it');
    expect(fate('pb', 'A', devices.filter((d) => d.id !== 's2'))).toBe('holds 0.90 kW (56%)');
  });

  it('a rack with no PDU is judged by feed alone', () => {
    expect(fate('s', 'A', [dev({ id: 's', powerFeed: 'AB' })])).toBe('stays up');
  });
});

describe('UPS backing a feed', () => {
  const ups = (id: string, feed: 'A' | 'B' | 'AB', ratedWatts?: number, over: Partial<Device> = {}) =>
    dev({ id, name: id, type: 'ups', ru: 1, ruSpan: 2, powerFeed: feed, ...(ratedWatts ? { ratedWatts } : {}), ...over });
  const gear = [dev({ id: 's1', ru: 5, watts: 600, powerFeed: 'AB' }), dev({ id: 's2', ru: 7, watts: 600, powerFeed: 'AB' }), dev({ id: 'a', ru: 9, watts: 100 })];
  const strips = [pdu('pa', 'A'), pdu('pb', 'B')];

  it('loads each feed a rated UPS backs, and skips unrated or dual-input ones', () => {
    expect(upsLoads(rack, [ups('ua', 'A', 1000), ups('ub', 'B', 1000), ...strips, ...gear])).toEqual([
      { feed: 'A', upsIds: ['ua'], normalW: 700, failoverW: 1300, ratedW: 1000 },
      { feed: 'B', upsIds: ['ub'], normalW: 600, failoverW: 1200, ratedW: 1000 },
    ]);
    expect(upsLoads(rack, [ups('u', 'A'), ups('x', 'AB', 3000), ...strips, ...gear])).toEqual([]);
    // Two UPSes on one feed share it.
    expect(upsLoads(rack, [ups('u1', 'B', 700), ups('u2', 'B', 700, { ru: 3 }), ...strips, ...gear])[0]).toMatchObject({ upsIds: ['u1', 'u2'], ratedW: 1400 });
  });

  it('an overloaded UPS takes its whole feed down when the other fails', () => {
    const devices = [ups('ua', 'A', 1000), ups('ub', 'B', 1000), ...strips, ...gear];
    const f = feedFailure([rack], devices, 'A');
    expect([...f.overloadedUps]).toEqual(['ub']); // 1.2 kW on 1 kW
    expect(Object.fromEntries(f.dark)).toEqual({ s1: 'ups-overload', s2: 'ups-overload', a: 'single-corded' });
    expect([...f.deadSources].sort()).toEqual(['pa', 'pb', 'ua']); // pb goes down behind ub
    expect(feedFailureSummary(f, devices)).toBe('If feed A fails: 3 units lose power (1 single-corded, 2 on an overloaded UPS) · ub overloads');
    expect(feedFailure([rack], [ups('ua', 'A', 1000), ups('ub', 'B', 2000), ...strips, ...gear], 'A').dark.size).toBe(1);
  });

  it('a rack with no PDU drawn still checks its UPS against every cord on the feed', () => {
    const f = feedFailure([rack], [ups('ub', 'B', 500), dev({ id: 's', ru: 5, watts: 600, powerFeed: 'AB' })], 'A');
    expect(Object.fromEntries(f.dark)).toEqual({ s: 'ups-overload' });
  });

  it('says how a UPS and the gear behind it fare', () => {
    const devices = [ups('ua', 'A', 1000), ups('ub', 'B', 1000), ...strips, ...gear];
    expect(unitFate(analyzeRackPower(rack, devices), 'ub', 'A')?.text ?? null).toBe('overloads: 1.20 kW on 1.00 kW');
    expect(unitFate(analyzeRackPower(rack, devices), 'ub', 'B')?.text ?? null).toBe('goes down with it');
    expect(unitFate(analyzeRackPower(rack, devices), 's1', 'A')?.text ?? null).toBe('loses power: ub overloads');
    expect(unitFate(analyzeRackPower(rack, [ups('ua', 'A', 2000), ...strips, ...gear]), 'ua', 'B')?.text ?? null).toBe('holds 1.30 kW (65%)');
    expect(unitFate(analyzeRackPower(rack, [ups('ua', 'A'), ...strips, ...gear]), 'ua', 'B')?.text ?? null).toBeNull(); // unrated
  });

  it('lists the UPS-backed feeds in the power-strip schedule', () => {
    const rows = powerStripRows([rack], [ups('ub', 'B', 1000), ...strips, ...gear]);
    expect(rows.at(-1)).toEqual({ rack: 'MDF', pdu: 'ub', feed: 'B', rating: 'UPS · 1.00 kW output', normal: '0.60 kW · 60%', failover: '1.20 kW · 120%', status: 'overloads if A fails' });
  });
});

describe('review fixes', () => {
  it('a dual-corded unit with one cord unplugged puts its full draw on the other strip', () => {
    const l = pduLoads(rack, [pdu('pa', 'A', 12, { ratedAmps: 10, ratedVolts: 120 }), dev({ id: 's', ru: 5, watts: 2000, powerFeed: 'AB' })]);
    expect(l[0]).toMatchObject({ normalW: 2000, failoverW: 2000 }); // no PDU on B: it's all on A now
    expect(loadStatus({ ...l[0]!, ratedW: l[0]!.ratedW }, 'trips')).toBe('over its rating');
  });

  it('a strip behind an overloaded UPS goes down, and says so', () => {
    const devices = [
      dev({ id: 'ub', name: 'ups-b', type: 'ups', ru: 1, ruSpan: 2, powerFeed: 'B', ratedWatts: 1000 }),
      pdu('pa', 'A'), pdu('pb', 'B', 12, { ratedAmps: 30, ratedVolts: 208 }),
      dev({ id: 's', ru: 6, watts: 2000, powerFeed: 'AB' }),
    ];
    const power = analyzeRackPower(rack, devices);
    expect(unitFate(power, 'pb', 'A')).toEqual({ text: 'goes down: ups-b overloads', bad: true });
    expect(unitFate(power, 'pa', 'A')).toEqual({ text: 'goes down with it', bad: false });
    expect(unitFate(power, 'ub', 'A')).toEqual({ text: 'overloads: 2.00 kW on 1.00 kW', bad: true });
  });

  it('a PSU shelf is not a UPS, and its watts are not an output rating', () => {
    expect(upsLoads(rack, [dev({ id: 'psu', name: 'PSU shelf', type: 'ups', ru: 1, ruSpan: 2, ratedWatts: 3000 }), dev({ id: 's', ru: 5, watts: 600 })])).toEqual([]);
  });

  it('a unit with no live cord even now is unpowered, not lost to the failure', () => {
    const devices = [pdu('pa', 'A', 1), dev({ id: 'x', ru: 9, watts: 100 }), dev({ id: 'y', ru: 2, watts: 100 })];
    const f = feedFailure([rack], devices, 'B');
    expect(f.dark.get('y')).toBe('unpowered');
    expect(feedFailureSummary(f, devices)).toBe('If feed B fails: nothing loses power (1 unit stays up) · 1 has no power even now');
    expect(unitFate(analyzeRackPower(rack, devices), 'y', 'B')).toEqual({ text: 'no power even now: none of its cords reaches an outlet', bad: true });
  });

  it('two UPSes sharing a feed read as plural', () => {
    const ups = (id: string, ru: number) => dev({ id, name: id, type: 'ups', ru, ruSpan: 2, powerFeed: 'B', ratedWatts: 1000 });
    const devices = [ups('u1', 1), ups('u2', 3), ups('u3', 5), dev({ id: 's', ru: 9, watts: 600, powerFeed: 'AB' })];
    expect(unitFate(analyzeRackPower(rack, devices), 'u1', 'A')?.text).toBe('holds 0.60 kW (20%) with 2 other UPSes');
  });
});
