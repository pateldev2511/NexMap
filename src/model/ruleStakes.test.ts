import { describe, expect, it } from 'vitest';
import { createDevice, createLink, createSubnet } from './schema';
import { createConnectivityRule, createCountRule, createIsolationRule, createPlacementRule, isolationPath } from './invariants';
import type { DeviceType } from './types';
import { brokeMessage, deleteStakes, deviceStakes, newlyBroken, ruleFixes, ruleFixLabel, ruleSupports, suggestCuts, suggestUplinks, without } from './ruleStakes';
import type { CustomRuleSpec, Device, Link } from './types';

const L = 'layer';
const sw = (name: string, role?: string) => createDevice('switch', 0, 0, L, { name, ...(role ? { role } : {}) });
const link = (a: Device, b: Device): Link => createLink(a.id, b.id, L);
const rules = (customRules: CustomRuleSpec[], invariants: string[] = []) => ({
  invariants: new Set(invariants),
  customRules,
});

describe('deviceStakes', () => {
  it('nothing declared → no stakes', () => {
    const a = sw('A');
    expect(deviceStakes(a.id, { devices: [a], links: [], subnets: [] }, rules([]))).toEqual({ breaks: [], holdsUp: [] });
  });

  it('a device that breaks a rule says which and why', () => {
    const cctv = createSubnet('10.20.0.0/24', { name: 'CCTV' });
    const cam = createDevice('camera', 0, 0, L, { name: 'Cam', role: 'camera', managementIp: '10.10.0.5' });
    const rule = createPlacementRule('camera', 'CCTV');
    const s = deviceStakes(cam.id, { devices: [cam], links: [], subnets: [cctv] }, rules([rule]));
    expect(s.breaks).toEqual([{ id: rule.id, label: 'Every “camera” lives in “CCTV”', detail: '10.10.0.5 is in no subnet, not “CCTV”' }]);
    expect(s.holdsUp).toEqual([]);
  });

  it('a device a met rule depends on: deleting it would break the rule', () => {
    const c1 = sw('C1', 'core');
    const c2 = sw('C2', 'core');
    const a = sw('A', 'access');
    const ctx = { devices: [c1, c2, a], links: [link(a, c1), link(a, c2)], subnets: [] };
    const count = createCountRule('core', 2);
    const dual = createConnectivityRule('access', 'core', 2);
    const s = deviceStakes(c1.id, ctx, rules([count, dual]));
    expect(s.breaks).toEqual([]);
    expect(s.holdsUp).toEqual([
      { id: count.id, label: 'At least 2 “core”', detail: '1 short' },
      { id: dual.id, label: 'Every “access” connects to ≥2 “core”', detail: '1 to fix' },
    ]);
    // The access switch itself holds up neither (removing it leaves no access to check).
    expect(deviceStakes(a.id, ctx, rules([count, dual])).holdsUp).toEqual([]);
  });

  it('a redundant twin holds up "no single point of failure"', () => {
    const a = sw('A');
    const b = sw('B');
    const h1 = sw('H1');
    const h2 = sw('H2');
    const ctx = { devices: [a, b, h1, h2], links: [link(a, h1), link(a, h2), link(b, h1), link(b, h2)], subnets: [] };
    const s = deviceStakes(h2.id, ctx, rules([], ['no-single-point-of-failure']));
    expect(s.holdsUp.map((x) => x.label)).toEqual(['No single point of failure']);
  });

  it('a rule already broken is not "held up" (only met → broken counts)', () => {
    const c1 = sw('C1', 'core');
    const ctx = { devices: [c1], links: [], subnets: [] };
    expect(deviceStakes(c1.id, ctx, rules([createCountRule('core', 2)])).holdsUp).toEqual([]);
  });
});

describe('ruleSupports', () => {
  it('lists, per met rule, the devices it cannot lose — agreeing with deviceStakes', () => {
    const c1 = sw('C1', 'core');
    const c2 = sw('C2', 'core');
    const a = sw('A', 'access');
    const b = sw('B', 'access');
    const ctx = { devices: [c2, c1, a, b], links: [link(a, c1), link(a, c2), link(b, c1), link(b, c2)], subnets: [] };
    const count = createCountRule('core', 2);
    const dual = createConnectivityRule('access', 'core', 2);
    const r = rules([count, dual], ['every-device-named']);
    const sup = ruleSupports(ctx, r);
    expect(sup.get(count.id)).toEqual([
      { deviceId: c1.id, name: 'C1', detail: '1 short' },
      { deviceId: c2.id, name: 'C2', detail: '1 short' },
    ]);
    expect(sup.get(dual.id)?.map((s) => [s.name, s.detail])).toEqual([
      ['C1', '2 to fix'],
      ['C2', '2 to fix'],
    ]);
    // Naming can't be broken by a delete: no entry.
    expect(sup.has('every-device-named')).toBe(false);
    for (const d of ctx.devices) {
      const held = deviceStakes(d.id, ctx, r).holdsUp.map((h) => h.id);
      const listed = [...sup].filter(([, list]) => list.some((s) => s.deviceId === d.id)).map(([id]) => id);
      expect(listed.sort()).toEqual(held.sort());
    }
  });

  it('a broken rule has no supports, and nothing declared → empty', () => {
    const c1 = sw('C1', 'core');
    const ctx = { devices: [c1], links: [], subnets: [] };
    expect(ruleSupports(ctx, rules([createCountRule('core', 2)])).size).toBe(0);
    expect(ruleSupports(ctx, rules([])).size).toBe(0);
  });
});

describe('without / newlyBroken', () => {
  it('drops the devices and every link touching them', () => {
    const a = sw('A');
    const b = sw('B');
    const c = sw('C');
    const out = without({ devices: [a, b, c], links: [link(a, b), link(b, c)], subnets: [] }, new Set([a.id]));
    expect(out.devices.map((d) => d.name)).toEqual(['B', 'C']);
    expect(out.links).toHaveLength(1);
  });

  it('reports only rules that held before', () => {
    const v = (id: string) => ({ id, label: id, objectIds: [] });
    expect(newlyBroken([v('a')], [v('a'), v('b')]).map((x) => x.id)).toEqual(['b']);
  });
});

describe('brokeMessage', () => {
  const v = (label: string) => ({ id: label, label, objectIds: [] });
  it('names the step and how to put it back', () => {
    expect(brokeMessage([v('A')], { kind: 'do', label: 'Edit device' })).toBe('That edit broke A. ⌘Z puts it back.');
    expect(brokeMessage([v('A'), v('B')], { kind: 'do', label: 'Delete' })).toBe('That delete broke A; B. ⌘Z puts it back.');
    expect(brokeMessage([v('A')], { kind: 'do', label: 'Remove cable' })).toMatch(/^That delete/);
    expect(brokeMessage([v('A'), v('B'), v('C')], { kind: 'undo', label: 'Edit device' })).toBe(
      'That undo broke A; B and 1 more. ⌘⇧Z puts it back.',
    );
    expect(brokeMessage([v('A')], { kind: 'redo', label: 'Delete' })).toBe('That redo broke A. ⌘Z puts it back.');
  });
});

describe('ruleSupports agrees with remove-and-re-check', () => {
  /** The definition, the slow way: delete each device, see which held rules break. */
  function oracle(ctx: Parameters<typeof ruleSupports>[0], r: Parameters<typeof ruleSupports>[1]) {
    const out = new Map<string, string[]>();
    for (const d of ctx.devices) {
      for (const v of deviceStakes(d.id, ctx, r).holdsUp) {
        (out.get(v.id) ?? out.set(v.id, []).get(v.id)!).push(`${d.id}:${v.detail}`);
      }
    }
    return new Map([...out].map(([k, v]) => [k, v.sort()]));
  }

  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const TYPES: DeviceType[] = ['switch', 'switch', 'router', 'firewall', 'server', 'camera'];
  const ROLES = ['core', 'core', 'access', 'access', 'guest', ''];
  for (let g = 0; g < 80; g++) {
    it(`random design ${g}`, () => {
      const n = 2 + Math.floor(rnd() * 10);
      const devices = Array.from({ length: n }, (_, i) => {
        const role = pick(ROLES);
        return createDevice(pick(TYPES), 0, 0, L, { name: `D${i}`, ...(role ? { role } : {}) });
      });
      const links = Array.from({ length: Math.floor(rnd() * n * 2) }, () => link(pick(devices), pick(devices)));
      const ctx = { devices, links, subnets: [] };
      const r = rules(
        [
          createCountRule('core', 1 + Math.floor(rnd() * 3)),
          createCountRule('switch', 2),
          createConnectivityRule('access', 'core', 1 + Math.floor(rnd() * 2)),
          createConnectivityRule('core', 'core', 1),
          createIsolationRule('guest', 'core'),
          createPlacementRule('access', 'Mgmt'),
        ],
        ['no-single-point-of-failure', 'every-device-named'],
      );
      const fast = new Map([...ruleSupports(ctx, r)].map(([k, v]) => [k, v.map((x) => `${x.deviceId}:${x.detail}`).sort()]));
      expect(fast).toEqual(oracle(ctx, r));
    });
  }
});

describe('deleteStakes', () => {
  const fw = (name: string) => createDevice('firewall', 0, 0, L, { name });

  it('a redundant pair: neither alone, both together', () => {
    const a = fw('FW1');
    const b = fw('FW2');
    const ctx = { devices: [a, b], links: [], subnets: [] };
    const r = rules([createCountRule('firewall', 1)]);
    expect(deleteStakes([a.id], ctx, r)).toEqual([]);
    expect(deleteStakes([a.id, b.id], ctx, r)).toEqual([
      { id: r.customRules[0]!.id, label: 'At least 1 “firewall”', detail: '1 short', together: true },
    ]);
  });

  it('a rule one member already breaks alone is not "together"', () => {
    const a = fw('FW1');
    const b = fw('FW2');
    const ctx = { devices: [a, b], links: [], subnets: [] };
    const r = rules([createCountRule('firewall', 2)]);
    expect(deleteStakes([a.id, b.id], ctx, r)[0]).toMatchObject({ detail: '2 short', together: false });
  });

  it('deleting a link can break a rule', () => {
    const c1 = sw('C1', 'core');
    const c2 = sw('C2', 'core');
    const a = sw('A', 'access');
    const up = link(a, c2);
    const ctx = { devices: [c1, c2, a], links: [link(a, c1), up], subnets: [] };
    const dual = createConnectivityRule('access', 'core', 2);
    expect(deleteStakes([up.id], ctx, rules([dual]))).toEqual([
      { id: dual.id, label: 'Every “access” connects to ≥2 “core”', detail: '1 to fix', together: false },
    ]);
  });

  it('nothing declared, or nothing selected → nothing', () => {
    const a = fw('FW1');
    expect(deleteStakes([a.id], { devices: [a], links: [], subnets: [] }, rules([]))).toEqual([]);
    expect(deleteStakes([], { devices: [a], links: [], subnets: [] }, rules([createCountRule('firewall', 1)]))).toEqual([]);
  });
});

describe('suggestUplinks', () => {
  const dual = createConnectivityRule('access', 'core', 2);

  it('offers as many cores as it is short, least-loaded first, never one already linked', () => {
    const c1 = sw('C1', 'core');
    const c2 = sw('C2', 'core');
    const c3 = sw('C3', 'core');
    const a = sw('A', 'access');
    const b = sw('B', 'access');
    const ctx = { devices: [c1, c2, c3, a, b], links: [link(a, c1), link(b, c2)], subnets: [] };
    // A has C1; short one. C2 already carries B, C3 carries nobody → C3.
    expect(suggestUplinks(dual, a.id, ctx, rules([dual]))).toEqual([{ id: c3.id, name: 'C3' }]);
    const lone = sw('L', 'access');
    expect(suggestUplinks(dual, lone.id, { ...ctx, devices: [...ctx.devices, lone] }, rules([dual])).map((t) => t.name)).toEqual(['C3', 'C1']);
  });

  it('skips a link that would break another rule that holds now', () => {
    const c1 = sw('C1', 'core');
    const c2 = sw('C2', 'core');
    const g = sw('G', 'guest');
    const a = sw('A', 'access');
    // C2 is on the guest island: linking A to it would let guest reach access… and core.
    const ctx = { devices: [c1, c2, g, a], links: [link(a, c1), link(g, c2)], subnets: [] };
    const iso = createIsolationRule('guest', 'access');
    expect(suggestUplinks(dual, a.id, ctx, rules([dual, iso]))).toEqual([]);
    expect(suggestUplinks(dual, a.id, ctx, rules([dual]))).toEqual([{ id: c2.id, name: 'C2' }]);
  });

  it('nothing for a device that meets it, or another kind of rule', () => {
    const c1 = sw('C1', 'core');
    const a = sw('A', 'access');
    const ctx = { devices: [c1, a], links: [link(a, c1)], subnets: [] };
    const one = createConnectivityRule('access', 'core', 1);
    expect(suggestUplinks(one, a.id, ctx, rules([one]))).toEqual([]);
    expect(suggestUplinks(createCountRule('core', 2), a.id, ctx, rules([]))).toEqual([]);
  });
});

describe('suggestUplinks · judged together', () => {
  it('two links safe alone but not together: only one is offered', () => {
    const c2 = sw('C2', 'core');
    const c3 = sw('C3', 'core');
    const g = sw('G', 'guest');
    const p = sw('P', 'printer');
    const a = sw('A', 'access');
    // C2 carries the guest switch, C3 the printer. Linking A to both joins them.
    const ctx = { devices: [c2, c3, g, p, a], links: [link(g, c2), link(p, c3)], subnets: [] };
    const dual = createConnectivityRule('access', 'core', 2);
    const iso = createIsolationRule('guest', 'printer');
    expect(suggestUplinks(dual, a.id, ctx, rules([dual, iso]))).toHaveLength(1);
    expect(suggestUplinks(dual, a.id, ctx, rules([dual]))).toHaveLength(2);
  });
});

describe('isolationPath / suggestCuts', () => {
  const iso = createIsolationRule('guest', 'access');

  it('finds the shortest way through, and the cuts that close it, guest side first', () => {
    const g = sw('G', 'guest');
    const c = sw('C', 'core');
    const a = sw('A', 'access');
    const gc = link(g, c);
    const ca = link(c, a);
    const ctx = { devices: [g, c, a], links: [gc, ca], subnets: [] };
    expect(isolationPath('access', g.id, ctx)).toEqual([g.id, c.id, a.id]);
    expect(suggestCuts(iso, g.id, ctx, rules([iso]))).toEqual([
      { linkId: gc.id, label: 'G–C' },
      { linkId: ca.id, label: 'C–A' },
    ]);
  });

  it('skips a cut that leaves another way round, a doubled link, or one that breaks another rule', () => {
    const g = sw('G', 'guest');
    const c1 = sw('C1', 'core');
    const c2 = sw('C2', 'core');
    const a = sw('A', 'access');
    const ctx = {
      devices: [g, c1, c2, a],
      links: [link(g, c1), link(g, c1), link(c1, a), link(g, c2), link(c2, a)],
      subnets: [],
    };
    // G–C1 is doubled; C1–A has a way round via C2: no single cut on the path works.
    expect(suggestCuts(iso, g.id, ctx, rules([iso]))).toEqual([]);

    const g2 = sw('G', 'guest');
    const c = sw('C', 'core');
    const a2 = sw('A', 'access');
    const ctx2 = { devices: [g2, c, a2], links: [link(g2, c), link(c, a2)], subnets: [] };
    // Guest must keep its core uplink: only the core–access cut is offered.
    const keep = createConnectivityRule('guest', 'core', 1);
    expect(suggestCuts(iso, g2.id, ctx2, rules([iso, keep])).map((x) => x.label)).toEqual(['C–A']);
  });

  it('nothing when unreachable, or for another kind of rule', () => {
    const g = sw('G', 'guest');
    const a = sw('A', 'access');
    const ctx = { devices: [g, a], links: [], subnets: [] };
    expect(isolationPath('access', g.id, ctx)).toBeNull();
    expect(suggestCuts(iso, g.id, ctx, rules([iso]))).toEqual([]);
    expect(suggestCuts(createCountRule('guest', 1), g.id, ctx, rules([]))).toEqual([]);
  });
});

describe('ruleFixes', () => {
  it('collects a link per short device and a cut per breach, and can narrow to one device', () => {
    const c1 = sw('C1', 'core');
    const c2 = sw('C2', 'core');
    const a = sw('A', 'access');
    const b = sw('B', 'access');
    const g = sw('G', 'guest');
    const gc = link(g, c1);
    const ctx = { devices: [c1, c2, a, b, g], links: [link(a, c1), link(b, c1), link(b, c2), gc], subnets: [] };
    const dual = createConnectivityRule('access', 'core', 2);
    const iso = createIsolationRule('guest', 'access');
    const r = rules([dual, iso]);
    const all = ruleFixes(ctx, r);
    expect(all.map(ruleFixLabel)).toEqual(['Connect to C2', 'Cut G–C1']);
    expect(all.map((f) => f.deviceName)).toEqual(['A', 'G']);
    expect(ruleFixes(ctx, r, { onlyDevice: g.id }).map(ruleFixLabel)).toEqual(['Cut G–C1']);
    expect(ruleFixes(ctx, r, { max: 1 })).toHaveLength(1);
  });
});

describe('ruleFixes · planned together', () => {
  it('never offers an uplink to the core the guest would come back in through', () => {
    const c1 = sw('C1', 'core');
    const c2 = sw('C2', 'core');
    const c3 = sw('C3', 'core');
    const a1 = sw('A1', 'access');
    const a2 = sw('A2', 'access');
    const g = sw('G', 'guest');
    // A2 is short a core. G hangs off C3 and has also leaked onto C1.
    const ctx = {
      devices: [c1, c2, c3, a1, a2, g],
      links: [link(a1, c1), link(a1, c2), link(a2, c1), link(g, c3), link(g, c1)],
      subnets: [],
    };
    const r = rules([createConnectivityRule('access', 'core', 2), createIsolationRule('guest', 'access')]);
    // C3 carries no access switch, but it's the guest's core: after cutting G–C1, an
    // A2–C3 link would let the guest straight back in.
    expect(ruleFixes(ctx, r).map(ruleFixLabel)).toEqual(['Connect to C2', 'Cut G–C1']);
  });
});

describe('suggestCuts · never deepens a broken connectivity rule', () => {
  it('won’t cut an access switch’s only core uplink, even though dual-homing is already broken', () => {
    const g = sw('G', 'guest');
    const c = sw('C', 'core');
    const a = sw('A', 'access');
    const gc = link(g, c);
    const ctx = { devices: [g, c, a], links: [gc, link(c, a)], subnets: [] };
    const iso = createIsolationRule('guest', 'access');
    const dual = createConnectivityRule('access', 'core', 2); // A has 1: broken already
    expect(suggestCuts(iso, g.id, ctx, rules([iso, dual]))).toEqual([{ linkId: gc.id, label: 'G–C' }]);
  });
});
