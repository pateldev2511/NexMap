import { describe, it, expect } from 'vitest';
import { parseNexText, buildModel, serializeNexText } from './nextext';

/** Deterministic id generator for stable assertions. */
function seqIds() {
  let n = 0;
  return () => `id${n++}`;
}

describe('parseNexText — devices', () => {
  it('parses a device with type alias and attributes', () => {
    const r = parseNexText('sw SW1 vendor=Cisco model=C9300 ip=10.0.0.2');
    expect(r.diagnostics).toEqual([]);
    expect(r.devices).toHaveLength(1);
    expect(r.devices[0]).toMatchObject({
      name: 'SW1',
      type: 'switch',
      auto: false,
      props: { vendor: 'Cisco', model: 'C9300', managementIp: '10.0.0.2' },
    });
  });

  it('honors quoted names and values with spaces', () => {
    const r = parseNexText('server "Web 01" role="App Tier"');
    expect(r.devices[0]?.name).toBe('Web 01');
    expect(r.devices[0]?.props.role).toBe('App Tier');
  });

  it('uses name= to override the display name', () => {
    const r = parseNexText('router R1 name="Core Router"');
    expect(r.devices[0]?.name).toBe('R1');
    expect(r.devices[0]?.props.name).toBe('Core Router');
  });

  it('errors (does not throw) on an unknown device type', () => {
    const r = parseNexText('frobnicator X1');
    expect(r.devices).toHaveLength(0);
    expect(r.diagnostics[0]).toMatchObject({ line: 1, severity: 'error' });
  });

  it('stores unknown attributes in extra', () => {
    const r = parseNexText('router R1 asn=65001');
    expect(r.devices[0]?.props.extra).toEqual({ asn: '65001' });
  });

  it('ignores comments and blank lines', () => {
    const r = parseNexText('# a comment\n\nrouter R1 # inline\n');
    expect(r.devices).toHaveLength(1);
    expect(r.diagnostics).toEqual([]);
  });
});

describe('parseNexText — links', () => {
  it('links two declared devices', () => {
    const r = parseNexText('router R1\nswitch SW1\nR1 - SW1 vlan=10 bw=1G');
    expect(r.links).toHaveLength(1);
    expect(r.links[0]).toMatchObject({
      source: 'R1',
      target: 'SW1',
      props: { vlan: '10', bandwidth: '1G' },
    });
  });

  it('auto-creates undeclared endpoints as generic nodes with a warning', () => {
    const r = parseNexText('R1 - SW1');
    expect(r.devices.map((d) => d.name).sort()).toEqual(['R1', 'SW1']);
    expect(r.devices.every((d) => d.type === 'generic' && d.auto)).toBe(true);
    expect(r.diagnostics.filter((d) => d.severity === 'warn')).toHaveLength(2);
  });

  it('a later declaration upgrades an auto-created node', () => {
    const r = parseNexText('R1 - SW1\nrouter R1');
    const r1 = r.devices.find((d) => d.name === 'R1')!;
    expect(r1.type).toBe('router');
    expect(r1.auto).toBe(false);
  });

  it('sets arrow for directed operators', () => {
    expect(parseNexText('A -> B').links[0]?.props.arrow).toBe('end');
    expect(parseNexText('A <-> B').links[0]?.props.arrow).toBe('both');
    expect(parseNexText('A - B').links[0]?.props.arrow).toBeUndefined();
  });

  it('errors on malformed link syntax without throwing', () => {
    const r = parseNexText('A B - C D');
    expect(r.diagnostics[0]?.severity).toBe('error');
    expect(r.links).toHaveLength(0);
  });
});

describe('parseNexText — subnets and vlans', () => {
  it('parses a subnet with gateway and vlan', () => {
    const r = parseNexText('subnet 10.0.0.0/24 name=Core gw=10.0.0.1 vlan=10');
    expect(r.subnets[0]).toMatchObject({
      cidr: '10.0.0.0/24',
      props: { name: 'Core', gateway: '10.0.0.1', vlanId: 10 },
    });
  });

  it('warns on an invalid CIDR but still records it', () => {
    const r = parseNexText('subnet not-a-cidr');
    expect(r.subnets).toHaveLength(1);
    expect(r.diagnostics.some((d) => d.severity === 'warn')).toBe(true);
  });

  it('parses a vlan and warns on out-of-range id', () => {
    expect(parseNexText('vlan 10 name=Users').vlans[0]).toMatchObject({ vlanId: 10 });
    const r = parseNexText('vlan 9999');
    expect(r.diagnostics.some((d) => /1–4094/.test(d.message))).toBe(true);
  });

  it('errors on a non-numeric vlan id', () => {
    const r = parseNexText('vlan abc');
    expect(r.diagnostics[0]?.severity).toBe('error');
    expect(r.vlans).toHaveLength(0);
  });
});

describe('buildModel', () => {
  it('mints ids, resolves link endpoints, and lays out positions', () => {
    const r = parseNexText('router R1\nswitch SW1\nR1 - SW1');
    const m = buildModel(r, { layerId: 'L1', idGen: seqIds() });
    expect(m.devices).toHaveLength(2);
    expect(m.links).toHaveLength(1);
    const r1 = m.devices.find((d) => d.name === 'R1')!;
    const sw1 = m.devices.find((d) => d.name === 'SW1')!;
    expect(m.links[0]?.sourceId).toBe(r1.id);
    expect(m.links[0]?.targetId).toBe(sw1.id);
    // layout assigned non-default coordinates to at least one node
    expect(m.devices.some((d) => d.x !== 0 || d.y !== 0)).toBe(true);
    expect(m.devices.every((d) => d.layerId === 'L1')).toBe(true);
  });

  it('builds subnets and vlans', () => {
    const r = parseNexText('subnet 10.0.0.0/24 name=Core\nvlan 10 name=Users');
    const m = buildModel(r, { layerId: 'L1', idGen: seqIds() });
    expect(m.subnets[0]).toMatchObject({ cidr: '10.0.0.0/24', name: 'Core' });
    expect(m.vlans[0]).toMatchObject({ vlanId: 10, name: 'Users' });
  });
});

describe('serializeNexText — round trip', () => {
  it('round-trips devices, links, subnets, and vlans at the semantic level', () => {
    const src = [
      'router R1 vendor=Cisco',
      'switch SW1',
      'server "Web 01" role="App Tier"',
      'R1 - SW1 vlan=10',
      'SW1 -> "Web 01"',
      'subnet 10.0.0.0/24 name=Core gateway=10.0.0.1 vlan=10',
      'vlan 10 name=Users',
    ].join('\n');

    const m1 = buildModel(parseNexText(src), { layerId: 'L1', idGen: seqIds() });
    const text = serializeNexText(m1);
    const m2 = buildModel(parseNexText(text), { layerId: 'L1', idGen: seqIds() });

    const norm = (m: typeof m1) => ({
      devices: m.devices.map((d) => ({ name: d.name, type: d.type, vendor: d.vendor, role: d.role })),
      links: m.links
        .map((l) => {
          const byId = new Map(m.devices.map((d) => [d.id, d.name]));
          return { s: byId.get(l.sourceId), t: byId.get(l.targetId), vlan: l.vlan, arrow: l.arrow };
        })
        .sort((a, b) => `${a.s}${a.t}`.localeCompare(`${b.s}${b.t}`)),
      subnets: m.subnets.map((s) => ({ cidr: s.cidr, name: s.name, gateway: s.gateway, vlanId: s.vlanId })),
      vlans: m.vlans.map((v) => ({ vlanId: v.vlanId, name: v.name })),
    });

    expect(norm(m2)).toEqual(norm(m1));
  });

  it('never throws on empty input', () => {
    expect(serializeNexText({ devices: [], links: [] })).toBe('');
    expect(parseNexText('').diagnostics).toEqual([]);
  });
});
