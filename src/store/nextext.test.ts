/**
 * Store-level tests for applyNexText. Apply is a lossless SYNC of the diagram to the
 * text (#85): matching devices keep their id, position, rack slot and interfaces, an
 * unedited Apply is a no-op, and the whole thing is one undo entry. It aborts on parse
 * errors without mutating.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { describeNexTextKept, describeNexTextLosses, parseNexText, serializeNexText } from '@/lib/nextext';
import { templateById } from '@/rack/rackTemplates';
import type { NexMapDocument } from '@/model/types';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

/** The text the NexText dialog opens with. */
const currentText = () =>
  serializeNexText({ devices: s().devicesAll(), links: s().linksAll(), subnets: s().subnetsAll(), vlans: s().vlansAll() });

const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));

/** Everything a diagram holds, keyed by id — collection order is not part of identity. */
function snapshot() {
  const doc: NexMapDocument = structuredClone(s().getDocument());
  return {
    devices: byId(doc.devices),
    links: byId(doc.links),
    objects: byId(doc.objects),
    racks: byId(doc.racks),
    rackCables: byId(doc.rackCables),
    subnets: byId(doc.subnets),
    vlans: byId(doc.vlans),
    layers: byId(doc.layers),
  };
}

const counts = () => ({
  devices: s().devicesAll().length,
  mounted: s().devicesAll().filter((d) => d.rackId != null && d.ru != null).length,
  interfaces: s().devicesAll().reduce((n, d) => n + (d.interfaces?.length ?? 0), 0),
  links: s().linksAll().length,
  racks: s().racksAll().length,
  cables: s().rackCablesAll().length,
  objects: s().objectsAll().length,
});

/**
 * The #85 project: a logical network with interfaces and rich link data, the
 * Enterprise compute (42U) rack template, a clone of that rack (same-name devices), a
 * cable between the two racks, and a note + a shape on the canvas.
 */
function buildFixture() {
  const r1 = s().addDeviceAt('router', 100, 100);
  const sw1 = s().addDeviceAt('switch', 400, 100);
  const web = s().addDeviceAt('server', 400, 320);
  s().updateDevice(r1, {}, { name: 'R1', vendor: 'Cisco', model: 'ISR 4451', location: 'HQ #1', fill: '#123456', serial: 'SN-R1' });
  s().updateDevice(sw1, {}, { name: 'SW1', vendor: 'Arista', notes: 'core "stack"\nsecond line' });
  s().updateDevice(web, {}, { name: 'Web 01', role: 'App Tier', managementIp: '10.0.0.10' });
  const r1if = s().addInterface(r1, 'ge-0/0/0')!;
  s().addInterface(r1, 'ge-0/0/1');
  const sw1if = s().addInterface(sw1, 'Ethernet1')!;
  const l1 = s().connect(r1, sw1)!;
  const l2 = s().connect(sw1, web)!;
  const l3 = s().connect(r1, sw1)!; // a second, parallel link
  s().updateLink(l1, {}, {
    vlan: '10', mode: 'trunk', bandwidth: '10G', sourceIfaceId: r1if, targetIfaceId: sw1if,
    sourceInterface: 'ge-0/0/0', targetInterface: 'Ethernet1', color: '#ff0000', style: 'dashed',
    waypoints: [{ x: 250, y: 60 }], name: 'uplink',
  });
  s().updateLink(l2, {}, { arrow: 'end', bandwidth: '1G' });
  s().updateLink(l3, {}, { vlan: '20' });
  s().addVlan(10, 'Users');
  s().addSubnet('10.0.0.0/24');

  const [rackA] = s().applyRackTemplate(templateById('ent-compute-42u')!);
  const rackB = s().cloneRack(rackA!)!;
  const cabled = (rackId: string) =>
    s().devicesAll().find((d) => d.rackId === rackId && d.name === 'tor-01' && (d.interfaces?.length ?? 0) > 0)!;
  const a = cabled(rackA!);
  const b = cabled(rackB);
  const cable = s().connectRackCable(
    { deviceId: a.id, ifaceId: a.interfaces![0]!.id },
    { deviceId: b.id, ifaceId: b.interfaces![0]!.id },
    '#22d3ee',
    'inter-rack',
  )!;
  const note = s().addText(60, 500);
  const shape = s().addShape(40, 40, 600, 400);
  return { r1, sw1, web, l1, l2, l3, rackA: rackA!, rackB, torA: a.id, torB: b.id, cable, note, shape };
}

describe('applyNexText — generating into an empty project', () => {
  it('builds devices, links, subnets, and vlans from text', () => {
    const r = s().applyNexText(
      ['router R1', 'switch SW1', 'R1 - SW1 vlan=10', 'subnet 10.0.0.0/24 name=Core', 'vlan 10 name=Users'].join('\n'),
    );
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(s().devicesAll().map((d) => d.name).sort()).toEqual(['R1', 'SW1']);
    expect(s().linksAll()).toHaveLength(1);
    expect(s().subnetsAll()[0]?.cidr).toBe('10.0.0.0/24');
    expect(s().vlansAll()[0]?.vlanId).toBe(10);
    // laid out, not stacked at the origin
    const [a, b] = s().devicesAll();
    expect([a!.x, a!.y]).not.toEqual([b!.x, b!.y]);
  });

  it('aborts without mutating when there are parse errors', () => {
    s().applyNexText('router R1');
    const before = snapshot();
    const r = s().applyNexText('frobnicator X1'); // unknown type → error
    expect(r).toMatchObject({ ok: false, changed: false });
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(snapshot()).toEqual(before);
  });

  it('is a single undoable transaction', () => {
    s().applyNexText('router R1\nswitch SW1\nR1 - SW1');
    expect(s().devicesAll()).toHaveLength(2);
    s().undo();
    expect(s().devicesAll()).toHaveLength(0);
    expect(s().linksAll()).toHaveLength(0);
  });

  it('returns warnings for auto-created nodes but still applies', () => {
    const r = s().applyNexText('R1 - SW1');
    expect(r.ok).toBe(true);
    expect(r.diagnostics.filter((d) => d.severity === 'warn').length).toBeGreaterThan(0);
    expect(s().devicesAll()).toHaveLength(2);
  });
});

describe('applyNexText — syncing an existing project (#85)', () => {
  it('the fixture is the mixed network + rack project from the issue', () => {
    buildFixture();
    const c = counts();
    expect(c.racks).toBe(2);
    expect(c.cables).toBe(1);
    expect(c.objects).toBe(2);
    expect(c.mounted).toBeGreaterThan(10);
    expect(c.interfaces).toBeGreaterThan(50);
    // the clone made same-name devices
    const names = s().devicesAll().map((d) => d.name);
    expect(new Set(names).size).toBeLessThan(names.length);
  });

  it('an unchanged Apply changes nothing: same document, no merge warnings, no undo entry', () => {
    buildFixture();
    const text = currentText();
    expect(parseNexText(text).diagnostics).toEqual([]); // no "already declared — merging"

    s().undo(); // leave something on the redo stack …
    s().redo(); // … then put it back, so both flags are meaningful below
    s().undo();
    const before = snapshot();
    const beforeDoc = structuredClone(s().getDocument());
    const beforeCounts = counts();
    const { canUndo, canRedo, rev } = s();
    expect(canRedo).toBe(true);

    const r = s().applyNexText(currentText());

    expect(r).toMatchObject({ ok: true, changed: false, diagnostics: [] });
    expect(r.plan?.isEmpty).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(s().getDocument()).toEqual(beforeDoc); // order included
    expect(counts()).toEqual(beforeCounts);
    expect(s().canUndo).toBe(canUndo);
    expect(s().canRedo).toBe(true); // redo stack untouched
    expect(s().rev).toBe(rev);
    s().redo();
    expect(s().objectsAll()).toHaveLength(2); // the redo still works
  });

  it('editing one vendor= changes only that field on that device', () => {
    const f = buildFixture();
    const before = snapshot();
    const text = currentText();
    expect(text).toContain('vendor=Arista notes=');
    const r = s().applyNexText(text.replace('vendor=Arista notes=', 'vendor=Juniper notes='));

    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.plan!.deviceUpdates).toEqual([{ id: f.sw1, before: { vendor: 'Arista' }, after: { vendor: 'Juniper' } }]);
    const after = snapshot();
    expect(after.devices.get(f.sw1)).toEqual({ ...before.devices.get(f.sw1)!, vendor: 'Juniper' });
    // every other device, and every other collection, is untouched
    before.devices.delete(f.sw1);
    after.devices.delete(f.sw1);
    expect(after).toEqual(before);

    s().undo();
    expect(s().getDevice(f.sw1)!.vendor).toBe('Arista');
  });

  it('a dry run reports the plan without touching the diagram or history', () => {
    const f = buildFixture();
    const before = snapshot();
    const { canUndo, rev } = s();
    const r = s().applyNexText(currentText().replace('vendor=Cisco', 'vendor=Nokia'), { dryRun: true });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(r.plan!.deviceUpdates.map((u) => u.id)).toEqual([f.r1]);
    expect(snapshot()).toEqual(before);
    expect([s().canUndo, s().rev]).toEqual([canUndo, rev]);
  });

  it('deleting one device line removes only that device, its links and its cables; undo restores it all', () => {
    const f = buildFixture();
    const before = snapshot();
    // tor-01 in the CLONED rack: same name as the original's, so only its handle tells them apart.
    const text = currentText();
    const lines = text.split('\n');
    const mine = lines.filter((ln) => /\btor-01~2\b/.test(ln));
    expect(mine).toHaveLength(1);
    const r = s().applyNexText(lines.filter((ln) => !mine.includes(ln)).join('\n'));

    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.plan!.removeDeviceIds).toEqual([f.torB]);
    const lost = before.devices.get(f.torB)!;
    expect(describeNexTextLosses(r.plan!)).toEqual([
      `Removes tor-01 (tor-01~2) — ${lost.interfaces!.length} interfaces, rack position Compute (copy) U${lost.ru}, 1 cable`,
    ]);

    const after = snapshot();
    expect(after.devices.has(f.torB)).toBe(false);
    expect(after.rackCables.has(f.cable)).toBe(false);
    expect(after.devices.get(f.torA)).toEqual(before.devices.get(f.torA)); // its twin is intact
    const expected = snapshot();
    expected.devices = new Map(before.devices);
    expected.devices.delete(f.torB);
    expected.rackCables = new Map();
    expect(after).toEqual({ ...before, devices: expected.devices, rackCables: expected.rackCables });

    s().undo();
    expect(snapshot()).toEqual(before);
  });

  it('deleting a logical device takes its links with it and leaves the rest, in one undo step', () => {
    const f = buildFixture();
    const before = snapshot();
    const depth = s().canUndo;
    const lines = currentText().split('\n').filter((ln) => !ln.includes('"Web 01"'));
    const r = s().applyNexText(lines.join('\n'));
    expect(r.plan!.removeDeviceIds).toEqual([f.web]);
    expect(r.plan!.losses.links).toBe(1);

    const after = snapshot();
    expect([...after.links.keys()].sort()).toEqual([f.l1, f.l3].sort());
    expect(after.links.get(f.l1)).toEqual(before.links.get(f.l1)); // iface ids, waypoints, colour kept
    expect(after.objects).toEqual(before.objects);
    expect(after.racks).toEqual(before.racks);
    expect(after.rackCables).toEqual(before.rackCables);
    expect(after.devices.size).toBe(before.devices.size - 1);

    s().undo();
    expect(snapshot()).toEqual(before);
    expect(s().canUndo).toBe(depth);
  });

  it('same-name devices and their link endpoints stay distinct', () => {
    const f = buildFixture();
    // link the two same-named tor-01 switches to different logical devices
    const la = s().connect(f.torA, f.r1)!;
    const lb = s().connect(f.torB, f.sw1)!;
    const before = snapshot();
    const text = currentText();
    expect(text).toContain('tor-01 - R1');
    expect(text).toContain('tor-01~2 - SW1');

    const r = s().applyNexText(text.replace('tor-01~2 - SW1', 'tor-01~2 - SW1 vlan=99'));
    expect(r.plan!.linkUpdates).toEqual([{ id: lb, before: { vlan: undefined }, after: { vlan: '99' } }]);
    expect(s().devicesAll()).toHaveLength(before.devices.size); // nothing merged
    expect(s().getLink(la)).toEqual(before.links.get(la));
    expect(s().getLink(lb)).toMatchObject({ sourceId: f.torB, targetId: f.sw1, vlan: '99' });
    expect(s().getDevice(f.torA)).toEqual(before.devices.get(f.torA));
    expect(s().getDevice(f.torB)).toEqual(before.devices.get(f.torB));
  });

  it('adds a new device beside the diagram and never touches notes, shapes or racks', () => {
    const f = buildFixture();
    const before = snapshot();
    const r = s().applyNexText(`${currentText()}\nfirewall FW9 vendor=Palo\nFW9 - R1`);
    expect(r.plan!.addDevices.map((d) => d.name)).toEqual(['FW9']);
    const after = snapshot();
    const fw = [...after.devices.values()].find((d) => d.name === 'FW9')!;
    const onCanvas = [f.r1, f.sw1, f.web].map((id) => before.devices.get(id)!);
    expect(fw.x).toBeGreaterThan(Math.max(...onCanvas.map((d) => d.x + d.width)));
    expect(after.objects).toEqual(before.objects);
    expect(after.racks).toEqual(before.racks);
    expect(after.rackCables).toEqual(before.rackCables);
    for (const [id, d] of before.devices) expect(after.devices.get(id)).toEqual(d);
    expect(after.links.size).toBe(before.links.size + 1);
  });

  it('text that drops everything removes devices but keeps canvas objects, racks and layers', () => {
    // Was 'REPLACES existing content rather than merging': the old Apply also deleted
    // every note/shape and rebuilt survivors with new ids.
    const f = buildFixture();
    const before = snapshot();
    s().applyNexText('router R1\nswitch SW9');
    const after = snapshot();
    expect(s().devicesAll().map((d) => d.name).sort()).toEqual(['R1', 'SW9']);
    // R1 is the SAME device, patched: vendor/model/location were deleted from its line,
    // while fields the text cannot express survive.
    expect(after.devices.get(f.r1)).toMatchObject({ id: f.r1, x: 100, y: 100, fill: '#123456', serial: 'SN-R1' });
    expect(after.devices.get(f.r1)!.vendor).toBeUndefined();
    expect(after.devices.get(f.r1)!.interfaces).toEqual(before.devices.get(f.r1)!.interfaces);
    expect(after.objects).toEqual(before.objects);
    expect(after.racks).toEqual(before.racks);
    expect(after.layers).toEqual(before.layers);
    expect(after.rackCables.size).toBe(0); // cascaded with the devices they plugged into
    s().undo();
    expect(snapshot()).toEqual(before);
  });
});

describe('applyNexText — locks and selection (review round 2)', () => {
  const setup = () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 300, 0);
    const c = s().addDeviceAt('server', 600, 0);
    s().updateDevice(a, {}, { name: 'A' });
    s().updateDevice(b, {}, { name: 'B' });
    s().updateDevice(c, {}, { name: 'C' });
    s().addInterface(a, 'e0');
    const ab = s().connect(a, b)!;
    const bc = s().connect(b, c)!;
    return { a, b, c, ab, bc };
  };
  const dropLines = (re: RegExp) => currentText().split('\n').filter((ln) => !re.test(ln)).join('\n');

  it('a locked device is kept when its line is deleted, and the plan says so', () => {
    const f = setup();
    s().updateDevice(f.a, {}, { locked: true });
    const before = snapshot();
    const { canUndo } = s();
    const src = dropLines(/\bA\b/);

    const dry = s().applyNexText(src, { dryRun: true });
    expect(dry.plan!.removeDeviceIds).toEqual([]);
    expect(dry.plan!.kept.devices).toEqual([{ id: f.a, name: 'A', handle: 'A' }]);
    expect(describeNexTextKept(dry.plan!)).toEqual(['A is locked and will be kept']);

    const r = s().applyNexText(src);
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(snapshot()).toEqual(before); // A, its interface and its link A–B all still there
    expect(s().canUndo).toBe(canUndo);

    // Unlocked, the same text removes it — the lock is what kept it.
    s().updateDevice(f.a, {}, { locked: false });
    expect(s().applyNexText(src).plan!.removeDeviceIds).toEqual([f.a]);
    expect(s().getDevice(f.a)).toBeUndefined();
  });

  it('a locked device is kept while an unlocked one in the same Apply is removed', () => {
    const f = setup();
    s().updateDevice(f.a, {}, { locked: true });
    const r = s().applyNexText(dropLines(/\b[AC]\b/));
    expect(r.changed).toBe(true);
    expect(r.plan!.removeDeviceIds).toEqual([f.c]);
    expect(s().devicesAll().map((d) => d.name).sort()).toEqual(['A', 'B']);
    expect(s().getLink(f.ab)).toBeDefined();
    expect(s().getLink(f.bc)).toBeUndefined();
  });

  it('devices and links on a locked layer are kept; fields can still be edited', () => {
    const f = setup();
    s().setLayerLocked(s().getDevice(f.a)!.layerId, true);
    const before = snapshot();
    const r = s().applyNexText('router A vendor=Acme');
    expect(r.plan!.removeDeviceIds).toEqual([]);
    expect(r.plan!.removeLinkIds).toEqual([]);
    expect(r.plan!.kept.devices.map((d) => d.name).sort()).toEqual(['B', 'C']);
    const after = snapshot();
    expect(after.devices.get(f.a)).toEqual({ ...before.devices.get(f.a)!, vendor: 'Acme' });
    expect(after.links).toEqual(before.links);
    expect(after.devices.size).toBe(3);

    // a link line deleted between devices that stay: the locked layer protects it too
    const kept = s().applyNexText(dropLines(/^B - C/), { dryRun: true });
    expect(kept.plan!.removeLinkIds).toEqual([]);
    expect(kept.plan!.kept.links).toBe(1);
    expect(kept.plan!.isEmpty).toBe(true);
  });

  it('drops removed links and devices from the selection, keeps the rest', () => {
    const f = setup();
    const note = s().addText(10, 300);
    s().select([f.ab, f.bc, f.a, f.c, note]);
    // remove the A–B link line (explicit), and device C (its link B–C cascades)
    s().applyNexText(dropLines(/^A - B|\bC\b/));
    expect(s().getLink(f.ab)).toBeUndefined();
    expect(s().getLink(f.bc)).toBeUndefined();
    expect([...s().selection].sort()).toEqual([f.a, note].sort());
  });
});

