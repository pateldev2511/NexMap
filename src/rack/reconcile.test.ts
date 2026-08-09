/**
 * Physical ↔ logical reconciliation (W5). The delta between what was DESIGNED
 * (`links[]`) and what is PATCHED (`rackCables[]` + pass-throughs).
 *
 * The scope rule gets the most attention here: getting it wrong would flag every
 * link in a rack-free diagram as "not cabled" and bury the real findings.
 */
import { describe, expect, it } from 'vitest';
import { enumerateCircuits, isClean, reconcile } from './reconcile';
import type { Device, DeviceType, Interface, Link, RackCable } from '@/model/types';

let seq = 0;

const iface = (id: string, partial: Partial<Interface> = {}): Interface => ({
  id,
  name: id,
  ...partial,
});

/** Rack-mounted by default — the reconciler only considers mounted gear. */
const device = (
  id: string,
  type: DeviceType,
  interfaces: Interface[] = [],
  partial: Partial<Device> = {},
): Device => ({
  id,
  kind: 'device',
  type,
  name: id.toUpperCase(),
  x: 0,
  y: 0,
  width: 56,
  height: 40,
  layerId: 'L',
  rackId: 'rk1',
  ru: 1,
  ruSpan: 1,
  interfaces,
  ...partial,
});

/** Same, but NOT mounted — out of the reconciler's scope. */
const unmounted = (id: string, type: DeviceType, interfaces: Interface[] = []): Device =>
  device(id, type, interfaces, { rackId: undefined, ru: undefined });

const cable = (a: [string, string], b: [string, string], id?: string): RackCable => ({
  id: id ?? `c${++seq}`,
  aEnd: { deviceId: a[0], ifaceId: a[1] },
  bEnd: { deviceId: b[0], ifaceId: b[1] },
  color: '#22d3ee',
});

const link = (
  id: string,
  sourceId: string,
  targetId: string,
  partial: Partial<Link> = {},
): Link => ({ id, kind: 'link', sourceId, targetId, layerId: 'L', ...partial });

/** A patch panel with `n` correctly coupled front/rear pairs. */
const panel = (id: string, n: number): Device => {
  const ifaces: Interface[] = [];
  for (let i = 1; i <= n; i++) {
    ifaces.push(iface(`${id}f${i}`, { side: 'front', throughTo: `${id}r${i}` }));
    ifaces.push(iface(`${id}r${i}`, { side: 'rear', throughTo: `${id}f${i}` }));
  }
  return device(id, 'patch-panel', ifaces);
};

describe('enumerateCircuits', () => {
  it('finds a direct cable as a two-hop circuit', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const srv = device('srv', 'server', [iface('n1')]);
    const circuits = enumerateCircuits([sw, srv], [cable(['sw', 'p1'], ['srv', 'n1'])]);
    expect(circuits).toHaveLength(1);
    expect(circuits[0]!.hops).toBe(2);
    expect(circuits[0]!.cableIds).toHaveLength(1);
  });

  it('walks THROUGH a panel and reports the endpoints, not the panel', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const pp = panel('pp', 1);
    const wall = device('wall', 'generic', [iface('w1')]);
    const circuits = enumerateCircuits(
      [sw, pp, wall],
      [cable(['sw', 'p1'], ['pp', 'ppf1']), cable(['pp', 'ppr1'], ['wall', 'w1'])],
    );
    expect(circuits).toHaveLength(1);
    const ends = [circuits[0]!.a.deviceId, circuits[0]!.b.deviceId].sort();
    expect(ends).toEqual(['sw', 'wall']);
    expect(circuits[0]!.hops).toBe(4);
    expect(circuits[0]!.cableIds).toHaveLength(2);
  });

  it('dedupes — a run found from both ends is ONE circuit', () => {
    const a = device('a', 'switch', [iface('p1')]);
    const b = device('b', 'switch', [iface('p1')]);
    expect(enumerateCircuits([a, b], [cable(['a', 'p1'], ['b', 'p1'])])).toHaveLength(1);
  });

  it('panel-to-panel cabling with no gear on either end is NOT a circuit', () => {
    const a = panel('a', 1);
    const b = panel('b', 1);
    expect(enumerateCircuits([a, b], [cable(['a', 'ar1'], ['b', 'bf1'])])).toEqual([]);
  });

  it('an incomplete patch yields no circuit', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const pp = device('pp', 'patch-panel', [iface('f1')]); // never punched through
    expect(enumerateCircuits([sw, pp], [cable(['sw', 'p1'], ['pp', 'f1'])])).toEqual([]);
  });

  it('finds several independent circuits', () => {
    const a = device('a', 'switch', [iface('p1'), iface('p2')]);
    const b = device('b', 'server', [iface('n1')]);
    const c = device('c', 'server', [iface('n1')]);
    const circuits = enumerateCircuits(
      [a, b, c],
      [cable(['a', 'p1'], ['b', 'n1']), cable(['a', 'p2'], ['c', 'n1'])],
    );
    expect(circuits).toHaveLength(2);
  });

  it('is empty with no cables', () => {
    expect(enumerateCircuits([device('a', 'switch', [iface('p1')])], [])).toEqual([]);
  });
});

describe('reconcile — the three-way delta', () => {
  it('a designed link with matching cabling is BACKED', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const srv = device('srv', 'server', [iface('n1')]);
    const r = reconcile(
      [sw, srv],
      [link('l1', 'sw', 'srv')],
      [cable(['sw', 'p1'], ['srv', 'n1'])],
    );
    expect(r.backed.map((b) => b.linkId)).toEqual(['l1']);
    expect(r.unbacked).toEqual([]);
    expect(r.undocumented).toEqual([]);
    expect(isClean(r)).toBe(true);
  });

  it('backs a link through a patch panel, not just a direct cable', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const pp = panel('pp', 1);
    const wall = device('wall', 'generic', [iface('w1')]);
    const r = reconcile(
      [sw, pp, wall],
      [link('l1', 'sw', 'wall')],
      [cable(['sw', 'p1'], ['pp', 'ppf1']), cable(['pp', 'ppr1'], ['wall', 'w1'])],
    );
    expect(r.backed).toHaveLength(1);
    expect(r.backed[0]!.circuit.hops).toBe(4);
  });

  it('a designed link with NO cabling at all is unbacked as no-cable', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const srv = device('srv', 'server', [iface('n1')]);
    const r = reconcile([sw, srv], [link('l1', 'sw', 'srv')], []);
    expect(r.unbacked).toEqual([{ linkId: 'l1', reason: 'no-cable' }]);
  });

  it('a designed link whose patch stops short is unbacked as incomplete', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const pp = device('pp', 'patch-panel', [iface('f1')]); // not punched through
    const wall = device('wall', 'generic', [iface('w1')]);
    const r = reconcile(
      [sw, pp, wall],
      [link('l1', 'sw', 'wall')],
      [cable(['sw', 'p1'], ['pp', 'f1'])],
    );
    expect(r.unbacked).toEqual([{ linkId: 'l1', reason: 'incomplete' }]);
  });

  it('cabling with no designed link is UNDOCUMENTED', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const srv = device('srv', 'server', [iface('n1')]);
    const r = reconcile([sw, srv], [], [cable(['sw', 'p1'], ['srv', 'n1'])]);
    expect(r.undocumented).toHaveLength(1);
    expect(r.backed).toEqual([]);
    expect(isClean(r)).toBe(false);
  });

  it('matches one-to-one: two cables, one link → one backed, one undocumented', () => {
    const sw = device('sw', 'switch', [iface('p1'), iface('p2')]);
    const srv = device('srv', 'server', [iface('n1'), iface('n2')]);
    const r = reconcile(
      [sw, srv],
      [link('l1', 'sw', 'srv')],
      [cable(['sw', 'p1'], ['srv', 'n1']), cable(['sw', 'p2'], ['srv', 'n2'])],
    );
    expect(r.backed).toHaveLength(1);
    expect(r.undocumented).toHaveLength(1);
  });

  it('two parallel links and two cables both back cleanly', () => {
    const sw = device('sw', 'switch', [iface('p1'), iface('p2')]);
    const srv = device('srv', 'server', [iface('n1'), iface('n2')]);
    const r = reconcile(
      [sw, srv],
      [link('l1', 'sw', 'srv'), link('l2', 'sw', 'srv')],
      [cable(['sw', 'p1'], ['srv', 'n1']), cable(['sw', 'p2'], ['srv', 'n2'])],
    );
    expect(r.backed).toHaveLength(2);
    expect(r.undocumented).toEqual([]);
    expect(isClean(r)).toBe(true);
  });

  it('matches regardless of link direction', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const srv = device('srv', 'server', [iface('n1')]);
    const r = reconcile(
      [sw, srv],
      [link('l1', 'srv', 'sw')], // reversed vs the cable
      [cable(['sw', 'p1'], ['srv', 'n1'])],
    );
    expect(r.backed).toHaveLength(1);
  });
});

describe('port-level matching', () => {
  it('a link naming both ports matches the circuit on those exact ports', () => {
    const sw = device('sw', 'switch', [iface('p1'), iface('p2')]);
    const srv = device('srv', 'server', [iface('n1'), iface('n2')]);
    const r = reconcile(
      [sw, srv],
      [link('l1', 'sw', 'srv', { sourceIfaceId: 'p2', targetIfaceId: 'n2' })],
      [cable(['sw', 'p2'], ['srv', 'n2'])],
    );
    expect(r.backed).toHaveLength(1);
  });

  it('the DEVICES matching is not enough when the link names the wrong ports', () => {
    const sw = device('sw', 'switch', [iface('p1'), iface('p2')]);
    const srv = device('srv', 'server', [iface('n1'), iface('n2')]);
    const r = reconcile(
      [sw, srv],
      // Documented on p1/n1, but actually patched p2→n2.
      [link('l1', 'sw', 'srv', { sourceIfaceId: 'p1', targetIfaceId: 'n1' })],
      [cable(['sw', 'p2'], ['srv', 'n2'])],
    );
    expect(r.backed).toEqual([]);
    expect(r.unbacked).toEqual([{ linkId: 'l1', reason: 'incomplete' }]);
    expect(r.undocumented).toHaveLength(1);
  });

  it('falls back to device matching when only one end names a port', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const srv = device('srv', 'server', [iface('n1')]);
    const r = reconcile(
      [sw, srv],
      [link('l1', 'sw', 'srv', { sourceIfaceId: 'p1' })],
      [cable(['sw', 'p1'], ['srv', 'n1'])],
    );
    expect(r.backed).toHaveLength(1);
  });
});

describe('scope rule — rack-free diagrams must stay quiet', () => {
  it('a link between two UNMOUNTED devices is out of scope, not unbacked', () => {
    const a = unmounted('a', 'router');
    const b = unmounted('b', 'switch');
    const r = reconcile([a, b], [link('l1', 'a', 'b')], []);
    expect(r.outOfScope).toBe(1);
    expect(r.unbacked).toEqual([]);
    expect(isClean(r)).toBe(true);
  });

  it('an entire rack-free topology reports nothing at all', () => {
    const devices = ['a', 'b', 'c', 'd'].map((id) => unmounted(id, 'switch'));
    const links = [link('l1', 'a', 'b'), link('l2', 'b', 'c'), link('l3', 'c', 'd')];
    const r = reconcile(devices, links, []);
    expect(r.outOfScope).toBe(3);
    expect(isClean(r)).toBe(true);
  });

  it('a link with only ONE endpoint mounted is out of scope', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const laptop = unmounted('laptop', 'end-user');
    const r = reconcile([sw, laptop], [link('l1', 'sw', 'laptop')], []);
    expect(r.outOfScope).toBe(1);
    expect(r.unbacked).toEqual([]);
  });

  it('a link referencing a device that does not exist is out of scope, not a crash', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const r = reconcile([sw], [link('l1', 'sw', 'ghost')], []);
    expect(r.outOfScope).toBe(1);
    expect(r.unbacked).toEqual([]);
  });

  it('mounted gear IS in scope even with no cabling', () => {
    const a = device('a', 'switch', [iface('p1')]);
    const b = device('b', 'server', [iface('n1')]);
    const r = reconcile([a, b], [link('l1', 'a', 'b')], []);
    expect(r.outOfScope).toBe(0);
    expect(r.unbacked).toHaveLength(1);
  });
});

describe('dangling cables', () => {
  it('counts a cable that no complete circuit traverses', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const pp = device('pp', 'patch-panel', [iface('f1')]); // not punched through
    const r = reconcile([sw, pp], [], [cable(['sw', 'p1'], ['pp', 'f1'])]);
    expect(r.danglingCables).toBe(1);
    expect(r.undocumented).toEqual([]);
  });

  it('counts nothing when every cable is part of a circuit', () => {
    const sw = device('sw', 'switch', [iface('p1')]);
    const pp = panel('pp', 1);
    const wall = device('wall', 'generic', [iface('w1')]);
    const r = reconcile(
      [sw, pp, wall],
      [link('l1', 'sw', 'wall')],
      [cable(['sw', 'p1'], ['pp', 'ppf1']), cable(['pp', 'ppr1'], ['wall', 'w1'])],
    );
    expect(r.danglingCables).toBe(0);
  });
});

describe('empty and degenerate input', () => {
  it('an empty project is clean', () => {
    const r = reconcile([], [], []);
    expect(r).toEqual({
      backed: [],
      unbacked: [],
      undocumented: [],
      power: [],
      outOfScope: 0,
      danglingCables: 0,
    });
    expect(isClean(r)).toBe(true);
  });

  it('does not throw on a loop in the cabling', () => {
    const pp = panel('pp', 1);
    expect(() => reconcile([pp], [], [cable(['pp', 'ppr1'], ['pp', 'ppf1'])])).not.toThrow();
  });

  it('is deterministic across repeated runs', () => {
    const sw = device('sw', 'switch', [iface('p1'), iface('p2')]);
    const a = device('a', 'server', [iface('n1')]);
    const b = device('b', 'server', [iface('n1')]);
    const cables = [cable(['sw', 'p1'], ['a', 'n1']), cable(['sw', 'p2'], ['b', 'n1'])];
    const first = reconcile([sw, a, b], [], cables);
    const second = reconcile([sw, a, b], [], cables);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('power feeds are held apart from data findings', () => {
  /** A rack UPS with C13 outlets, as the library preset creates it. */
  const ups = (id: string, outlets: number): Device =>
    device(
      id,
      'ups',
      Array.from({ length: outlets }, (_, i) => iface(`${id}o${i + 1}`)),
      { ruSpan: 2 },
    );

  it('a UPS-to-server run is reported as POWER, not as undocumented cabling', () => {
    // Power is not modelled in links[], so counting every feed as a discrepancy
    // would bury the real findings.
    const u = ups('ups1', 4);
    const srv = device('srv', 'server', [iface('psu1')]);
    const r = reconcile([u, srv], [], [cable(['ups1', 'ups1o1'], ['srv', 'psu1'])]);
    expect(r.power).toHaveLength(1);
    expect(r.undocumented).toEqual([]);
    expect(isClean(r)).toBe(true);
  });

  it('a data run alongside a power run still reports the data one', () => {
    const u = ups('ups1', 4);
    const sw = device('sw', 'switch', [iface('p1')]);
    const srv = device('srv', 'server', [iface('nic1'), iface('psu1')]);
    const r = reconcile(
      [u, sw, srv],
      [],
      [cable(['ups1', 'ups1o1'], ['srv', 'psu1']), cable(['sw', 'p1'], ['srv', 'nic1'])],
    );
    expect(r.power).toHaveLength(1);
    expect(r.undocumented).toHaveLength(1);
    expect(isClean(r)).toBe(false);
  });

  it('an explicit non-power media on a UPS port is treated as DATA', () => {
    // A UPS network-management card is an ethernet port, not an outlet.
    const u = device('ups1', 'ups', [iface('nmc', { kind: 'RJ45' })], { ruSpan: 2 });
    const sw = device('sw', 'switch', [iface('p1')]);
    const r = reconcile([u, sw], [], [cable(['ups1', 'nmc'], ['sw', 'p1'])]);
    expect(r.power).toEqual([]);
    expect(r.undocumented).toHaveLength(1);
  });

  it('a documented power link is still BACKED rather than double-counted', () => {
    const u = ups('ups1', 2);
    const srv = device('srv', 'server', [iface('psu1')]);
    const r = reconcile(
      [u, srv],
      [link('l1', 'ups1', 'srv')],
      [cable(['ups1', 'ups1o1'], ['srv', 'psu1'])],
    );
    expect(r.backed).toHaveLength(1);
    expect(r.power).toEqual([]);
    expect(r.undocumented).toEqual([]);
  });
});
