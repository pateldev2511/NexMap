import { describe, it, expect } from 'vitest';
import {
  parseNexText,
  buildModel,
  serializeNexText,
  scanLine,
  quoteNexText,
  nexTextHandles,
  planNexText,
  summarizeNexTextPlan,
  describeNexTextLosses,
  describeNexTextKept,
} from './nextext';
import { createDevice, createLink, createSubnet, createVlan } from '@/model/schema';
import type { Device, Link, Subnet, Vlan } from '@/model/types';

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

// ── #88: one string-literal contract ─────────────────────────────────────────

/** Every awkward string the issue names, plus the ones the grammar makes special. */
const TRICKY: [label: string, value: string][] = [
  ['hash', 'WAN#1'],
  ['leading hash', '#12'],
  ['double quotes', 'HQ "Primary"'],
  ['single quote', "O'Brien"],
  ['both quote styles', `it's "fine"`],
  ['backslash', 'C:\\racks\\a'],
  ['trailing backslash', 'end\\'],
  ['backslash-n text', 'literal \\n not a newline'],
  ['space', 'Core Switch'],
  ['edge spaces', '  padded  '],
  ['tab', 'a\tb'],
  ['newline', 'line one\nline two'],
  ['carriage return', 'a\r\nb\rc'],
  ['unicode', 'Zürich-核心 🛰 é'],
  ['arrow', '->'],
  ['arrow-like text', 'a->b <-> c'],
  ['dash', '-'],
  ['double dash', '--'],
  ['keyword subnet', 'subnet'],
  ['keyword VLAN', 'VLAN'],
  ['type keyword', 'router'],
  ['equals', 'a=b=c'],
  ['empty', ''],
];

const dev = (name: string, over: Partial<Device> = {}): Device =>
  createDevice('router', 0, 0, 'L1', { name, ...over });

describe('NexText string literals (#88)', () => {
  it.each(TRICKY)('quoteNexText → scanLine is exact for %s', (_label, value) => {
    const scan = scanLine(`x ${quoteNexText(value)} k=${quoteNexText(value)}`);
    expect(scan.error).toBeUndefined();
    expect(scan.tokens).toHaveLength(3);
    expect(scan.tokens[1]!.text).toBe(value);
    expect(scan.tokens[2]).toMatchObject({ key: 'k', value });
  });

  it.each(TRICKY)('round-trips %s as a name, a link endpoint and attribute values', (_label, value) => {
    const a = dev(value, { vendor: value, notes: value, location: value });
    const peer = dev('peer');
    const link = createLink(a.id, peer.id, 'L1', { vlan: value, circuitId: value });
    const text = serializeNexText({
      devices: [a, peer],
      links: [link],
      subnets: [createSubnet('10.0.0.0/24', { name: value })],
      vlans: [createVlan(10, value)],
    });
    const r = parseNexText(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.devices.map((d) => d.name)).toEqual([value, 'peer']);
    // The serializer omits empty values, so '' reads back as absent.
    const attr = value === '' ? undefined : value;
    expect(r.devices[0]!.props.vendor).toBe(attr);
    expect(r.devices[0]!.props.notes).toBe(attr);
    expect(r.devices[0]!.props.location).toBe(attr);
    expect(r.links).toHaveLength(1);
    expect(r.links[0]).toMatchObject({ source: value, target: 'peer' });
    expect(r.links[0]!.props.vlan).toBe(attr);
    expect(r.links[0]!.props.circuitId).toBe(attr);
    expect(r.subnets[0]!.props.name).toBe(attr);
    expect(r.vlans[0]!.props.name).toBe(attr);
    // …and against the model it came from, the text is a no-op.
    const plan = planNexText(r, { devices: [a, peer], links: [link] });
    expect(plan.deviceUpdates).toEqual([]);
    expect(plan.linkUpdates).toEqual([]);
    expect(plan.addDevices).toEqual([]);
    expect(plan.removeDeviceIds).toEqual([]);
  });

  it('keeps WAN and WAN#1 as two devices with their own attributes and links', () => {
    const wan = createDevice('isp', 0, 0, 'L1', { name: 'WAN', location: 'Carrier-B' });
    const wan1 = createDevice('isp', 0, 0, 'L1', { name: 'WAN#1', location: 'Carrier-A' });
    const fw = createDevice('firewall', 0, 0, 'L1', { name: 'FW' });
    const links = [createLink(wan.id, fw.id, 'L1', { circuitId: 'B' }), createLink(wan1.id, fw.id, 'L1', { circuitId: 'A' })];
    const r = parseNexText(serializeNexText({ devices: [wan, wan1, fw], links }));
    expect(r.diagnostics).toEqual([]);
    expect(r.devices.map((d) => [d.name, d.props.location])).toEqual([
      ['WAN', 'Carrier-B'],
      ['WAN#1', 'Carrier-A'],
      ['FW', undefined],
    ]);
    expect(r.links.map((l) => [l.source, l.target, l.props.circuitId])).toEqual([
      ['WAN', 'FW', 'B'],
      ['WAN#1', 'FW', 'A'],
    ]);
  });

  it('still treats # as a comment at line start or after whitespace, but not inside a value', () => {
    const r = parseNexText('# heading\nrouter R1 # c\nrouter R2 notes="#12" #trailing\nrouter R3#x notes=a#b');
    expect(r.diagnostics).toEqual([]);
    expect(r.devices.map((d) => [d.name, d.props.notes])).toEqual([
      ['R1', undefined],
      ['R2', '#12'],
      ['R3#x', 'a#b'],
    ]);
    // and a notes value of "#12" survives the serializer, which used to write it bare
    const d = dev('R2', { notes: '#12' });
    expect(parseNexText(serializeNexText({ devices: [d], links: [] })).devices[0]!.props.notes).toBe('#12');
  });

  it('round-trips multi-line notes on one source line', () => {
    const notes = 'first line\nsecond "quoted" line\n\tindented # not a comment';
    const text = serializeNexText({ devices: [dev('R1', { notes })], links: [] });
    expect(text.split('\n')).toHaveLength(2); // "# Devices" + one device line
    const r = parseNexText(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.devices[0]!.props.notes).toBe(notes);
  });

  it('reports an unterminated string with line and column instead of guessing', () => {
    const r = parseNexText('router R0\nrouter R1 notes="abc\nrouter R2');
    expect(r.diagnostics).toEqual([
      { line: 2, col: 17, severity: 'error', message: expect.stringMatching(/Unterminated string/) },
    ]);
    expect(r.devices.map((d) => d.name)).toEqual(['R0', 'R2']); // the bad line adds nothing
  });

  it('reports unknown escapes, stray quotes and bare backslashes with a column', () => {
    expect(parseNexText('router "a\\qb"').diagnostics).toEqual([
      { line: 1, col: 10, severity: 'error', message: expect.stringMatching(/Unknown escape/) },
    ]);
    expect(parseNexText('router HQ"Primary"').diagnostics[0]).toMatchObject({ line: 1, col: 10, severity: 'error' });
    expect(parseNexText('router "HQ"x').diagnostics[0]).toMatchObject({ line: 1, col: 12, severity: 'error' });
    expect(parseNexText('router a\\b').diagnostics[0]).toMatchObject({ line: 1, col: 9, severity: 'error' });
    // the pre-#88 output for a name with quotes is now rejected, not silently rewritten
    const old = parseNexText('isp "HQ "Primary"" location=Carrier-A');
    expect(old.devices).toEqual([]);
    expect(old.diagnostics[0]).toMatchObject({ line: 1, severity: 'error' });
  });

  it('a quoted token is a literal: never an operator, statement keyword or type keyword', () => {
    const r = parseNexText('node "-"\nnode "->"\n"-" -> "->"\n"subnet" - "vlan"');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.devices.map((d) => d.name)).toEqual(['-', '->', 'subnet', 'vlan']);
    expect(r.links.map((l) => [l.source, l.target, l.props.arrow])).toEqual([
      ['-', '->', 'end'],
      ['subnet', 'vlan', undefined],
    ]);
    expect(parseNexText('"router" R1').diagnostics[0]).toMatchObject({ severity: 'error', col: 1 });
    expect(parseNexText('"subnet" 10.0.0.0/24').subnets).toEqual([]);
  });

  it('splits attributes on the first UNQUOTED = only', () => {
    const r = parseNexText('router R1 notes=a=b role="x=y" "rack=Row 1"');
    expect(r.devices[0]!.props).toEqual({ notes: 'a=b', role: 'x=y' });
    expect(r.diagnostics).toEqual([
      { line: 1, col: 32, severity: 'warn', message: expect.stringMatching(/Ignored "rack=Row 1"/) },
    ]);
  });

  it('treats single quotes as ordinary characters', () => {
    const r = parseNexText("router O'Brien notes='hi there'");
    expect(r.devices[0]!.name).toBe("O'Brien");
    expect(r.devices[0]!.props.notes).toBe("'hi");
    expect(quoteNexText("O'Brien")).toBe("O'Brien"); // and so are written bare
  });
});

// ── #85: identity and the reconcile plan ─────────────────────────────────────

describe('nexTextHandles (#85)', () => {
  it('gives same-named devices distinct handles that never collide with a real name', () => {
    const ds = [dev('web'), dev('web'), dev('web~2'), dev('web'), dev('solo')];
    expect([...nexTextHandles(ds).values()]).toEqual(['web', 'web~3', 'web~2', 'web~4', 'solo']);
  });

  it('a duplicate declared handle is an error, not a silent merge', () => {
    const r = parseNexText('switch patch-01 vendor=A\nswitch patch-01 vendor=B');
    expect(r.diagnostics).toEqual([
      { line: 2, col: 8, severity: 'error', message: expect.stringMatching(/already declared on line 1/) },
    ]);
    expect(r.devices).toHaveLength(1);
    expect(r.devices[0]!.props.vendor).toBe('A');
  });

  it('same-name devices and their link endpoints stay distinct through serialize → parse → plan', () => {
    const a = dev('patch-01', { vendor: 'A' });
    const b = dev('patch-01', { vendor: 'B' });
    const core = dev('core');
    const links = [createLink(a.id, core.id, 'L1', { vlan: '1' }), createLink(b.id, core.id, 'L1', { vlan: '2' })];
    const model = { devices: [a, b, core], links };
    const text = serializeNexText(model);
    expect(text).toContain('router patch-01~2 name=patch-01 vendor=B');
    expect(text).toContain('patch-01~2 - core vlan=2');

    const r = parseNexText(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.devices).toHaveLength(3);
    expect(planNexText(r, model).isEmpty).toBe(true);

    // Editing the second one's line patches the second device, and only it.
    const edited = parseNexText(text.replace('vendor=B', 'vendor=Z').replace('vlan=2', 'vlan=22'));
    const plan = planNexText(edited, model);
    expect(plan.deviceUpdates).toEqual([{ id: b.id, before: { vendor: 'B' }, after: { vendor: 'Z' } }]);
    expect(plan.linkUpdates).toEqual([{ id: links[1]!.id, before: { vlan: '2' }, after: { vlan: '22' } }]);
    expect(plan.addDevices).toEqual([]);
    expect(plan.removeDeviceIds).toEqual([]);
  });
});

describe('planNexText (#85)', () => {
  const r1 = createDevice('router', 100, 100, 'L1', {
    name: 'R1', vendor: 'Cisco', notes: 'edge', fill: '#fff', watts: 90, serial: 'SN1', rackId: 'rk', ru: 12,
    interfaces: [{ id: 'if1', name: 'ge0' }, { id: 'if2', name: 'ge1' }], extra: { asn: '65001' },
  });
  const sw = createDevice('switch', 400, 100, 'L1', { name: 'SW1' });
  const fw = createDevice('firewall', 400, 300, 'L1', { name: 'FW' });
  const l1: Link = createLink(r1.id, sw.id, 'L1', {
    vlan: '10', mode: 'trunk', name: 'uplink', sourceIfaceId: 'if1', color: '#f00', waypoints: [{ x: 1, y: 2 }],
  });
  const l2: Link = createLink(r1.id, sw.id, 'L1', { vlan: '20' });
  const l3: Link = createLink(sw.id, fw.id, 'L1', { arrow: 'end' });
  const sub = createSubnet('10.0.0.0/24', { name: 'Core', gateway: '10.0.0.1', vlanId: 10, notes: 'keep' });
  const vl = createVlan(10, 'Users', { color: '#0f0', notes: 'keep' });
  const model = {
    devices: [r1, sw, fw],
    links: [l1, l2, l3],
    subnets: [sub],
    vlans: [vl],
    racks: [{ id: 'rk', name: 'MDF' }],
    rackCables: [{ id: 'c1', aEnd: { deviceId: r1.id, ifaceId: 'if1' }, bEnd: { deviceId: sw.id, ifaceId: 'x' }, color: '#000' }],
  };
  const text = serializeNexText(model);
  const plan = (src: string) => planNexText(parseNexText(src), model, nexTextHandles(model.devices), { layerId: 'L1' });

  it('is empty for the text the serializer wrote', () => {
    const p = plan(text);
    expect(p.isEmpty).toBe(true);
    expect(summarizeNexTextPlan(p)).toBe('No changes');
    expect(describeNexTextLosses(p)).toEqual([]);
  });

  it('patches only the keys that changed, and clears a serializer-written key that was deleted', () => {
    const p = plan(text.replace('vendor=Cisco', 'vendor=Juniper').replace(' notes=edge', ''));
    expect(p.deviceUpdates).toEqual([
      { id: r1.id, before: { vendor: 'Cisco', notes: 'edge' }, after: { vendor: 'Juniper', notes: undefined } },
    ]);
    expect(p.linkUpdates).toEqual([]);
    expect(summarizeNexTextPlan(p)).toBe('1 updated');
  });

  it('never touches keys the serializer does not write, unless the text sets them', () => {
    // fill/extra on the device and name on the link are absent from the text: untouched.
    expect(plan(text).deviceUpdates).toEqual([]);
    const p = plan(text.replace('router R1', 'router R1 fill=#000 site=HQ'));
    expect(p.deviceUpdates).toEqual([
      {
        id: r1.id,
        before: { fill: '#fff', extra: { asn: '65001' } },
        after: { fill: '#000', extra: { asn: '65001', site: 'HQ' } },
      },
    ]);
  });

  it('renames through name= and changes type in place, keeping the device', () => {
    const p = plan(text.replace('router R1', 'firewall R1 name="Edge 1"'));
    expect(p.deviceUpdates).toEqual([
      { id: r1.id, before: { type: 'router', name: 'R1' }, after: { type: 'firewall', name: 'Edge 1' } },
    ]);
    expect(p.removeDeviceIds).toEqual([]);
    expect(p.addDevices).toEqual([]);
  });

  it('matches parallel links in order, so each keeps its own identity', () => {
    const p = plan(text.replace('vlan=20', 'vlan=21'));
    expect(p.linkUpdates).toEqual([{ id: l2.id, before: { vlan: '20' }, after: { vlan: '21' } }]);
    // dropping the FIRST parallel line removes the second link's slot, not both
    const lines = text.split('\n').filter((ln) => !ln.includes('vlan=20'));
    const q = plan(lines.join('\n'));
    expect(q.removeLinkIds).toEqual([l2.id]);
    expect(q.linkUpdates).toEqual([]);
  });

  it('treats an undirected link written the other way round as the same link', () => {
    const p = plan(text.replace('R1 - SW1 vlan=20', 'SW1 - R1 vlan=20'));
    expect(p.isEmpty).toBe(true);
    // a DIRECTED link reversed is a different link: the arrow now points the other way
    const q = plan(text.replace('SW1 -> FW', 'FW -> SW1'));
    expect(q.removeLinkIds).toEqual([l3.id]);
    expect(q.addLinks).toHaveLength(1);
    expect(q.addLinks[0]).toMatchObject({ sourceId: fw.id, targetId: sw.id, arrow: 'end' });
  });

  it('changes the arrow and clears link fields in place', () => {
    const p = plan(text.replace('SW1 -> FW', 'SW1 - FW').replace(' mode=trunk', ''));
    expect(p.linkUpdates).toEqual([
      { id: l1.id, before: { mode: 'trunk' }, after: { mode: undefined } },
      { id: l3.id, before: { arrow: 'end' }, after: { arrow: undefined } },
    ]);
    expect(p.addLinks).toEqual([]);
    expect(p.removeLinkIds).toEqual([]);
  });

  it('names exactly what a removed device takes with it', () => {
    const lines = text.split('\n').filter((ln) => !/\bR1\b/.test(ln));
    const p = plan(lines.join('\n'));
    expect(p.removeDeviceIds).toEqual([r1.id]);
    expect(p.removeLinkIds).toEqual([]); // its links cascade with it
    expect(p.losses).toMatchObject({ interfaces: 2, rackMounts: 1, cables: 1, links: 2 });
    expect(describeNexTextLosses(p)).toEqual(['Removes R1 — 2 interfaces, rack position MDF U12, 1 cable, 2 links']);
    expect(summarizeNexTextPlan(p)).toBe('3 removed');
  });

  it('keeps a device whose line was deleted while a link still refers to it', () => {
    const p = plan(text.replace(/^router R1.*$/m, ''));
    expect(p.removeDeviceIds).toEqual([]);
    expect(p.deviceUpdates).toEqual([]); // not reset to a generic node
  });

  it('never removes a link the serializer cannot write (missing endpoint)', () => {
    const dangling = createLink(r1.id, 'ghost', 'L1');
    const m = { ...model, links: [...model.links, dangling] };
    expect(serializeNexText(m)).toBe(text);
    const p = planNexText(parseNexText(text), m);
    expect(p.isEmpty).toBe(true);
  });

  it('matches subnets by CIDR and VLANs by id, patching only what the text writes', () => {
    const p = plan(text.replace('gateway=10.0.0.1', 'gateway=10.0.0.254').replace('name=Users', 'name=Staff'));
    expect(p.subnetUpdates).toEqual([{ id: sub.id, before: { gateway: '10.0.0.1' }, after: { gateway: '10.0.0.254' } }]);
    expect(p.vlanUpdates).toEqual([{ id: vl.id, before: { name: 'Users' }, after: { name: 'Staff' } }]);
    const q = plan(text.replace(/^subnet.*$/m, 'subnet 10.9.0.0/24').replace(/^vlan.*$/m, ''));
    expect(q.removeSubnetIds).toEqual([sub.id]);
    expect(q.addSubnets.map((s) => s.cidr)).toEqual(['10.9.0.0/24']);
    expect(q.removeVlanIds).toEqual([vl.id]);
    expect(describeNexTextLosses(q)).toEqual(['Removes subnet 10.0.0.0/24', 'Removes VLAN 10']);
  });

  it('sets new devices down beside the existing diagram, not on top of it', () => {
    const p = plan(`${text}\nserver New1\nserver New2\nNew1 - New2\nNew1 - SW1`);
    expect(p.addDevices.map((d) => d.name)).toEqual(['New1', 'New2']);
    const right = Math.max(...[sw, fw].map((d) => d.x + d.width)); // r1 is racked but on-canvas here
    for (const d of p.addDevices) expect(d.x).toBeGreaterThan(right);
    expect(p.addLinks.map((l) => [l.sourceId, l.targetId])).toEqual([
      [p.addDevices[0]!.id, p.addDevices[1]!.id],
      [p.addDevices[0]!.id, sw.id],
    ]);
    expect(summarizeNexTextPlan(p)).toBe('4 added');
  });

  it('against an empty model it is plain generation (same as buildModel)', () => {
    let n = 0;
    const ids = () => `id${n++}`;
    const src = 'router R1\nswitch SW1\nR1 - SW1\nsubnet 10.0.0.0/24\nvlan 10';
    const p = planNexText(parseNexText(src), { devices: [], links: [] }, new Map(), { layerId: 'L1', idGen: ids });
    n = 0;
    const built = buildModel(parseNexText(src), { layerId: 'L1', idGen: ids });
    expect({ devices: p.addDevices, links: p.addLinks, subnets: p.addSubnets, vlans: p.addVlans }).toEqual(built);
    expect(built.devices.some((d) => d.x !== 0 || d.y !== 0)).toBe(true);
  });
});

// ── Round 2: defects found by adversarial review ─────────────────────────────

describe('planNexText — duplicates match exactly before they match by position', () => {
  const a = dev('A');
  const b = dev('B');
  const l1 = createLink(a.id, b.id, 'L1', {
    vlan: '10', name: 'primary', color: '#f00', sourceIfaceId: 'if1', waypoints: [{ x: 1, y: 2 }],
  });
  const l2 = createLink(a.id, b.id, 'L1', { vlan: '20' });
  const s1 = createSubnet('10.0.0.0/24', { name: 'one', notes: 'keep-1' });
  const s2 = createSubnet('10.0.0.0/24', { name: 'two', notes: 'keep-2' });
  const v1 = createVlan(10, 'Users', { color: '#111' });
  const v2 = createVlan(10, 'Guests', { color: '#222' });
  const model = { devices: [a, b], links: [l1, l2], subnets: [s1, s2], vlans: [v1, v2] };
  const text = serializeNexText(model);
  const plan = (src: string) => planNexText(parseNexText(src), model);
  const without = (needle: string) => text.split('\n').filter((ln) => !ln.includes(needle)).join('\n');

  it('deleting the FIRST of two parallel links removes that link, not the second', () => {
    const p = plan(without('vlan=10'));
    expect(p.removeLinkIds).toEqual([l1.id]);
    expect(p.linkUpdates).toEqual([]); // l2 is untouched, not rewritten into l1's slot
    expect(p.addLinks).toEqual([]);
  });

  it('deleting the first of two same-CIDR subnets / same-id VLANs removes the first', () => {
    const p = plan(without('name=one'));
    expect(p.removeSubnetIds).toEqual([s1.id]);
    expect(p.subnetUpdates).toEqual([]);
    const q = plan(without('name=Users'));
    expect(q.removeVlanIds).toEqual([v1.id]);
    expect(q.vlanUpdates).toEqual([]);
  });

  it('editing one of two parallel links updates that one while the other matches exactly', () => {
    expect(plan(text).isEmpty).toBe(true);
    const first = plan(text.replace('vlan=10', 'vlan=11'));
    expect(first.linkUpdates).toEqual([{ id: l1.id, before: { vlan: '10' }, after: { vlan: '11' } }]);
    expect(first.removeLinkIds).toEqual([]);
    const second = plan(text.replace('vlan=20', 'vlan=21'));
    expect(second.linkUpdates).toEqual([{ id: l2.id, before: { vlan: '20' }, after: { vlan: '21' } }]);
    // swapping the two lines is not an edit at all
    const lines = text.split('\n');
    const i = lines.findIndex((ln) => ln.includes('vlan=10'));
    [lines[i], lines[i + 1]] = [lines[i + 1]!, lines[i]!];
    expect(plan(lines.join('\n')).isEmpty).toBe(true);
  });
});

describe('NexText — values the text cannot carry are invisible, never "fixed"', () => {
  it('serializes non-string attributes without throwing, and an unchanged Apply is empty', () => {
    const a = dev('A', { vendor: 5 as unknown as string, managementIp: 0 as unknown as string });
    const n = dev(7 as unknown as string);
    const link = createLink(a.id, n.id, 'L1', { vlan: 10 as unknown as string, bandwidth: true as unknown as string });
    const sub = createSubnet('10.0.0.0/24', { name: 12 as unknown as string });
    const vl = createVlan(10, 99 as unknown as string);
    const model = { devices: [a, n], links: [link], subnets: [sub], vlans: [vl] };
    const text = serializeNexText(model); // used to throw: s.toLowerCase is not a function
    expect(text).toContain('router A vendor=5 ip=0');
    expect(text).toContain('A - 7 vlan=10 bandwidth=true');
    const r = parseNexText(text);
    expect(r.diagnostics).toEqual([]);
    const p = planNexText(r, model);
    expect(p.isEmpty).toBe(true); // 10 is not "updated" to "10"
    expect(quoteNexText(10 as unknown as string)).toBe('10');
  });

  it('a VLAN without an integer id is not written, does not block Apply, and is never removed', () => {
    const good = createVlan(10, 'Users');
    const frac = createVlan(10.5, 'Fraction');
    const nan = createVlan(Number.NaN, 'Blank');
    const model = { devices: [], links: [], vlans: [good, frac, nan] };
    const text = serializeNexText(model);
    expect(text.trim()).toBe('# VLANs\nvlan 10 name=Users');
    const r = parseNexText(text);
    expect(r.diagnostics).toEqual([]); // `vlan 10.5 …` was a parse error that blocked Apply
    expect(planNexText(r, model).isEmpty).toBe(true);
    // even with every VLAN line deleted, only the writable one goes
    const p = planNexText(parseNexText(''), model);
    expect(p.removeVlanIds).toEqual([good.id]);
  });

  it('leaves off-schema link arrow/mode and subnet vlan alone unless the text sets them', () => {
    const a = dev('A');
    const b = dev('B');
    const odd = createLink(a.id, b.id, 'L1', {
      arrow: 'start' as unknown as Link['arrow'],
      mode: 'routed' as unknown as Link['mode'],
      vlan: '10',
    });
    const sub: Subnet = createSubnet('10.0.0.0/24', { vlanId: 10.5 });
    const model = { devices: [a, b], links: [odd], subnets: [sub] };
    const text = serializeNexText(model);
    expect(text).toContain('A - B vlan=10');
    expect(text).not.toContain('mode=');
    expect(text).not.toContain('vlan=10.5');
    expect(planNexText(parseNexText(text), model).isEmpty).toBe(true); // was: arrow → undefined, mode → access

    // an unrelated edit still leaves them alone …
    const p = planNexText(parseNexText(text.replace('vlan=10', 'vlan=11')), model);
    expect(p.linkUpdates).toEqual([{ id: odd.id, before: { vlan: '10' }, after: { vlan: '11' } }]);
    // … and setting them explicitly does replace them
    const q = planNexText(
      parseNexText(text.replace('A - B vlan=10', 'A -> B vlan=10 mode=trunk').replace('subnet 10.0.0.0/24', 'subnet 10.0.0.0/24 vlan=20')),
      model,
    );
    expect(q.linkUpdates).toEqual([
      { id: odd.id, before: { arrow: 'start', mode: 'routed' }, after: { arrow: 'end', mode: 'trunk' } },
    ]);
    expect(q.subnetUpdates).toEqual([{ id: sub.id, before: { vlanId: 10.5 }, after: { vlanId: 20 } }]);
  });
});

describe('parseNexText — a wholly quoted key=value', () => {
  it('is still an attribute when the key is a known one, so reconcile does not clear the field', () => {
    const r = parseNexText('router R1 "vendor=Cisco Systems" "loc=Row 2"\nR1 - R2 "type=dark fibre"\nvlan 10 "name=Guest WiFi"\nsubnet 10.0.0.0/24 "name=Core LAN"');
    expect(r.diagnostics.filter((d) => /Ignored/.test(d.message))).toEqual([]);
    expect(r.devices[0]!.props).toEqual({ vendor: 'Cisco Systems', location: 'Row 2' });
    expect(r.links[0]!.props.linkType).toBe('dark fibre');
    expect(r.vlans[0]!.props.name).toBe('Guest WiFi');
    expect(r.subnets[0]!.props.name).toBe('Core LAN');

    const r1 = dev('R1', { vendor: 'Cisco Systems' });
    const p = planNexText(parseNexText('router R1 "vendor=Cisco Systems"'), { devices: [r1], links: [] });
    expect(p.isEmpty).toBe(true); // was: vendor cleared
  });

  it('keeps "a=b" — even "vendor=x" — usable as a quoted name and link endpoint', () => {
    const r = parseNexText('router "vendor=x" notes=n\nnode "a=b"\n"vendor=x" - "a=b"');
    expect(r.diagnostics).toEqual([]);
    expect(r.devices.map((d) => [d.name, d.props])).toEqual([
      ['vendor=x', { notes: 'n' }],
      ['a=b', {}],
    ]);
    expect(r.links[0]).toMatchObject({ source: 'vendor=x', target: 'a=b' });
  });
});

describe('planNexText — locks', () => {
  const a = dev('A', { interfaces: [{ id: 'i', name: 'e0' }] });
  const b = dev('B');
  const c = dev('C');
  const ab = createLink(a.id, b.id, 'L1');
  const bc = createLink(b.id, c.id, 'L1');
  const base = { devices: [a, b, c], links: [ab, bc] };
  const text = serializeNexText(base);
  const noA = text.split('\n').filter((ln) => !/\bA\b/.test(ln)).join('\n');

  it('keeps a protected device (and its links) whose line was deleted, and says so', () => {
    const p = planNexText(parseNexText(noA), { ...base, protectedDeviceIds: new Set([a.id]) });
    expect(p.removeDeviceIds).toEqual([]);
    expect(p.removeLinkIds).toEqual([]);
    expect(p.losses.devices).toEqual([]);
    expect(p.kept).toEqual({ devices: [{ id: a.id, name: 'A', handle: 'A' }], links: 1 });
    expect(p.isEmpty).toBe(true);
    expect(describeNexTextKept(p)).toEqual(['A is locked and will be kept']);
    expect(describeNexTextLosses(p)).toEqual([]);
    expect(summarizeNexTextPlan(p)).toBe('No changes — 1 locked device is kept');
    // unprotected, the same text removes it
    expect(planNexText(parseNexText(noA), base).removeDeviceIds).toEqual([a.id]);
  });

  it('reports kept beside real removals, and still lets a protected device be edited', () => {
    const src = text.split('\n').filter((ln) => !/\b[AC]\b/.test(ln)).join('\n');
    const p = planNexText(parseNexText(src), { ...base, protectedDeviceIds: new Set([a.id]) });
    expect(p.removeDeviceIds).toEqual([c.id]);
    expect(summarizeNexTextPlan(p)).toBe('2 removed · 1 locked, kept');
    const q = planNexText(parseNexText(text.replace('router A', 'router A vendor=X')), {
      ...base,
      protectedDeviceIds: new Set([a.id]),
    });
    expect(q.deviceUpdates).toEqual([{ id: a.id, before: { vendor: undefined }, after: { vendor: 'X' } }]);
  });

  it('keeps a link on a locked layer whose line was deleted', () => {
    const src = text.split('\n').filter((ln) => ln !== 'B - C').join('\n');
    const p = planNexText(parseNexText(src), { ...base, protectedLinkIds: new Set([bc.id]) });
    expect(p.removeLinkIds).toEqual([]);
    expect(p.kept.links).toBe(1);
    expect(describeNexTextKept(p)).toEqual(['1 link on a locked layer will be kept']);
    expect(planNexText(parseNexText(src), base).removeLinkIds).toEqual([bc.id]);
  });
});

describe('serialize → parse → plan fuzz', () => {
  /** mulberry32: a seeded PRNG so a failure is reproducible from its seed. */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const STRINGS = ['', 'a', 'web', 'web', 'web~2', 'A B', '#1', 'x"y', "o'b", 'c:\\d', 'l1\nl2', '\t', '->', '-', 'subnet',
    'vlan', 'router', 'k=v', 'vendor=x', 'ü核', ' pad ', '10', '~', 'a\rb'];
  const ODD: unknown[] = [0, 10, 10.5, true, false, null, undefined, Number.NaN];

  it('an unedited Apply is an empty plan for 400 random documents', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
      const str = (): string => (r() < 0.2 ? (pick(ODD) as string) : pick(STRINGS));
      const opt = (): string | undefined => (r() < 0.5 ? undefined : str());
      const types = ['router', 'switch', 'generic', 'isp', 'made-up-type'] as Device['type'][];
      const devices = Array.from({ length: 1 + Math.floor(r() * 6) }, () =>
        createDevice(pick(types), r() * 500, r() * 500, 'L1', {
          name: r() < 0.1 ? (pick([5, 0, true]) as unknown as string) : pick(STRINGS),
          vendor: opt(), model: opt(), role: opt(), managementIp: opt(), location: opt(), notes: opt(),
          fill: opt(), locked: r() < 0.2, extra: r() < 0.3 ? { k: str() } : undefined,
        }),
      );
      const ids = [...devices.map((d) => d.id), 'ghost'];
      const links = Array.from({ length: Math.floor(r() * 8) }, () =>
        createLink(pick(ids), pick(ids), 'L1', {
          arrow: pick(['none', 'end', 'both', undefined, 'start']) as Link['arrow'],
          mode: pick(['trunk', 'access', undefined, 'routed', '']) as Link['mode'],
          vlan: opt(), bandwidth: opt(), linkType: opt(), nativeVlan: opt(), lacp: opt(), circuitId: opt(),
          name: opt(),
        }),
      );
      const vlanIds = [10, 10, 20, 10.5, Number.NaN, 0, -3, 5000, '10' as unknown as number];
      const subnets: Subnet[] = Array.from({ length: Math.floor(r() * 4) }, () =>
        createSubnet(pick(['10.0.0.0/24', '10.0.0.0/24', 'bad cidr', '', '#']), {
          name: opt(), gateway: opt(), zone: opt(), vlanId: r() < 0.5 ? undefined : pick(vlanIds),
        }),
      );
      const vlans: Vlan[] = Array.from({ length: Math.floor(r() * 4) }, () =>
        createVlan(pick(vlanIds), str(), { zone: opt(), color: opt() }),
      );
      const model = {
        devices, links, subnets, vlans,
        protectedDeviceIds: new Set(devices.filter((d) => d.locked).map((d) => d.id)),
      };
      const text = serializeNexText(model);
      const parsed = parseNexText(text);
      const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
      expect(errors, `seed ${seed}\n${text}`).toEqual([]);
      const p = planNexText(parsed, model);
      const { addDevices, deviceUpdates, removeDeviceIds, addLinks, linkUpdates, removeLinkIds, addSubnets,
        subnetUpdates, removeSubnetIds, addVlans, vlanUpdates, removeVlanIds } = p;
      expect(
        { addDevices, deviceUpdates, removeDeviceIds, addLinks, linkUpdates, removeLinkIds, addSubnets,
          subnetUpdates, removeSubnetIds, addVlans, vlanUpdates, removeVlanIds },
        `seed ${seed}\n${text}`,
      ).toEqual({
        addDevices: [], deviceUpdates: [], removeDeviceIds: [], addLinks: [], linkUpdates: [], removeLinkIds: [],
        addSubnets: [], subnetUpdates: [], removeSubnetIds: [], addVlans: [], vlanUpdates: [], removeVlanIds: [],
      });
      expect(p.kept.devices, `seed ${seed}`).toEqual([]);
    }
  });
});
