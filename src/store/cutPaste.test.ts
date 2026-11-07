/**
 * Issue #51: cut + paste within a project is a MOVE. Cutting a cabled selection
 * and pasting it back must bring back the very same devices — ids, interfaces and
 * the links' port references, addresses, callout anchors — with the links and rack
 * cables that ran between (and, in the same project, out of) the selection, as
 * exact undo/redo steps. Copy and duplicate keep their copy semantics (fresh ids,
 * no addresses, no links).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { buildTemplate } from '@/model/templates';
import type { NexMapDocument } from '@/model/types';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

/** The design's content, order-independent, for exact before/after comparison. */
function content(doc: NexMapDocument = s().getDocument()) {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  return {
    devices: byId(doc.devices),
    links: byId(doc.links),
    objects: byId(doc.objects),
    rackCables: byId(doc.rackCables),
  };
}

/** Two cabled devices: ports, a port-referenced link, addresses, a callout on A. */
function cabledPair() {
  const a = s().addDeviceAt('router', 100, 100);
  const b = s().addDeviceAt('switch', 400, 100);
  s().updateDevice(a, { managementIp: undefined }, { managementIp: '10.0.0.1' });
  s().updateDevice(b, { managementIp: undefined }, { managementIp: '10.0.0.2' });
  const pa = s().addInterface(a, 'Gi0/1')!;
  const pb = s().addInterface(b, 'Gi1/0/24')!;
  s().updateInterface(a, pa, { ip: '192.168.1.1/30', vlan: 10 });
  s().updateInterface(b, pb, { ip: '192.168.1.2/30', vlan: 10 });
  const link = s().connect(a, b)!;
  s().updateLink(
    link,
    { sourceIfaceId: undefined, targetIfaceId: undefined, sourceInterface: undefined, targetInterface: undefined },
    { sourceIfaceId: pa, targetIfaceId: pb, sourceInterface: 'Gi0/1', targetInterface: 'Gi1/0/24', bandwidth: '1G' },
  );
  const note = s().addText(100, 20);
  s().updateObject(note, { anchor: undefined }, { anchor: { type: 'device', id: a } });
  return { a, b, pa, pb, link, note };
}

describe('cut + paste is a move (#51)', () => {
  it('pasting a cut cabled pair restores it exactly: ids, ports, addresses, link, annotation', () => {
    const { a, b, link, note } = cabledPair();
    const before = content();

    s().select([a, b, note]);
    s().cutSelection();
    expect(s().devicesAll()).toHaveLength(0);
    expect(s().linksAll()).toHaveLength(0);

    s().paste();
    expect(content()).toEqual(before);
    expect(s().getLink(link)!.sourceIfaceId).toBe(before.links[0]!.sourceIfaceId);
    // The moved entities come back selected, ready to drag.
    expect(s().selection).toEqual(new Set([a, b, note]));
  });

  it('undo/redo of the cut and the paste replay the exact topology', () => {
    const { a, b, note } = cabledPair();
    const before = content();
    s().select([a, b, note]);
    s().cutSelection();
    const afterCut = content();
    s().paste();

    s().undo(); // paste
    expect(content()).toEqual(afterCut);
    s().undo(); // cut
    expect(content()).toEqual(before);
    s().redo(); // cut
    expect(content()).toEqual(afterCut);
    s().redo(); // paste
    expect(content()).toEqual(before);
  });

  it('the Branch office template survives cut + paste of all its devices (10 / 9)', () => {
    s().loadDoc(buildTemplate('branch-office', NOW));
    const before = content();
    expect(before.devices).toHaveLength(10);
    expect(before.links).toHaveLength(9);

    s().select(before.devices.map((d) => d.id));
    s().cutSelection();
    expect(s().linksAll()).toHaveLength(0);
    s().paste();
    expect(s().devicesAll()).toHaveLength(10);
    expect(s().linksAll()).toHaveLength(9);
    expect(content()).toEqual(before);

    s().undo();
    s().undo();
    expect(content()).toEqual(before);
  });

  it('reattaches links crossing the selection when their outside end is still there', () => {
    s().loadDoc(buildTemplate('branch-office', NOW));
    const before = content();
    const access = before.devices.find((d) => d.name === 'Access SW-1')!;
    // Access SW-1 links up to Core SW and down to PC-1 and PC-2.
    expect(before.links.filter((l) => l.sourceId === access.id || l.targetId === access.id)).toHaveLength(3);

    s().select([access.id]);
    s().cutSelection();
    expect(s().linksAll()).toHaveLength(6);
    s().paste();
    expect(content()).toEqual(before);
  });

  it('drops a crossing link whose outside end was deleted meanwhile', () => {
    const { a, b } = cabledPair();
    s().select([a]);
    s().cutSelection();
    s().select([b]);
    s().deleteSelection();
    s().paste();
    expect(s().getDevice(a)).toBeTruthy();
    expect(s().linksAll()).toHaveLength(0);
  });

  it('clears a crossing link port ref whose interface was removed meanwhile', () => {
    const { a, b, pb, link } = cabledPair();
    s().select([a]);
    s().cutSelection();
    s().deleteInterface(b, pb);
    s().paste();
    const l = s().getLink(link)!;
    expect(l.sourceIfaceId).toBeTruthy(); // A's own port, moved with it
    expect(l.targetIfaceId).toBeUndefined();
  });

  it('restores rack cables between the moved devices', () => {
    const { a, b, pa, pb } = cabledPair();
    const cable = s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#22d3ee')!;
    expect(cable).toBeTruthy();
    const before = content();
    s().select([a, b]);
    s().cutSelection();
    expect(s().rackCablesAll()).toHaveLength(0);
    s().paste();
    expect(content()).toEqual(before);
  });

  it('a moved device whose rack was deleted meanwhile lands in the unplaced tray', () => {
    const { a } = cabledPair();
    const rack = s().addRack('R1');
    expect(s().placeInRack(a, rack, { ru: 10, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', depth: 'full' }).ok).toBe(true);
    s().select([a]);
    s().cutSelection();
    s().deleteRack(rack);
    s().paste();
    expect(s().getDevice(a)!.rackId).toBeUndefined();
    expect(s().getDevice(a)!.managementIp).toBe('10.0.0.1');
  });

  it('a moved device whose rack slot was taken meanwhile is unplaced, not overlapped', () => {
    const { a, b } = cabledPair();
    const rack = s().addRack('R1');
    const slot = { ru: 10, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', depth: 'full' } as const;
    expect(s().placeInRack(a, rack, slot).ok).toBe(true);
    s().select([a]);
    s().cutSelection();
    expect(s().placeInRack(b, rack, slot).ok).toBe(true);
    s().paste();
    expect(s().getDevice(a)!.rackId).toBeUndefined();
    expect(s().getDevice(b)!.rackId).toBe(rack);
  });

  it('a second paste of the same cut is an ordinary copy (fresh ids, no addresses, no links)', () => {
    const { a, b } = cabledPair();
    s().select([a, b]);
    s().cutSelection();
    s().paste(); // the move
    s().paste(); // a copy
    const devices = s().devicesAll();
    expect(devices).toHaveLength(4);
    const copies = devices.filter((d) => d.id !== a && d.id !== b);
    expect(copies).toHaveLength(2);
    expect(copies.every((d) => d.managementIp === undefined)).toBe(true);
    expect(s().linksAll()).toHaveLength(1); // only the moved pair's own link
  });

  it('pasting after undoing the cut copies rather than duplicating identities', () => {
    const { a, b } = cabledPair();
    s().select([a, b]);
    s().cutSelection();
    s().undo(); // the originals are back
    s().paste();
    const devices = s().devicesAll();
    expect(devices).toHaveLength(4);
    const ips = devices.map((d) => d.managementIp).filter(Boolean);
    expect(ips.sort()).toEqual(['10.0.0.1', '10.0.0.2']); // no duplicate addresses
    expect(new Set(devices.map((d) => d.id)).size).toBe(4);
  });

  it('undoing a move-paste and pasting again moves again', () => {
    const { a, b } = cabledPair();
    const before = content();
    s().select([a, b]);
    s().cutSelection();
    s().paste();
    s().undo();
    s().paste();
    expect(content().devices.map((d) => d.id).sort()).toEqual([a, b].sort());
    expect(s().linksAll()).toHaveLength(1);
    expect(content().links).toEqual(before.links);
  });

  it('does not cut (or duplicate) a locked device in the selection', () => {
    const { a, b } = cabledPair();
    s().select([b]);
    s().toggleLockSelection();
    s().select([a, b]);
    s().cutSelection();
    expect(s().getDevice(b)).toBeTruthy(); // locked: stays put
    s().paste();
    expect(s().devicesAll()).toHaveLength(2);
    expect(s().linksAll()).toHaveLength(1); // A's crossing link to B is back
  });

  it('into another project: keeps the selection and its inner links, drops crossing ones', () => {
    s().loadDoc(buildTemplate('branch-office', NOW));
    const doc = content();
    const names = ['Access SW-2', 'AP', 'Printer', 'PC-3'];
    const ids = doc.devices.filter((d) => names.includes(d.name)).map((d) => d.id);
    s().select(ids);
    s().cutSelection();

    s().newProject(NOW); // a different project
    const layer = s().defaultLayerId();
    s().paste();
    const devices = s().devicesAll();
    expect(devices.map((d) => d.id).sort()).toEqual([...ids].sort());
    expect(devices.every((d) => d.layerId === layer)).toBe(true);
    // Access SW-2 → AP / Printer / PC-3 come along; the uplink to Core SW does not.
    const links = s().linksAll();
    expect(links).toHaveLength(3);
    expect(links.every((l) => ids.includes(l.sourceId) && ids.includes(l.targetId))).toBe(true);
    expect(links.every((l) => l.layerId === layer)).toBe(true);
  });
});

describe('copy and duplicate keep copy semantics', () => {
  it('copy + paste of a cabled pair makes address-free clones and no links', () => {
    const { a, b } = cabledPair();
    s().select([a, b]);
    s().copySelection();
    s().paste();
    const copies = s().devicesAll().filter((d) => d.id !== a && d.id !== b);
    expect(copies).toHaveLength(2);
    expect(copies.every((d) => d.managementIp === undefined)).toBe(true);
    // Offset clones of the originals, as before.
    const xs = [s().getDevice(a)!.x, s().getDevice(b)!.x].map((x) => x + 24).sort();
    expect(copies.map((d) => d.x).sort()).toEqual(xs);
    expect(s().linksAll()).toHaveLength(1);
  });

  it('duplicate stays a copy', () => {
    const { a, b } = cabledPair();
    s().select([a, b]);
    s().duplicateSelection();
    const copies = s().devicesAll().filter((d) => d.id !== a && d.id !== b);
    expect(copies).toHaveLength(2);
    expect(copies.every((d) => d.managementIp === undefined)).toBe(true);
    expect(s().linksAll()).toHaveLength(1);
  });

  it('copying after a cut replaces the pending move', () => {
    const { a, b } = cabledPair();
    s().select([a]);
    s().cutSelection();
    s().select([b]);
    s().copySelection();
    s().paste();
    expect(s().getDevice(a)).toBeUndefined();
    expect(s().devicesAll()).toHaveLength(2); // B and B's copy
  });
});
