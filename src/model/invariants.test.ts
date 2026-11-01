import { describe, expect, it } from 'vitest';
import { createDevice, createLink, createSubnet } from './schema';
import {
  evaluateInvariants,
  evaluateCustomRules,
  createConnectivityRule,
  createIsolationRule,
  createPlacementRule,
  customRuleLabel,
  isCustomRuleRestorable,
  planPlacement,
  resolveSubnetRef,
  explainOffenders,
  ruleOffenderIds,
  getInvariant,
  BUILT_IN_INVARIANTS,
  createCountRule,
  countedDevices,
  planCount,
  violationTodo,
  vlanRefId,
  placementTargetName,
  placementTargetProblem,
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

describe('placement rules · VLAN refs', () => {
  const cctv = () => createSubnet('10.20.0.0/24', { name: 'CCTV', vlanId: 20 });
  const cctv2 = () => createSubnet('10.21.0.0/24', { name: 'CCTV-B', vlanId: 20 });
  const office = () => createSubnet('10.10.0.0/24', { name: 'Office', vlanId: 10 });

  it('reads "VLAN n" in any spelling, only for valid ids', () => {
    expect(['VLAN 20', 'vlan20', 'Vlan-20', ' vlan 20 '].map(vlanRefId)).toEqual([20, 20, 20, 20]);
    expect(['vlan 0', 'vlan 4095', 'CCTV', '10.20.0.0/24', undefined].map(vlanRefId)).toEqual([null, null, null, null, null]);
  });

  it('stores one spelling and labels as a VLAN', () => {
    const r = createPlacementRule('camera', 'vlan20');
    expect(r.subnet).toBe('VLAN 20');
    expect(customRuleLabel(r)).toBe('Every “camera” is on VLAN 20');
  });

  it('resolves to every subnet on the VLAN; a device in any of them meets the rule', () => {
    const subs = [cctv(), cctv2(), office()];
    expect(resolveSubnetRef('VLAN 20', subs).map((s) => s.name)).toEqual(['CCTV', 'CCTV-B']);
    const a = dev({ role: 'camera', managementIp: '10.20.0.5' });
    const b = dev({ role: 'camera', managementIp: '10.21.0.5' });
    const c = dev({ role: 'camera', managementIp: '10.10.0.5' });
    const rule = createPlacementRule('camera', 'VLAN 20');
    expect(evaluateCustomRules([rule], ctx([a, b], [], subs))).toEqual([]);
    expect(evaluateCustomRules([rule], ctx([a, b, c], [], subs))[0]!.objectIds).toEqual([c.id]);
  });

  it('explains with the VLAN the address actually lands on', () => {
    const subs = [cctv(), office(), createSubnet('10.30.0.0/24', { name: 'Lab' })];
    const rule = createPlacementRule('camera', 'VLAN 20');
    const c = dev({ role: 'camera', managementIp: '10.10.0.5' });
    const d = dev({ role: 'camera', managementIp: '10.30.0.5' });
    const why = explainOffenders(rule.id, [c.id, d.id], ctx([c, d], [], subs), [rule]).map((o) => o.reason);
    expect(why).toEqual(['10.10.0.5 is in “Office” (VLAN 10), not VLAN 20', '10.30.0.5 is in “Lab” (no VLAN), not VLAN 20']);
    expect(explainOffenders(rule.id, [c.id], ctx([c], [], [office()]), [rule])[0]!.reason).toBe('no subnet is on VLAN 20');
  });

  it('restores into the VLAN’s one subnet; refuses, and says why, when it spans several or none', () => {
    const c = dev({ role: 'camera', managementIp: '10.10.0.5' });
    const rule = createPlacementRule('camera', 'VLAN 20');
    expect(planPlacement(rule, [c], [cctv(), office()]).assignments).toEqual([{ deviceId: c.id, ip: '10.20.0.1' }]);
    expect(planPlacement(rule, [c], [cctv(), cctv2()]).assignments).toEqual([]);
    expect(placementTargetProblem('VLAN 20', [cctv()])).toBeNull();
    expect(placementTargetProblem('VLAN 20', [cctv(), cctv2()])).toBe('VLAN 20 spans 2 subnets, and Conductor won’t guess which');
    expect(placementTargetProblem('VLAN 20', [office()])).toBe('no subnet is on VLAN 20');
    expect(placementTargetProblem('Ghost', [office()])).toBe('no subnet is named “Ghost”');
    expect(placementTargetName('VLAN 20', [cctv()])).toBe('VLAN 20 (“CCTV”)');
    expect(placementTargetName('CCTV', [cctv()])).toBe('“CCTV”');
  });
});

describe('placement rules', () => {
  const cctv = () => createSubnet('10.20.0.0/24', { name: 'CCTV', gateway: '10.20.0.1' });
  const office = () => createSubnet('10.10.0.0/24', { name: 'Office' });

  it('labels and is the one restorable custom kind', () => {
    const r = createPlacementRule('camera', 'CCTV');
    expect(customRuleLabel(r)).toBe('Every “camera” lives in “CCTV”');
    expect(isCustomRuleRestorable(r)).toBe(true);
    expect(isCustomRuleRestorable(createIsolationRule('a', 'b'))).toBe(false);
  });

  it('resolves a subnet by name (any case) or exact CIDR', () => {
    const s = cctv();
    expect(resolveSubnetRef('cctv', [s, office()])).toEqual([s]);
    expect(resolveSubnetRef(' 10.20.0.0/24 ', [s])).toEqual([s]);
    expect(resolveSubnetRef('nope', [s])).toEqual([]);
    expect(resolveSubnetRef('', [s])).toEqual([]);
  });

  it('flags role devices outside the subnet or unaddressed; met when all inside', () => {
    const inside = dev({ role: 'Camera', managementIp: '10.20.0.5' });
    const outside = dev({ role: 'camera', managementIp: '10.10.0.5' });
    const bare = dev({ role: 'camera', managementIp: '' });
    const other = dev({ role: 'printer', managementIp: '10.10.0.9' }); // different role
    const subs = [cctv(), office()];
    const rule = createPlacementRule('camera', 'CCTV');
    const [v] = evaluateCustomRules([rule], ctx([inside, outside, bare, other], [], subs));
    expect(v!.objectIds.sort()).toEqual([outside.id, bare.id].sort());
    expect(evaluateCustomRules([rule], ctx([inside], [], subs))).toEqual([]);
  });

  it('accepts a /prefix on the management IP', () => {
    const d = dev({ role: 'camera', managementIp: '10.20.0.7/24' });
    expect(evaluateCustomRules([createPlacementRule('camera', 'CCTV')], ctx([d], [], [cctv()]))).toEqual([]);
  });

  it('flags every role device when the subnet does not exist; skips half-authored rules', () => {
    const d = dev({ role: 'camera', managementIp: '10.20.0.5' });
    expect(evaluateCustomRules([createPlacementRule('camera', 'Ghost')], ctx([d]))[0]!.objectIds).toEqual([d.id]);
    expect(evaluateCustomRules([createPlacementRule('camera', ' ')], ctx([d]))).toEqual([]);
    expect(evaluateCustomRules([createPlacementRule('', 'CCTV')], ctx([d], [], [cctv()]))).toEqual([]);
  });

  it('ignores non-addressable devices that carry the role', () => {
    const panel = createDevice('patch-panel', 0, 0, L, { role: 'camera' });
    expect(evaluateCustomRules([createPlacementRule('camera', 'CCTV')], ctx([panel], [], [cctv()]))).toEqual([]);
  });

  it('plans next free hosts in the target, skipping gateway and every used address', () => {
    const taken = dev({ role: 'printer', managementIp: '10.20.0.2' });
    const a = dev({ id: 'a', role: 'camera', managementIp: '10.10.0.5' });
    const b = dev({ id: 'b', role: 'camera', managementIp: '' });
    const plan = planPlacement(createPlacementRule('camera', 'CCTV'), [b, taken, a], [cctv(), office()]);
    expect(plan.assignments).toEqual([
      { deviceId: 'a', ip: '10.20.0.3' },
      { deviceId: 'b', ip: '10.20.0.4' },
    ]);
    expect(plan.unplaced).toEqual([]);
  });

  it('refuses a missing or ambiguous target, and reports a full subnet', () => {
    const d = dev({ id: 'd', role: 'camera', managementIp: '10.10.0.5' });
    const missing = planPlacement(createPlacementRule('camera', 'Ghost'), [d], [cctv()]);
    expect(missing).toEqual({ assignments: [], unplaced: ['d'] });
    const twice = planPlacement(createPlacementRule('camera', 'CCTV'), [d], [cctv(), createSubnet('10.30.0.0/24', { name: 'cctv' })]);
    expect(twice).toEqual({ assignments: [], unplaced: ['d'] });
    const tiny = createSubnet('10.40.0.0/30', { name: 'Tiny' }); // 2 hosts
    const fillers = [dev({ managementIp: '10.40.0.1' }), dev({ managementIp: '10.40.0.2' })];
    const full = planPlacement(createPlacementRule('camera', 'Tiny'), [d, ...fillers], [tiny]);
    expect(full).toEqual({ assignments: [], unplaced: ['d'] });
  });
});

describe('explainOffenders', () => {
  it('built-ins: SPOF blast size, missing IP, blank name, missing gateway', () => {
    const a = dev({ name: 'A' });
    const hub = dev({ name: 'Hub' });
    const b = dev({ name: 'B' });
    const c = ctx([a, hub, b], [link(a.id, hub.id), link(b.id, hub.id)]);
    const [v] = evaluateInvariants(c, only('no-single-point-of-failure'));
    expect(explainOffenders(v!.id, v!.objectIds, c)).toEqual([
      { id: hub.id, name: 'Hub', reason: expect.stringMatching(/^its failure cuts off \d+ devices?$/) },
    ]);
    expect(explainOffenders('every-device-addressed', [a.id], c)[0]!.reason).toBe('no management IP');
    const blank = dev({ name: '' });
    expect(explainOffenders('every-device-named', [blank.id], ctx([blank]))[0]).toEqual({
      id: blank.id,
      name: 'switch', // falls back to the type
      reason: 'blank name',
    });
    const sn = createSubnet('10.0.0.0/24');
    expect(explainOffenders('every-subnet-has-gateway', [sn.id], ctx([], [], [sn]))[0]).toEqual({
      id: sn.id,
      name: '10.0.0.0/24',
      reason: 'no gateway address',
    });
  });

  it('connectivity: how many of the required neighbors it has', () => {
    const acc = dev({ name: 'acc-1', role: 'access' });
    const core = dev({ role: 'core' });
    const rule = createConnectivityRule('access', 'core', 2);
    const c = ctx([acc, core], [link(acc.id, core.id)]);
    expect(explainOffenders(rule.id, [acc.id], c, [rule])[0]!.reason).toBe('links to 1 of ≥2 “core”');
  });

  it('isolation: names a device of the forbidden role it can reach', () => {
    const guest = dev({ name: 'G', role: 'guest' });
    const sw = dev({ name: 'SW' });
    const srv = dev({ name: 'Srv-1', role: 'internal' });
    const rule = createIsolationRule('guest', 'internal');
    const c = ctx([guest, sw, srv], [link(guest.id, sw.id), link(sw.id, srv.id)]);
    expect(explainOffenders(rule.id, [guest.id], c, [rule])[0]!.reason).toBe('reaches “internal” Srv-1 via SW');
  });

  it('placement: where the IP actually lives, or what is missing', () => {
    const cctv = createSubnet('10.20.0.0/24', { name: 'CCTV' });
    const office = createSubnet('10.10.0.0/24', { name: 'Office' });
    const inOffice = dev({ role: 'camera', managementIp: '10.10.0.21/24' });
    const orphan = dev({ role: 'camera', managementIp: '192.168.1.5' });
    const bare = dev({ role: 'camera', managementIp: '' });
    const rule = createPlacementRule('camera', 'CCTV');
    const c = ctx([inOffice, orphan, bare], [], [cctv, office]);
    expect(explainOffenders(rule.id, [inOffice.id, orphan.id, bare.id], c, [rule]).map((o) => o.reason)).toEqual([
      '10.10.0.21 is in “Office”, not “CCTV”',
      '192.168.1.5 is in no subnet, not “CCTV”',
      'no management IP',
    ]);
    const ghost = createPlacementRule('camera', 'Ghost');
    expect(explainOffenders(ghost.id, [inOffice.id], c, [ghost])[0]!.reason).toBe('no subnet named “Ghost”');
  });

  it('drops objects that no longer exist', () => {
    expect(explainOffenders('every-device-named', ['gone'], ctx([]))).toEqual([]);
  });
});

describe('ruleOffenderIds', () => {
  it('unions the offenders of every violation', () => {
    expect(
      [...ruleOffenderIds([
        { id: 'r1', label: 'a', objectIds: ['x', 'y'] },
        { id: 'r2', label: 'b', objectIds: ['y', 'z'] },
      ])].sort(),
    ).toEqual(['x', 'y', 'z']);
    expect(ruleOffenderIds([]).size).toBe(0);
  });
});

describe('count rules', () => {
  it('counts by role or device type, case-insensitively', () => {
    const fw = createDevice('firewall', 0, 0, L);
    const edge = dev({ role: 'Firewall' }); // a switch carrying the role
    const other = dev({ role: 'core' });
    expect(countedDevices('firewall', [fw, edge, other]).map((d) => d.id)).toEqual([fw.id, edge.id]);
    expect(countedDevices('  ', [fw])).toEqual([]);
  });

  it('is broken by absence: no offenders, just the shortfall', () => {
    const rule = createCountRule('core', 3);
    const v = evaluateCustomRules([rule], ctx([dev({ role: 'core' })]));
    expect(v).toEqual([{ id: rule.id, label: 'At least 3 “core”', objectIds: [], shortfall: 2 }]);
    expect(violationTodo(v[0]!)).toBe('2 short');
    expect(evaluateCustomRules([rule], ctx([]))[0]?.shortfall).toBe(3); // none at all is short, not vacuous
  });

  it('is met at the minimum, and skips half-authored rules', () => {
    const two = [dev({ role: 'core' }), dev({ role: 'core' })];
    expect(evaluateCustomRules([createCountRule('core', 2)], ctx(two))).toEqual([]);
    expect(evaluateCustomRules([createCountRule('', 2), createCountRule('core', 0)], ctx([]))).toEqual([]);
  });

  it('is restorable, and reads as a sentence', () => {
    const r = createCountRule('firewall', 2);
    expect(isCustomRuleRestorable(r)).toBe(true);
    expect(customRuleLabel(r)).toBe('At least 2 “firewall”');
    expect(violationTodo({ id: 'x', label: 'x', objectIds: ['a', 'b'] })).toBe('2 to fix');
  });

  it('plans copies of the best-connected counted device, wired to its neighbors', () => {
    const lone = dev({ role: 'core' });
    const hub = dev({ role: 'core' });
    const a = dev({ role: 'access' });
    const b = dev({ role: 'access' });
    const plan = planCount(createCountRule('core', 3), [lone, hub, a, b], [link(a.id, hub.id), link(hub.id, b.id)]);
    expect(plan).toEqual({ sourceId: hub.id, copies: 1, neighborIds: [a.id, b.id].sort() });
  });

  it('refuses to plan from nothing, and plans nothing when met', () => {
    expect(planCount(createCountRule('core', 2), [], [])).toEqual({ sourceId: null, copies: 2, neighborIds: [] });
    const met = planCount(createCountRule('core', 1), [dev({ role: 'core' })], []);
    expect(met.copies).toBe(0);
    expect(met.sourceId).toBeNull();
  });
});
