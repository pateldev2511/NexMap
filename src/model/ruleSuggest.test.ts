import { describe, expect, it } from 'vitest';
import { createDevice, createLink, createSubnet } from './schema';
import { createCountRule, evaluateCustomRules, evaluateInvariants } from './invariants';
import { suggestRules } from './ruleSuggest';
import type { CustomRuleSpec, Device, Link, Subnet } from './types';

const L = 'layer';
const none = { invariants: new Set<string>(), customRules: [] as CustomRuleSpec[] };
const ctx = (devices: Device[], links: Link[] = [], subnets: Subnet[] = []) => ({ devices, links, subnets });

/** A small campus: 2 firewalls → 2 cores → 2 access (each dual-homed), cameras in CCTV, a walled-off guest kiosk. */
function campus() {
  const cctv = createSubnet('10.20.0.0/24', { name: 'CCTV', gateway: '10.20.0.1' });
  const fw1 = createDevice('firewall', 0, 0, L, { name: 'FW1', managementIp: '10.0.0.1' });
  const fw2 = createDevice('firewall', 0, 0, L, { name: 'FW2', managementIp: '10.0.0.2' });
  const c1 = createDevice('switch', 0, 0, L, { name: 'C1', role: 'core', managementIp: '10.0.0.3' });
  const c2 = createDevice('switch', 0, 0, L, { name: 'C2', role: 'core', managementIp: '10.0.0.4' });
  const a1 = createDevice('switch', 0, 0, L, { name: 'A1', role: 'access', managementIp: '10.0.0.5' });
  const a2 = createDevice('switch', 0, 0, L, { name: 'A2', role: 'access', managementIp: '10.0.0.6' });
  const cam1 = createDevice('camera', 0, 0, L, { name: 'Cam1', role: 'camera', managementIp: '10.20.0.10' });
  const cam2 = createDevice('camera', 0, 0, L, { name: 'Cam2', role: 'camera', managementIp: '10.20.0.11' });
  const kiosk = createDevice('end-user', 0, 0, L, { name: 'Kiosk', role: 'guest', managementIp: '192.168.9.9' });
  const links = [
    [fw1, c1], [fw1, c2], [fw2, c1], [fw2, c2],
    [a1, c1], [a1, c2], [a2, c1], [a2, c2],
    [cam1, a1], [cam2, a2],
  ].map(([x, y]) => createLink(x!.id, y!.id, L));
  return ctx([fw1, fw2, c1, c2, a1, a2, cam1, cam2, kiosk], links, [cctv]);
}

describe('suggestRules', () => {
  it('offers to lock in what the design already does, redundancy first', () => {
    const labels = suggestRules(campus(), none).map((s) => s.label);
    expect(labels).toContain('At least 2 “core”');
    expect(labels).toContain('At least 2 “firewall”'); // by type: no role needed
    expect(labels).toContain('Every “access” connects to ≥2 “core”');
    expect(labels).toContain('Every “camera” lives in “CCTV”');
    expect(labels).not.toContain('At least 2 “camera”'); // two cameras isn't redundancy
    expect(labels[0]).toBe('At least 2 “firewall”'); // redundancy leads
    expect(labels).toContain('No “guest” may reach “access”'); // the walled-off side leads
    expect(labels.length).toBeLessThanOrEqual(8);
    // Lower tier first: the uplink, not its mirror.
    const up = labels.indexOf('Every “access” connects to ≥2 “core”');
    const mirror = labels.indexOf('Every “core” connects to ≥2 “access”');
    expect(up).toBeGreaterThanOrEqual(0);
    expect(mirror === -1 || mirror > up).toBe(true);
  });

  it('only ever suggests rules that hold right now', () => {
    const c = campus();
    for (const s of suggestRules(c, none)) {
      if (s.builtInId) {
        expect(evaluateInvariants(c, new Set([s.builtInId]))).toEqual([]);
      } else {
        const r = s.rule!;
        const spec: CustomRuleSpec = {
          id: 'x',
          kind: r.kind,
          fromRole: r.fromRole,
          toRole: r.kind === 'placement' || r.kind === 'count' ? '' : r.target,
          min: r.min,
          ...(r.kind === 'placement' ? { subnet: r.target } : {}),
        };
        expect(evaluateCustomRules([spec], c)).toEqual([]);
      }
    }
  });

  it('skips what is already declared, built-in or authored (whatever its minimum)', () => {
    const c = campus();
    const all = suggestRules(c, none);
    const builtIn = all.find((s) => s.builtInId)!;
    const after = suggestRules(c, {
      invariants: new Set([builtIn.builtInId!]),
      customRules: [createCountRule('core', 3)],
    }).map((s) => s.key);
    expect(after).not.toContain(builtIn.key);
    expect(after).not.toContain('count:core:');
  });

  it('keeps the uplink direction when link counts tie (edge distance decides)', () => {
    const c = campus();
    const fw2 = c.devices.find((d) => d.name === 'FW2')!;
    // Without FW2, core and access each have 3 links per device: a tie on degree.
    const labels = suggestRules(
      { ...c, devices: c.devices.filter((d) => d !== fw2), links: c.links.filter((l) => l.sourceId !== fw2.id && l.targetId !== fw2.id) },
      none,
    ).map((s) => s.label);
    expect(labels).toContain('Every “access” connects to ≥2 “core”');
    expect(labels).not.toContain('Every “core” connects to ≥2 “access”');
  });

  it('does not suggest a broken pattern', () => {
    const c = campus();
    const a1 = c.devices.find((d) => d.name === 'A1')!;
    // Cut A1 down to one core: the dual-homing rule isn't true any more, ≥1 still is.
    const links = c.links.filter((l) => !(l.sourceId === a1.id && l.targetId === c.devices.find((d) => d.name === 'C2')!.id));
    const labels = suggestRules({ ...c, links }, none).map((s) => s.label);
    expect(labels).not.toContain('Every “access” connects to ≥2 “core”');
    expect(labels).toContain('Every “access” connects to ≥1 “core”');
  });

  it('suggests isolation only for a wired design, and never a lone device as a pattern', () => {
    const g = createDevice('end-user', 0, 0, L, { role: 'guest' });
    const db = createDevice('server', 0, 0, L, { role: 'internal' });
    expect(suggestRules(ctx([g, db]), none).some((s) => s.rule?.kind === 'isolation')).toBe(false);
    const sw = createDevice('switch', 0, 0, L, { role: 'core' });
    const wired = suggestRules(ctx([g, db, sw], [createLink(db.id, sw.id, L)]), none);
    expect(wired.map((s) => s.label)).toContain('No “guest” may reach “internal”');
    expect(wired.some((s) => s.rule?.kind === 'connectivity')).toBe(false); // one of each role
  });

  it('suggests nothing for an (almost) empty design, and no vacuous gateway rule', () => {
    expect(suggestRules(ctx([createDevice('switch', 0, 0, L)]), none)).toEqual([]);
    const two = ctx([createDevice('switch', 0, 0, L), createDevice('switch', 0, 0, L)]);
    expect(suggestRules(two, none).some((s) => s.builtInId === 'every-subnet-has-gateway')).toBe(false);
  });
});

describe('suggestRules · VLAN placement', () => {
  it('suggests the VLAN when a role spreads over several subnets that share it', () => {
    const a = createSubnet('10.20.0.0/24', { name: 'CCTV-A', vlanId: 20 });
    const b = createSubnet('10.21.0.0/24', { name: 'CCTV-B', vlanId: 20 });
    const cam1 = createDevice('camera', 0, 0, L, { name: 'Cam1', role: 'camera', managementIp: '10.20.0.10' });
    const cam2 = createDevice('camera', 0, 0, L, { name: 'Cam2', role: 'camera', managementIp: '10.21.0.10' });
    const labels = suggestRules(ctx([cam1, cam2], [], [a, b]), none).map((s) => s.label);
    expect(labels).toContain('Every “camera” is on VLAN 20');
  });

  it('no VLAN suggestion when the subnets are on different VLANs (or none)', () => {
    const a = createSubnet('10.20.0.0/24', { name: 'A', vlanId: 20 });
    const b = createSubnet('10.21.0.0/24', { name: 'B', vlanId: 21 });
    const cam1 = createDevice('camera', 0, 0, L, { name: 'Cam1', role: 'camera', managementIp: '10.20.0.10' });
    const cam2 = createDevice('camera', 0, 0, L, { name: 'Cam2', role: 'camera', managementIp: '10.21.0.10' });
    expect(suggestRules(ctx([cam1, cam2], [], [a, b]), none).some((s) => /VLAN/.test(s.label))).toBe(false);
  });
});
