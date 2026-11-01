/**
 * Invariants M2: restoreInvariant wires each declared rule to the fixer that owns
 * its remedy. These are end-to-end: declare a rule, break it, restore, and assert
 * the violation clears (or shrinks honestly).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const violated = (id: string) => s().invariantViolations.some((v) => v.id === id);

beforeEach(() => s().newProject(NOW));

describe('restoreInvariant', () => {
  it('every-device-named: names the blank device and clears the rule', () => {
    const d = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(d, { name: s().devicesAll()[0]!.name }, { name: '' });
    s().toggleInvariant('every-device-named');
    expect(violated('every-device-named')).toBe(true);

    const fixed = s().restoreInvariant('every-device-named');
    expect(fixed).toBe(1);
    expect(violated('every-device-named')).toBe(false);
  });

  it('every-device-addressed: addresses the device and clears the rule', () => {
    const d = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(d, {}, { managementIp: '' });
    s().toggleInvariant('every-device-addressed');
    expect(violated('every-device-addressed')).toBe(true);

    s().restoreInvariant('every-device-addressed');
    expect(violated('every-device-addressed')).toBe(false);
  });

  it('every-subnet-has-gateway: adopts an in-range router and clears the rule', () => {
    const r = s().addDeviceAt('router', 0, 0);
    s().updateDevice(r, {}, { managementIp: '10.0.0.1' });
    s().addSubnet('10.0.0.0/24'); // gateway-less
    s().toggleInvariant('every-subnet-has-gateway');
    expect(violated('every-subnet-has-gateway')).toBe(true);

    s().restoreInvariant('every-subnet-has-gateway');
    expect(violated('every-subnet-has-gateway')).toBe(false);
  });

  it('no-single-point-of-failure: hardens the SPOF and clears the rule', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const hub = s().addDeviceAt('switch', 200, 0);
    const b = s().addDeviceAt('server', 400, 0);
    s().connect(a, hub);
    s().connect(b, hub); // hub is the single point of failure
    s().toggleInvariant('no-single-point-of-failure');
    expect(violated('no-single-point-of-failure')).toBe(true);

    s().restoreInvariant('no-single-point-of-failure');
    expect(violated('no-single-point-of-failure')).toBe(false);
  });

  it('is a no-op for an unknown id', () => {
    expect(s().restoreInvariant('nope')).toBe(0);
  });
});

describe('twin naming from an unnamed source', () => {
  const spof = () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const hub = s().addDeviceAt('switch', 200, 0);
    const b = s().addDeviceAt('server', 400, 0);
    s().connect(a, hub);
    s().connect(b, hub);
    s().updateDevice(hub, {}, { name: '' }); // the SPOF has no name
    return hub;
  };
  // Regression: a blank source used to yield a twin named "" or " 2".
  const twinNames = (before: Set<string>) =>
    s().devicesAll().filter((d) => !before.has(d.id)).map((d) => d.name);

  it('hardenDesign names the twin from its type', () => {
    spof();
    const before = new Set(s().devicesAll().map((d) => d.id));
    s().hardenDesign();
    const names = twinNames(before);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^Switch( \d+)?$/);
  });

  it('addRedundantTwin names the twin from its type', () => {
    const hub = spof();
    const before = new Set(s().devicesAll().map((d) => d.id));
    s().addRedundantTwin(hub);
    const names = twinNames(before);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^Switch( \d+)?$/);
  });
});

describe('restoreAllInvariants', () => {
  it('restores every declared, violated rule in one pass', () => {
    // A SPOF topology that also breaks naming and addressing.
    const a = s().addDeviceAt('switch', 0, 0);
    const hub = s().addDeviceAt('switch', 200, 0);
    const b = s().addDeviceAt('server', 400, 0);
    s().connect(a, hub);
    s().connect(b, hub); // hub is the SPOF
    for (const id of [a, hub, b]) s().updateDevice(id, {}, { name: '', managementIp: '' });

    s().toggleInvariant('no-single-point-of-failure');
    s().toggleInvariant('every-device-named');
    s().toggleInvariant('every-device-addressed');
    expect(s().invariantViolations.length).toBe(3);

    const changed = s().restoreAllInvariants();
    expect(changed).toBeGreaterThan(0);
    // All three declared rules are met — including on the twin harden minted,
    // because naming + addressing run after harden in the same pass.
    expect(s().invariantViolations).toEqual([]);
  });

  it('is an honest no-op when every declared rule is already met', () => {
    const d = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(d, {}, { managementIp: '10.0.0.2' });
    s().toggleInvariant('every-device-addressed');
    expect(s().invariantViolations).toEqual([]);

    expect(s().restoreAllInvariants()).toBe(0);
    expect(s().flash).toMatch(/already met/);
  });
});

describe('placement rules (authored, restorable)', () => {
  const ruleId = () => s().customRules[0]!.id;
  const cam = (ip: string) => {
    const id = s().addDeviceAt('server', 0, 0);
    s().updateDevice(id, {}, { role: 'camera', managementIp: ip });
    return id;
  };
  const named = (cidr: string, name: string) => {
    const id = s().addSubnet(cidr);
    s().updateSubnet(id, {}, { name });
    return id;
  };

  it('re-addresses offenders into the subnet, undoable in one step', () => {
    named('10.20.0.0/24', 'CCTV');
    named('10.10.0.0/24', 'Office');
    const a = cam('10.10.0.5');
    s().addCustomRule('placement', 'camera', 'CCTV', 0);
    expect(s().customRules[0]!.subnet).toBe('CCTV');
    expect(violated(ruleId())).toBe(true);

    expect(s().restoreInvariant(ruleId())).toBe(1);
    expect(s().devicesAll().find((d) => d.id === a)!.managementIp).toMatch(/^10\.20\.0\./);
    expect(violated(ruleId())).toBe(false);
    expect(s().flash).toMatch(/Re-addressed 1 device into “CCTV”/);

    s().undo();
    s().runValidation();
    expect(s().devicesAll().find((d) => d.id === a)!.managementIp).toBe('10.10.0.5');
    expect(violated(ruleId())).toBe(true);
  });

  it('a VLAN rule restores into the VLAN’s one subnet, and names it', () => {
    const cctv = named('10.20.0.0/24', 'CCTV');
    s().updateSubnet(cctv, {}, { vlanId: 20 });
    named('10.10.0.0/24', 'Office');
    const a = cam('10.10.0.5');
    s().addCustomRule('placement', 'camera', 'vlan20', 0);
    expect(s().customRules[0]!.subnet).toBe('VLAN 20');
    expect(s().flash).toBe('Declared Every “camera” is on VLAN 20 — 1 to fix.');
    expect(s().restoreInvariant(ruleId())).toBe(1);
    expect(s().devicesAll().find((d) => d.id === a)!.managementIp).toMatch(/^10\.20\.0\./);
    expect(s().flash).toMatch(/Re-addressed 1 device into VLAN 20 \(“CCTV”\)/);
  });

  it('a VLAN rule retags the switch port a camera is patched into, undoable in one step', () => {
    const cctv = named('10.20.0.0/24', 'CCTV');
    s().updateSubnet(cctv, {}, { vlanId: 20 });
    const camId = cam('10.20.0.10'); // right address…
    const sw = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(sw, {}, { name: 'SW1' });
    const gi = s().addInterface(sw, 'Gi0/3')!;
    s().updateInterface(sw, gi, { vlan: 10 }); // …wrong access port
    const linkId = s().connect(sw, camId)!;
    s().updateLink(linkId, {}, { sourceIfaceId: gi });
    s().endEdit();
    s().addCustomRule('placement', 'camera', 'VLAN 20', 0);
    expect(violated(ruleId())).toBe(true);

    expect(s().restoreInvariant(ruleId())).toBe(1);
    const port = () => s().devicesAll().find((d) => d.id === sw)!.interfaces!.find((i) => i.id === gi)!;
    expect(port().vlan).toBe(20);
    expect(s().devicesAll().find((d) => d.id === camId)!.managementIp).toBe('10.20.0.10'); // address untouched
    expect(s().flash).toBe('Retagged 1 port to VLAN 20 (SW1 Gi0/3).');
    expect(violated(ruleId())).toBe(false);

    s().undo();
    expect(port().vlan).toBe(10);
  });

  it('a VLAN rule sees a rack patch cable, and Restore retags the port through it', () => {
    const cctv = named('10.20.0.0/24', 'CCTV');
    s().updateSubnet(cctv, {}, { vlanId: 20 });
    const camId = cam('10.20.0.10');
    const eth = s().addInterface(camId, 'eth0')!;
    const sw = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(sw, {}, { name: 'SW1' });
    const gi = s().addInterface(sw, 'Gi0/3')!;
    s().updateInterface(sw, gi, { vlan: 10 });
    s().endEdit();
    // Patched in the rack view only: no logical link between them.
    expect(s().connectRackCable({ deviceId: sw, ifaceId: gi }, { deviceId: camId, ifaceId: eth }, '#22d3ee')).toBeTruthy();
    s().addCustomRule('placement', 'camera', 'VLAN 20', 0);
    expect(violated(ruleId())).toBe(true);
    expect(s().restoreInvariant(ruleId())).toBe(1);
    expect(s().flash).toBe('Retagged 1 port to VLAN 20 (SW1 Gi0/3).');
    expect(violated(ruleId())).toBe(false);
  });

  it('a VLAN spanning two subnets: refuses and says why', () => {
    for (const [cidr, name] of [['10.20.0.0/24', 'CCTV-A'], ['10.21.0.0/24', 'CCTV-B']] as const) {
      s().updateSubnet(named(cidr, name), {}, { vlanId: 20 });
    }
    cam('10.10.0.5');
    s().addCustomRule('placement', 'camera', 'VLAN 20', 0);
    expect(s().restoreInvariant(ruleId())).toBe(0);
    expect(s().flash).toBe('Couldn’t restore Every “camera” is on VLAN 20 — VLAN 20 spans 2 subnets, and Conductor won’t guess which.');
  });

  it('refuses honestly when the subnet does not exist', () => {
    cam('10.10.0.5');
    s().addCustomRule('placement', 'camera', 'Ghost', 0);
    expect(s().restoreInvariant(ruleId())).toBe(0);
    expect(s().flash).toMatch(/Couldn’t restore/);
    expect(violated(ruleId())).toBe(true);
  });

  it('restore-all homes placement before auto-address, so a bare camera lands in its subnet', () => {
    named('10.10.0.0/24', 'Office'); // first subnet: where auto-address would put it
    named('10.20.0.0/24', 'CCTV');
    const bare = cam('');
    s().toggleInvariant('every-device-addressed');
    s().addCustomRule('placement', 'camera', 'CCTV', 0);
    s().runValidation();

    s().restoreAllInvariants();
    expect(s().devicesAll().find((d) => d.id === bare)!.managementIp).toMatch(/^10\.20\.0\./);
    expect(s().invariantViolations).toEqual([]);
  });
});

describe('count rules (authored, restorable)', () => {
  const countRule = () => s().customRules.find((r) => r.kind === 'count')!;

  it('adds wired copies of the best-connected one, with its role, in one undo', () => {
    const core = s().addDeviceAt('switch', 0, 0);
    const a = s().addDeviceAt('switch', -200, 200);
    const b = s().addDeviceAt('switch', 200, 200);
    s().updateDevice(core, {}, { role: 'core', managementIp: '10.0.0.1' });
    s().connect(a, core);
    s().connect(b, core);
    s().addCustomRule('count', 'core', '', 3);
    expect(s().flash).toBe('Declared At least 3 “core” — 2 short.');

    expect(s().restoreInvariant(countRule().id)).toBe(2);
    const cores = s().devicesAll().filter((d) => d.role === 'core');
    expect(cores).toHaveLength(3);
    for (const c of cores.filter((d) => d.id !== core)) {
      expect(c.managementIp ?? '').toBe(''); // never a duplicate address
      const peers = s()
        .linksAll()
        .filter((l) => l.sourceId === c.id || l.targetId === c.id)
        .map((l) => (l.sourceId === c.id ? l.targetId : l.sourceId))
        .sort();
      expect(peers).toEqual([a, b].sort());
    }
    expect(violated(countRule().id)).toBe(false);
    expect(new Set(cores.map((c) => c.name)).size).toBe(3); // unique names

    s().undo();
    s().runValidation(); // the app re-validates on rev change (debounced)
    expect(s().devicesAll().filter((d) => d.role === 'core')).toHaveLength(1);
    expect(violated(countRule().id)).toBe(true);
  });

  it('refuses, and says so, when there is nothing to copy', () => {
    s().addCustomRule('count', 'firewall', '', 2);
    expect(s().restoreInvariant(countRule().id)).toBe(0);
    expect(s().flash).toBe('Couldn’t restore At least 2 “firewall” — there’s no “firewall” to copy yet. Add one first.');
    expect(s().devicesAll()).toHaveLength(0);
  });

  it('counts device types, and restore-all mints copies first', () => {
    s().addDeviceAt('firewall', 0, 0);
    s().addCustomRule('count', 'firewall', '', 2);
    s().toggleInvariant('every-device-named');
    expect(s().restoreAllInvariants()).toBeGreaterThanOrEqual(1);
    expect(s().devicesAll().filter((d) => d.type === 'firewall')).toHaveLength(2);
    expect(violated(countRule().id)).toBe(false);
  });

  it('a redundant twin keeps its role (a twin of a core is a core)', () => {
    const core = s().addDeviceAt('switch', 0, 0);
    const a = s().addDeviceAt('switch', 0, 200);
    s().updateDevice(core, {}, { role: 'core' });
    s().connect(a, core);
    expect(s().addRedundantTwin(core)).toBe(1);
    expect(s().devicesAll().filter((d) => d.role === 'core')).toHaveLength(2);
  });
});

describe('deleting what a rule depends on', () => {
  it('says which held rule the delete broke', () => {
    const f1 = s().addDeviceAt('firewall', 0, 0);
    s().addDeviceAt('firewall', 200, 0);
    s().addCustomRule('count', 'firewall', '', 2);
    s().select([f1]);
    s().deleteSelection();
    expect(s().flash).toBe('That delete broke At least 2 “firewall”. ⌘Z puts it back.');
  });

  it('stays quiet when nothing held breaks (or nothing is declared)', () => {
    useProjectStore.setState({ flash: null }); // the toast outlives newProject
    const a = s().addDeviceAt('switch', 0, 0);
    s().addDeviceAt('switch', 200, 0);
    s().select([a]);
    s().deleteSelection();
    expect(s().flash ?? '').not.toMatch(/broke/);
    s().addCustomRule('count', 'router', '', 2); // already short: deleting can't newly break it
    const b = s().devicesAll()[0]!.id;
    s().select([b]);
    s().deleteSelection();
    expect(s().flash ?? '').not.toMatch(/broke/);
  });
});
