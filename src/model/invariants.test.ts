import { describe, expect, it } from 'vitest';
import { createDevice, createLink, createSubnet } from './schema';
import {
  evaluateInvariants,
  evaluateCustomRules,
  createConnectivityRule,
  createIsolationRule,
  customRuleLabel,
  getInvariant,
  BUILT_IN_INVARIANTS,
} from './invariants';
import type { Device, Link, Subnet } from './types';

const L = 'layer1';
const dev = (partial: Partial<Device> = {}) => createDevice('switch', 0, 0, L, partial);
const link = (a: string, b: string): Link => createLink(a, b, L);

const ALL = new Set(BUILT_IN_INVARIANTS.map((i) => i.id));
const only = (id: string) => new Set([id]);
const ctx = (devices: Device[], links: Link[] = [], subnets: Subnet[] = []) => ({
  devices,
  links,
  subnets,
});

describe('evaluateInvariants', () => {
  it('skips disabled rules entirely', () => {
    const d = dev({ name: '', managementIp: '' }); // breaks two rules
    expect(evaluateInvariants(ctx([d]), new Set())).toEqual([]);
  });

  it('reports violations in registry order', () => {
    const d = dev({ name: '', managementIp: '' }); // unnamed + unaddressed
    const ids = evaluateInvariants(ctx([d]), ALL).map((v) => v.id);
    // registry order: …addressed before …named
    expect(ids).toEqual(['every-device-addressed', 'every-device-named']);
  });

  it('every-device-addressed: flags addressable devices without an IP, skips non-addressable', () => {
    const sw = dev({ managementIp: '' });
    const isp = createDevice('isp', 0, 0, L, { managementIp: '' }); // non-addressable
    const v = evaluateInvariants(ctx([sw, isp]), only('every-device-addressed'));
    expect(v).toHaveLength(1);
    expect(v[0]!.objectIds).toEqual([sw.id]); // isp is not a violation
  });

  it('every-device-addressed: satisfied when every device has an IP', () => {
    const sw = dev({ managementIp: '10.0.0.2' });
    expect(evaluateInvariants(ctx([sw]), only('every-device-addressed'))).toEqual([]);
  });

  it('every-subnet-has-gateway: flags gateway-less subnets only', () => {
    const bare = createSubnet('10.0.0.0/24');
    const ok = createSubnet('10.0.1.0/24', { gateway: '10.0.1.1' });
    const v = evaluateInvariants(ctx([], [], [bare, ok]), only('every-subnet-has-gateway'));
    expect(v).toHaveLength(1);
    expect(v[0]!.objectIds).toEqual([bare.id]);
  });

  it('no-single-point-of-failure: flags the hub whose loss isolates others', () => {
    const a = dev();
    const b = dev();
    const hub = dev();
    const links = [link(a.id, hub.id), link(b.id, hub.id)]; // star: hub is the SPOF
    const v = evaluateInvariants(ctx([a, b, hub], links), only('no-single-point-of-failure'));
    expect(v).toHaveLength(1);
    expect(v[0]!.objectIds).toContain(hub.id);
  });

  it('no-single-point-of-failure: satisfied on a redundant mesh', () => {
    const a = dev();
    const b = dev();
    const h1 = dev();
    const h2 = dev();
    // a and b each dual-home to both hubs — no single loss isolates anyone
    const links = [
      link(a.id, h1.id),
      link(a.id, h2.id),
      link(b.id, h1.id),
      link(b.id, h2.id),
    ];
    expect(
      evaluateInvariants(ctx([a, b, h1, h2], links), only('no-single-point-of-failure')),
    ).toEqual([]);
  });
});

describe('getInvariant', () => {
  it('resolves a built-in by id and returns undefined otherwise', () => {
    expect(getInvariant('every-device-named')?.label).toBe('Every device is named');
    expect(getInvariant('nope')).toBeUndefined();
  });
});

describe('evaluateCustomRules (connectivity)', () => {
  // access switch dual-homing to two cores.
  const scene = (accessLinks: number) => {
    const acc = dev({ role: 'access' });
    const core1 = dev({ role: 'core' });
    const core2 = dev({ role: 'core' });
    const links: Link[] = [];
    if (accessLinks >= 1) links.push(link(acc.id, core1.id));
    if (accessLinks >= 2) links.push(link(acc.id, core2.id));
    return { acc, core1, core2, devices: [acc, core1, core2], links };
  };
  const dualHome = createConnectivityRule('access', 'core', 2);

  it('flags an access device wired to only one core', () => {
    const s = scene(1);
    const v = evaluateCustomRules([dualHome], ctx(s.devices, s.links));
    expect(v).toHaveLength(1);
    expect(v[0]!.objectIds).toEqual([s.acc.id]);
    expect(v[0]!.id).toBe(dualHome.id);
  });

  it('is satisfied when the access device reaches both cores', () => {
    const s = scene(2);
    expect(evaluateCustomRules([dualHome], ctx(s.devices, s.links))).toEqual([]);
  });

  it('matches roles case-insensitively and ignores non-matching neighbors', () => {
    const acc = dev({ role: 'Access' });
    const core = dev({ role: 'CORE' });
    const server = dev({ role: 'server' });
    const links = [link(acc.id, core.id), link(acc.id, server.id)];
    const rule = createConnectivityRule('access', 'core', 2); // needs 2 cores, has 1
    const v = evaluateCustomRules([rule], ctx([acc, core, server], links));
    expect(v).toHaveLength(1);
    expect(v[0]!.objectIds).toEqual([acc.id]);
  });

  it('skips a half-authored rule (blank role)', () => {
    const s = scene(1);
    const incomplete = createConnectivityRule('access', '', 2);
    expect(evaluateCustomRules([incomplete], ctx(s.devices, s.links))).toEqual([]);
  });

  it('produces a readable label', () => {
    expect(customRuleLabel(dualHome)).toBe('Every “access” connects to ≥2 “core”');
  });

  it('skips a rule whose kind is unknown (forward-compat)', () => {
    const s = scene(1);
    const future = { ...dualHome, kind: 'capacity' } as unknown as Parameters<typeof evaluateCustomRules>[0][number];
    expect(evaluateCustomRules([future], ctx(s.devices, s.links))).toEqual([]);
  });
});

describe('evaluateCustomRules (isolation)', () => {
  const noReach = createIsolationRule('guest', 'internal');

  it('flags a guest device that shares a path with an internal device', () => {
    const guest = dev({ role: 'guest' });
    const core = dev({ role: 'core' });
    const internal = dev({ role: 'internal' });
    const links = [link(guest.id, core.id), link(core.id, internal.id)]; // guest → core → internal
    const v = evaluateCustomRules([noReach], ctx([guest, core, internal], links));
    expect(v).toHaveLength(1);
    expect(v[0]!.objectIds).toEqual([guest.id]);
    expect(customRuleLabel(noReach)).toBe('No “guest” may reach “internal”');
  });

  it('is satisfied when the two roles live in separate components', () => {
    const guest = dev({ role: 'guest' });
    const gw = dev({ role: 'core' });
    const internal = dev({ role: 'internal' });
    const other = dev({ role: 'core' });
    // Two disjoint fabrics: guest—gw, and internal—other. No path between them.
    const links = [link(guest.id, gw.id), link(internal.id, other.id)];
    expect(evaluateCustomRules([noReach], ctx([guest, gw, internal, other], links))).toEqual([]);
  });

  it('does not flag a lone device under a same-role isolation rule', () => {
    const only = dev({ role: 'core' });
    const rule = createIsolationRule('core', 'core'); // "no core may reach a core"
    expect(evaluateCustomRules([rule], ctx([only], []))).toEqual([]);
  });
});
