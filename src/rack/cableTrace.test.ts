/**
 * Cable tracing (W3). Every E-row from the plan's edge-case contract gets a test,
 * plus property tests asserting the walk is total and reversible.
 */
import { describe, expect, it } from 'vitest';
import { coupledPartner } from '@/model/coupling';
import {
  MAX_HOPS,
  isTransitive,
  planPassThroughPairs,
  traceEndpoint,
  traceFrom,
} from './cableTrace';
import type { Device, DeviceType, Interface, RackCable } from '@/model/types';

let seq = 0;
const iface = (id: string, partial: Partial<Interface> = {}): Interface => ({
  id,
  name: id,
  ...partial,
});

const device = (
  id: string,
  type: DeviceType,
  interfaces: Interface[] = [],
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
  interfaces,
});

const cable = (a: [string, string], b: [string, string], id?: string): RackCable => ({
  id: id ?? `c${++seq}`,
  aEnd: { deviceId: a[0], ifaceId: a[1] },
  bEnd: { deviceId: b[0], ifaceId: b[1] },
  color: '#22d3ee',
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

const ports = (r: { hops: { deviceId: string; ifaceId: string }[] }) =>
  r.hops.map((h) => `${h.deviceId}/${h.ifaceId}`);

describe('isTransitive (SD-12)', () => {
  it('only patch panels are transitive', () => {
    expect(isTransitive('patch-panel')).toBe(true);
  });

  it('endpoints are not — a trace must never walk THROUGH a switch', () => {
    for (const t of ['switch', 'router', 'server', 'firewall', 'generic'] as DeviceType[]) {
      expect(isTransitive(t)).toBe(false);
    }
  });
});

describe('coupledPartner', () => {
  it('resolves a sound symmetric pair', () => {
    const p = panel('pp', 1);
    const front = p.interfaces!.find((i) => i.id === 'ppf1')!;
    expect(coupledPartner(p, front)?.id).toBe('ppr1');
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
    const p = device('pp', 'patch-panel', [
      iface('a', { throughTo: 'b' }),
      iface('b'), // does not point back
    ]);
    expect(coupledPartner(p, p.interfaces![0]!)).toBeUndefined();
  });
});

describe('traceFrom — the happy path', () => {
  it('switch → panel → wall port terminates at the endpoint', () => {
    // SW1/1 --- PPf1 [panel] PPr1 --- WALL/1
    const sw = device('sw', 'switch', [iface('sw1')]);
    const pp = panel('pp', 1);
    const wall = device('wall', 'generic', [iface('w1')]);
    const cables = [cable(['sw', 'sw1'], ['pp', 'ppf1']), cable(['pp', 'ppr1'], ['wall', 'w1'])];

    const r = traceFrom([sw, pp, wall], cables, { deviceId: 'sw', ifaceId: 'sw1' });
    expect(r.end).toBe('terminated');
    expect(ports(r)).toEqual(['sw/sw1', 'pp/ppf1', 'pp/ppr1', 'wall/w1']);
    expect(r.hops.map((h) => h.via)).toEqual(['start', 'cable', 'coupling', 'cable']);
    expect(traceEndpoint(r)?.deviceId).toBe('wall');
  });

  it('walks TWO panels in series', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const a = panel('a', 1);
    const b = panel('b', 1);
    const ap = device('ap', 'access-point', [iface('e0')]);
    const cables = [
      cable(['sw', 'sw1'], ['a', 'af1']),
      cable(['a', 'ar1'], ['b', 'bf1']),
      cable(['b', 'br1'], ['ap', 'e0']),
    ];
    const r = traceFrom([sw, a, b, ap], cables, { deviceId: 'sw', ifaceId: 'sw1' });
    expect(r.end).toBe('terminated');
    expect(ports(r)).toEqual(['sw/sw1', 'a/af1', 'a/ar1', 'b/bf1', 'b/br1', 'ap/e0']);
  });

  it('a direct switch-to-server cable terminates in one hop', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const srv = device('srv', 'server', [iface('nic0')]);
    const r = traceFrom([sw, srv], [cable(['sw', 'sw1'], ['srv', 'nic0'])], {
      deviceId: 'sw',
      ifaceId: 'sw1',
    });
    expect(r.end).toBe('terminated');
    expect(ports(r)).toEqual(['sw/sw1', 'srv/nic0']);
  });

  it('E10: a cross-rack cable is an ordinary edge', () => {
    // Rack membership lives on the device, not the cable — nothing special to do,
    // but assert it so a future "same-rack only" optimisation can't break tracing.
    const sw = { ...device('sw', 'switch', [iface('sw1')]), rackId: 'r1', ru: 1 };
    const srv = { ...device('srv', 'server', [iface('nic0')]), rackId: 'r2', ru: 1 };
    const r = traceFrom([sw, srv], [cable(['sw', 'sw1'], ['srv', 'nic0'])], {
      deviceId: 'sw',
      ifaceId: 'sw1',
    });
    expect(r.end).toBe('terminated');
  });
});

describe('traceFrom — stopping conditions', () => {
  it('E11: a port with nothing plugged in yields just itself, open', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const r = traceFrom([sw], [], { deviceId: 'sw', ifaceId: 'sw1' });
    expect(r.end).toBe('open');
    expect(ports(r)).toEqual(['sw/sw1']);
  });

  it('a panel port that is not punched through dead-ends open', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const pp = device('pp', 'patch-panel', [iface('f1')]); // no throughTo
    const r = traceFrom([sw, pp], [cable(['sw', 'sw1'], ['pp', 'f1'])], {
      deviceId: 'sw',
      ifaceId: 'sw1',
    });
    expect(r.end).toBe('open');
    expect(ports(r)).toEqual(['sw/sw1', 'pp/f1']);
  });

  it('E1: an asymmetric coupling stops the trace open, it does not guess', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const pp = device('pp', 'patch-panel', [
      iface('f1', { throughTo: 'r1' }),
      iface('r1'), // broken: no way back
    ]);
    const wall = device('wall', 'generic', [iface('w1')]);
    const cables = [cable(['sw', 'sw1'], ['pp', 'f1']), cable(['pp', 'r1'], ['wall', 'w1'])];
    const r = traceFrom([sw, pp, wall], cables, { deviceId: 'sw', ifaceId: 'sw1' });
    expect(r.end).toBe('open');
    // Crucially it did NOT reach the wall port through the broken pair.
    expect(ports(r)).toEqual(['sw/sw1', 'pp/f1']);
  });

  it('E2: a cross-device throughTo is ignored, not followed', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    // pp/f1 points at an interface belonging to `other` — must not teleport.
    const pp = device('pp', 'patch-panel', [iface('f1', { throughTo: 'o1' })]);
    const other = device('other', 'patch-panel', [iface('o1', { throughTo: 'f1' })]);
    const r = traceFrom([sw, pp, other], [cable(['sw', 'sw1'], ['pp', 'f1'])], {
      deviceId: 'sw',
      ifaceId: 'sw1',
    });
    expect(r.end).toBe('open');
    expect(ports(r)).toEqual(['sw/sw1', 'pp/f1']);
  });

  it('E6: two cables on one port is ambiguous, never first-wins', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const a = device('a', 'server', [iface('n1')]);
    const b = device('b', 'server', [iface('n1')]);
    const cables = [cable(['sw', 'sw1'], ['a', 'n1']), cable(['sw', 'sw1'], ['b', 'n1'])];
    const r = traceFrom([sw, a, b], cables, { deviceId: 'sw', ifaceId: 'sw1' });
    expect(r.end).toBe('ambiguous');
    expect(ports(r)).toEqual(['sw/sw1']);
  });

  it('E6: ambiguity detected mid-chain, not just at the start', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const pp = panel('pp', 1);
    const a = device('a', 'server', [iface('n1')]);
    const b = device('b', 'server', [iface('n1')]);
    const cables = [
      cable(['sw', 'sw1'], ['pp', 'ppf1']),
      cable(['pp', 'ppr1'], ['a', 'n1']),
      cable(['pp', 'ppr1'], ['b', 'n1']),
    ];
    const r = traceFrom([sw, pp, a, b], cables, { deviceId: 'sw', ifaceId: 'sw1' });
    expect(r.end).toBe('ambiguous');
    expect(ports(r)).toEqual(['sw/sw1', 'pp/ppf1', 'pp/ppr1']);
  });

  it('E5: a cable looping back to the start is reported, not spun on', () => {
    // pp1 front→rear, cabled rear→front of itself: a closed ring.
    const pp = panel('pp', 1);
    const r = traceFrom([pp], [cable(['pp', 'ppr1'], ['pp', 'ppf1'])], {
      deviceId: 'pp',
      ifaceId: 'ppf1',
    });
    expect(r.end).toBe('loop');
  });

  it('E5: a longer ring of panels terminates', () => {
    const a = panel('a', 1);
    const b = panel('b', 1);
    const cables = [cable(['a', 'ar1'], ['b', 'bf1']), cable(['b', 'br1'], ['a', 'af1'])];
    const r = traceFrom([a, b], cables, { deviceId: 'a', ifaceId: 'af1' });
    expect(r.end).toBe('loop');
    expect(r.hops.length).toBeLessThan(MAX_HOPS);
  });

  it('E5: a degenerate cable with both ends on one port loops', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const r = traceFrom([sw], [cable(['sw', 'sw1'], ['sw', 'sw1'])], {
      deviceId: 'sw',
      ifaceId: 'sw1',
    });
    expect(r.end).toBe('loop');
  });

  it('E7: a chain longer than MAX_HOPS is depth-capped, never exceeding it', () => {
    // A long daisy-chain of panels, each contributing 2 hops (front + rear).
    // Start at p0's REAR, since that is the end carrying the first cable.
    const panels: Device[] = [];
    const cables: RackCable[] = [];
    const n = MAX_HOPS;
    for (let i = 0; i < n; i++) panels.push(panel(`p${i}`, 1));
    for (let i = 0; i < n - 1; i++) {
      cables.push(cable([`p${i}`, `p${i}r1`], [`p${i + 1}`, `p${i + 1}f1`]));
    }
    const r = traceFrom(panels, cables, { deviceId: 'p0', ifaceId: 'p0r1' });
    expect(r.end).toBe('depth-capped');
    // The cap is an INVARIANT, not an approximation: an iteration adds two hops,
    // so a loop-top-only check would overshoot to MAX_HOPS + 1.
    expect(r.hops).toHaveLength(MAX_HOPS);
  });

  it('E9: a start port whose device is gone traces nowhere', () => {
    const r = traceFrom([], [], { deviceId: 'ghost', ifaceId: 'x' });
    expect(r).toEqual({ hops: [], end: 'open' });
  });

  it('E9: a start port whose interface is gone traces nowhere', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const r = traceFrom([sw], [], { deviceId: 'sw', ifaceId: 'deleted' });
    expect(r).toEqual({ hops: [], end: 'open' });
  });

  it('E9: a cable pointing at deleted gear records the hop then stops', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    const r = traceFrom([sw], [cable(['sw', 'sw1'], ['gone', 'x'])], {
      deviceId: 'sw',
      ifaceId: 'sw1',
    });
    expect(r.end).toBe('open');
    expect(ports(r)).toEqual(['sw/sw1', 'gone/x']);
  });

  it('traceEndpoint is undefined unless the walk terminated cleanly', () => {
    const sw = device('sw', 'switch', [iface('sw1')]);
    expect(traceEndpoint(traceFrom([sw], [], { deviceId: 'sw', ifaceId: 'sw1' }))).toBeUndefined();
  });
});

describe('planPassThroughPairs', () => {
  it('mirrors a front-only panel into new rear ports', () => {
    const p = device('pp', 'patch-panel', [iface('p1', { name: '1' }), iface('p2', { name: '2' })]);
    // Names come from the library preset convention (keystone => "1", "2", ...).
    p.interfaces![0]!.name = '1';
    p.interfaces![1]!.name = '2';
    const plan = planPassThroughPairs(p);
    expect(plan.createRear).toEqual([
      { frontIfaceId: 'p1', name: '1r' },
      { frontIfaceId: 'p2', name: '2r' },
    ]);
    expect(plan.couple).toEqual([]);
    expect(plan.alreadyPaired).toBe(0);
  });

  it('couples existing front/rear ports positionally instead of creating any', () => {
    const p = device('pp', 'patch-panel', [
      iface('f1', { side: 'front' }),
      iface('f2', { side: 'front' }),
      iface('r1', { side: 'rear' }),
      iface('r2', { side: 'rear' }),
    ]);
    const plan = planPassThroughPairs(p);
    expect(plan.createRear).toEqual([]);
    expect(plan.couple).toEqual([
      { frontIfaceId: 'f1', rearIfaceId: 'r1' },
      { frontIfaceId: 'f2', rearIfaceId: 'r2' },
    ]);
  });

  it('is idempotent — an already-sound panel needs no work', () => {
    const plan = planPassThroughPairs(panel('pp', 24));
    expect(plan.createRear).toEqual([]);
    expect(plan.couple).toEqual([]);
    expect(plan.alreadyPaired).toBe(24);
  });

  it('E8: an odd port count leaves the surplus unpaired rather than mis-matching', () => {
    const p = device('pp', 'patch-panel', [
      iface('f1', { side: 'front' }),
      iface('f2', { side: 'front' }),
      iface('r1', { side: 'rear' }),
    ]);
    const plan = planPassThroughPairs(p);
    expect(plan.couple).toEqual([{ frontIfaceId: 'f1', rearIfaceId: 'r1' }]);
    // f2 gets a fresh rear rather than stealing r1.
    expect(plan.createRear).toEqual([{ frontIfaceId: 'f2', name: 'f2r' }]);
  });

  it('treats a port with no explicit side as front', () => {
    const p = device('pp', 'patch-panel', [iface('a')]);
    expect(planPassThroughPairs(p).createRear).toHaveLength(1);
  });

  it('skips only the sound pairs, fixing the rest', () => {
    const p = device('pp', 'patch-panel', [
      iface('f1', { side: 'front', throughTo: 'r1' }),
      iface('r1', { side: 'rear', throughTo: 'f1' }),
      iface('f2', { side: 'front' }),
    ]);
    const plan = planPassThroughPairs(p);
    expect(plan.alreadyPaired).toBe(1);
    expect(plan.createRear).toEqual([{ frontIfaceId: 'f2', name: 'f2r' }]);
  });

  it('accepts a custom rear-name scheme', () => {
    const p = device('pp', 'patch-panel', [iface('a', { name: '7' })]);
    const plan = planPassThroughPairs(p, (n) => `${n}-B`);
    expect(plan.createRear[0]!.name).toBe('7-B');
  });

  it('an empty panel plans nothing', () => {
    expect(planPassThroughPairs(device('pp', 'patch-panel'))).toEqual({
      createRear: [],
      couple: [],
      alreadyPaired: 0,
    });
  });
});

// Deterministic PRNG so any failure is reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('property: tracing is total and reversible', () => {
  it('always terminates within MAX_HOPS on arbitrary cabling', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rnd = lcg(seed);
      const n = 2 + Math.floor(rnd() * 5);
      const devices: Device[] = [];
      for (let i = 0; i < n; i++) {
        // Mix panels (transitive) and endpoints, sometimes with broken couplings.
        if (rnd() < 0.5) {
          const p = panel(`p${i}`, 1 + Math.floor(rnd() * 2));
          if (rnd() < 0.3) {
            // Deliberately break one coupling.
            const victim = p.interfaces![0]!;
            victim.throughTo = rnd() < 0.5 ? victim.id : 'ghost';
          }
          devices.push(p);
        } else {
          devices.push(device(`d${i}`, 'switch', [iface(`d${i}a`), iface(`d${i}b`)]));
        }
      }
      const allPorts = devices.flatMap((d) =>
        (d.interfaces ?? []).map((i) => ({ deviceId: d.id, ifaceId: i.id })),
      );
      // Random cabling, including duplicates on the same port.
      const cables: RackCable[] = [];
      const cableCount = Math.floor(rnd() * allPorts.length);
      for (let c = 0; c < cableCount; c++) {
        const a = allPorts[Math.floor(rnd() * allPorts.length)]!;
        const b = allPorts[Math.floor(rnd() * allPorts.length)]!;
        cables.push(cable([a.deviceId, a.ifaceId], [b.deviceId, b.ifaceId]));
      }

      for (const start of allPorts) {
        const r = traceFrom(devices, cables, start);
        expect(r.hops.length).toBeLessThanOrEqual(MAX_HOPS);
        expect(r.hops.length).toBeGreaterThan(0);
        expect(r.hops[0]!.deviceId).toBe(start.deviceId);
        expect(r.hops[0]!.via).toBe('start');
        // No port appears twice — the visited set is what bounds the walk.
        const keys = r.hops.map((h) => `${h.deviceId}/${h.ifaceId}`);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });

  it('a cleanly terminated trace reverses to the same port sequence', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = lcg(seed);
      // Build an unambiguous chain: switch — [panels] — endpoint.
      const panelCount = Math.floor(rnd() * 4);
      const sw = device('sw', 'switch', [iface('sw1')]);
      const end = device('end', 'server', [iface('nic')]);
      const panels = Array.from({ length: panelCount }, (_, i) => panel(`p${i}`, 1));
      const devices = [sw, ...panels, end];
      const cables: RackCable[] = [];
      let prev: [string, string] = ['sw', 'sw1'];
      for (let i = 0; i < panelCount; i++) {
        cables.push(cable(prev, [`p${i}`, `p${i}f1`]));
        prev = [`p${i}`, `p${i}r1`];
      }
      cables.push(cable(prev, ['end', 'nic']));

      const fwd = traceFrom(devices, cables, { deviceId: 'sw', ifaceId: 'sw1' });
      const back = traceFrom(devices, cables, { deviceId: 'end', ifaceId: 'nic' });
      expect(fwd.end).toBe('terminated');
      expect(back.end).toBe('terminated');
      // `via` labels describe how each hop was ARRIVED at, so they differ by
      // position; the port sequence is what must mirror.
      expect(ports(back)).toEqual([...ports(fwd)].reverse());
    }
  });
});
