/**
 * Port coupling integrity (W3). Faults are reported, never repaired — E1-E4.
 */
import { describe, expect, it } from 'vitest';
import { coupledPartner, couplingProblems, isCoupled } from './coupling';
import type { Device, DeviceType, Interface } from './types';

const iface = (id: string, partial: Partial<Interface> = {}): Interface => ({
  id,
  name: id,
  ...partial,
});

const device = (id: string, type: DeviceType, interfaces: Interface[] = []): Device => ({
  id,
  kind: 'device',
  type,
  name: id.toUpperCase(),
  x: 0,
  y: 0,
  width: 56,
  height: 40,
  layerId: 'L',
  interfaces,
});

/** Front/rear pair on one panel, correctly coupled. */
const panel = (id: string, pairs: number): Device => {
  const ifaces: Interface[] = [];
  for (let i = 1; i <= pairs; i++) {
    const f = `${id}f${i}`;
    const r = `${id}r${i}`;
    ifaces.push(iface(f, { side: 'front', throughTo: r }));
    ifaces.push(iface(r, { side: 'rear', throughTo: f }));
  }
  return device(id, 'patch-panel', ifaces);
};

describe('isCoupled', () => {
  it('is true only for a sound symmetric pair', () => {
    const p = panel('pp', 1);
    expect(isCoupled(p, p.interfaces![0]!)).toBe(true);
    const broken = device('x', 'patch-panel', [iface('a', { throughTo: 'b' }), iface('b')]);
    expect(isCoupled(broken, broken.interfaces![0]!)).toBe(false);
  });
});

describe('coupledPartner', () => {
  it('resolves a sound symmetric pair', () => {
    const p = panel('pp', 1);
    expect(coupledPartner(p, p.interfaces![0]!)?.id).toBe('ppr1');
  });

  it('E8: an unpaired port has no partner and that is NOT an error', () => {
    const p = device('pp', 'patch-panel', [iface('a')]);
    expect(coupledPartner(p, p.interfaces![0]!)).toBeUndefined();
  });

  it('E4: refuses a self-reference', () => {
    const p = device('pp', 'patch-panel', [iface('a', { throughTo: 'a' })]);
    expect(coupledPartner(p, p.interfaces![0]!)).toBeUndefined();
  });

  it('E3: refuses a dangling target', () => {
    const p = device('pp', 'patch-panel', [iface('a', { throughTo: 'ghost' })]);
    expect(coupledPartner(p, p.interfaces![0]!)).toBeUndefined();
  });

  it('E1: refuses an asymmetric pair rather than guessing', () => {
    const p = device('pp', 'patch-panel', [iface('a', { throughTo: 'b' }), iface('b')]);
    expect(coupledPartner(p, p.interfaces![0]!)).toBeUndefined();
  });
});

describe('couplingProblems', () => {
  it('a sound panel reports nothing', () => {
    expect(couplingProblems([panel('pp', 24)])).toEqual([]);
  });

  it('E8: unpaired ports report nothing', () => {
    expect(couplingProblems([device('pp', 'patch-panel', [iface('a'), iface('b')])])).toEqual([]);
  });

  it('E4: flags a self-reference', () => {
    const p = device('pp', 'patch-panel', [iface('a', { throughTo: 'a' })]);
    expect(couplingProblems([p])).toEqual([
      { kind: 'self', deviceId: 'pp', ifaceId: 'a', targetId: 'a' },
    ]);
  });

  it('E3: flags a target that exists nowhere', () => {
    const p = device('pp', 'patch-panel', [iface('a', { throughTo: 'ghost' })]);
    expect(couplingProblems([p])[0]!.kind).toBe('missing');
  });

  it('E2: distinguishes a cross-device target from a missing one', () => {
    const p = device('pp', 'patch-panel', [iface('a', { throughTo: 'other1' })]);
    const q = device('q', 'patch-panel', [iface('other1')]);
    expect(couplingProblems([p, q])[0]!.kind).toBe('cross-device');
  });

  it('E1: flags exactly one issue for a one-sided claim', () => {
    const p = device('pp', 'patch-panel', [iface('a', { throughTo: 'b' }), iface('b')]);
    const problems = couplingProblems([p]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEqual({
      kind: 'asymmetric',
      deviceId: 'pp',
      ifaceId: 'a',
      targetId: 'b',
    });
  });

  // The case the first implementation got wrong: B points at C, so A's claim on B
  // is unreciprocated and must still be reported regardless of id ordering.
  it('E1: flags a claim whose target is soundly paired with someone else', () => {
    const p = device('pp', 'patch-panel', [
      iface('zzz', { throughTo: 'b' }), // id sorts AFTER its target
      iface('b', { throughTo: 'c' }),
      iface('c', { throughTo: 'b' }),
    ]);
    const problems = couplingProblems([p]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.ifaceId).toBe('zzz');
  });

  it('E1: a three-way mis-pointing reports all three unreciprocated claims', () => {
    const p = device('pp', 'patch-panel', [
      iface('a', { throughTo: 'b' }),
      iface('b', { throughTo: 'c' }),
      iface('c', { throughTo: 'a' }),
    ]);
    expect(couplingProblems([p])).toHaveLength(3);
  });

  it('scans every device', () => {
    const bad = device('x', 'patch-panel', [iface('a', { throughTo: 'a' })]);
    expect(couplingProblems([panel('ok', 2), bad])).toHaveLength(1);
  });
});
