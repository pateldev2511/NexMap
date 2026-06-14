/**
 * Rack designer store actions (schema v3): placement validation + undoable physical
 * cabling, plus the two CRITICAL cascades (delete-device, prune-on-interface-change).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import type { Slot } from '@/rack/rackModel';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

const slot = (over: Partial<Slot> = {}): Slot => ({
  ru: 40,
  ruSpan: 1,
  mount: 'rack',
  side: 'front',
  bay: 'full',
  depth: 'full',
  ...over,
});

beforeEach(() => s().newProject(NOW));

describe('placeInRack', () => {
  it('places a device and writes its slot fields', () => {
    const r = s().addRack('MDF');
    const d = s().addDeviceAt('switch', 0, 0);
    const fit = s().placeInRack(d, r, slot({ ru: 40, ruSpan: 1 }));
    expect(fit).toEqual({ ok: true });
    const dev = s().getDevice(d)!;
    expect(dev).toMatchObject({ rackId: r, ru: 40, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full' });
  });

  it('rejects an occupied U without mutating', () => {
    const r = s().addRack('MDF');
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 0, 0);
    s().placeInRack(a, r, slot({ ru: 40 }));
    const fit = s().placeInRack(b, r, slot({ ru: 40 }));
    expect(fit).toEqual({ ok: false, reason: 'occupied' });
    expect(s().getDevice(b)!.rackId).toBeUndefined();
  });

  it('rejects out-of-bounds', () => {
    const r = s().addRack('MDF'); // default 42U
    const d = s().addDeviceAt('server', 0, 0);
    expect(s().placeInRack(d, r, slot({ ru: 42, ruSpan: 2 }))).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('lets a device move within its rack (ignores itself)', () => {
    const r = s().addRack('MDF');
    const d = s().addDeviceAt('switch', 0, 0);
    s().placeInRack(d, r, slot({ ru: 40 }));
    expect(s().placeInRack(d, r, slot({ ru: 40 }))).toEqual({ ok: true }); // same spot, no self-collision
    expect(s().placeInRack(d, r, slot({ ru: 10 }))).toEqual({ ok: true });
    expect(s().getDevice(d)!.ru).toBe(10);
  });

  it('a full-depth chassis on the rear blocks the same U on the front', () => {
    const r = s().addRack('MDF');
    const back = s().addDeviceAt('switch', 0, 0); // full-depth
    const front = s().addDeviceAt('switch', 0, 0); // full-depth
    expect(s().placeInRack(back, r, slot({ ru: 20, side: 'rear' }))).toEqual({ ok: true });
    // front device at the same U collides with the rear chassis (occupies both faces)
    expect(s().placeInRack(front, r, slot({ ru: 20, side: 'front' }))).toEqual({ ok: false, reason: 'occupied' });
    // but a different U on the front is fine
    expect(s().placeInRack(front, r, slot({ ru: 10, side: 'front' }))).toEqual({ ok: true });
  });

  it('shallow gear (patch panel) on opposite faces can share one U', () => {
    const r = s().addRack('MDF');
    const rear = s().addDeviceAt('patch-panel', 0, 0); // shallow
    const front = s().addDeviceAt('patch-panel', 0, 0); // shallow
    expect(s().placeInRack(rear, r, slot({ ru: 20, side: 'rear' }))).toEqual({ ok: true });
    expect(s().placeInRack(front, r, slot({ ru: 20, side: 'front' }))).toEqual({ ok: true });
  });

  it('unmountFromRack clears placement', () => {
    const r = s().addRack('MDF');
    const d = s().addDeviceAt('switch', 0, 0);
    s().placeInRack(d, r, slot());
    s().unmountFromRack(d);
    expect(s().getDevice(d)!.rackId).toBeUndefined();
    expect(s().getDevice(d)!.ru).toBeUndefined();
  });
});

describe('rack cabling', () => {
  const setup = () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 0, 0);
    const pa = s().addInterface(a, 'Gi1/0/1')!;
    const pa2 = s().addInterface(a, 'Gi1/0/2')!;
    const pb = s().addInterface(b, 'vmnic0')!;
    const pb2 = s().addInterface(b, 'vmnic1')!;
    return { a, b, pa, pa2, pb, pb2 };
  };

  it('connects two ports and lists the cable', () => {
    const { a, b, pa, pb } = setup();
    const id = s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#22d3ee', 'uplink', 12);
    expect(id).toBeTruthy();
    const all = s().rackCablesAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ color: '#22d3ee', label: 'uplink', lengthFt: 12 });
    s().undo();
    expect(s().rackCablesAll()).toHaveLength(0);
  });

  it('refuses a port that is already cabled, and a self-cable', () => {
    const { a, b, pa, pb, pb2 } = setup();
    s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#fff');
    expect(s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb2 }, '#fff')).toBeNull();
    expect(s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: a, ifaceId: pa }, '#fff')).toBeNull();
  });

  it('rejects endpoints that do not resolve to real interfaces', () => {
    const { a, b, pa } = setup();
    expect(s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: 'missing' }, '#fff')).toBeNull();
    expect(s().rackCablesAll()).toHaveLength(0);
  });

  it('disconnect removes the cable and is undoable', () => {
    const { a, b, pa, pb } = setup();
    const id = s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#fff')!;
    s().disconnectRackCable(id);
    expect(s().rackCablesAll()).toHaveLength(0);
    s().undo();
    expect(s().rackCablesAll()).toHaveLength(1);
  });
});

describe('CRITICAL cascade — delete device removes its cables, undo restores', () => {
  it('cascade-prunes on device delete and restores on undo', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 0, 0);
    const pa = s().addInterface(a, 'Gi1/0/1')!;
    const pb = s().addInterface(b, 'vmnic0')!;
    s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#fff');
    expect(s().rackCablesAll()).toHaveLength(1);

    s().select([a]);
    s().deleteSelection();
    expect(s().getDevice(a)).toBeUndefined();
    expect(s().rackCablesAll()).toHaveLength(0); // cable cascaded out

    s().undo();
    expect(s().getDevice(a)).toBeTruthy();
    expect(s().rackCablesAll()).toHaveLength(1); // and came back together
  });
});

describe('CRITICAL cascade — prune on interface re-population (E5)', () => {
  it('drops cables whose port no longer exists after regenerating a device port set', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 0, 0);
    const pa = s().addInterface(a, 'Gi1/0/1')!;
    const pb = s().addInterface(b, 'vmnic0')!;
    s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#fff');
    // Regenerate switch ports: p1 is gone, only p2/p3 remain.
    s().pruneInterfaceCables(a, ['p2', 'p3']);
    expect(s().rackCablesAll()).toHaveLength(0);
    // The whole prune is one undo.
    s().undo();
    expect(s().rackCablesAll()).toHaveLength(1);
  });

  it('keeps cables whose ports still exist', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 0, 0);
    const pa = s().addInterface(a, 'Gi1/0/1')!;
    const pb = s().addInterface(b, 'vmnic0')!;
    s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#fff');
    s().pruneInterfaceCables(a, [pa, 'p2']);
    expect(s().rackCablesAll()).toHaveLength(1);
  });
});

// Regression: deleting a single interface via the Inspector path (deleteInterface) must
// cascade to rack cables in the SAME undoable transaction. Without the wiring the cable
// orphaned — stale ifaceId surviving save/load and leaking into the CSV export. Uses real
// interface ids (addInterface) so deleteInterface actually removes a port.
describe('CRITICAL cascade — deleteInterface removes the port AND its cable, atomically', () => {
  const hasIface = (id: string, ifaceId: string) =>
    (s().getDevice(id)?.interfaces ?? []).some((i) => i.id === ifaceId);

  it('drops a cable when its port is deleted, and undo restores both together', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 0, 0);
    const pa = s().addInterface(a, 'Gi1/0/1')!;
    const pb = s().addInterface(b, 'vmnic0')!;
    s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#fff');
    expect(s().rackCablesAll()).toHaveLength(1);

    s().deleteInterface(a, pa);
    expect(hasIface(a, pa)).toBe(false);
    expect(s().rackCablesAll()).toHaveLength(0); // cable cascaded out, not orphaned

    s().undo();
    expect(hasIface(a, pa)).toBe(true);
    expect(s().rackCablesAll()).toHaveLength(1); // port + cable came back in one undo
  });

  it('leaves cables on other ports untouched', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 0, 0);
    const pa1 = s().addInterface(a, 'Gi1/0/1')!;
    const pa2 = s().addInterface(a, 'Gi1/0/2')!;
    const pb = s().addInterface(b, 'vmnic0')!;
    s().connectRackCable({ deviceId: a, ifaceId: pa2 }, { deviceId: b, ifaceId: pb }, '#fff');
    s().deleteInterface(a, pa1); // delete a DIFFERENT, uncabled port
    expect(s().rackCablesAll()).toHaveLength(1);
  });
});

describe('cloneRack', () => {
  it('duplicates the rack, its gear, and intra-rack cables with fresh ids; undo restores', () => {
    const r = s().addRack('MDF');
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 0, 0);
    const pa = s().addInterface(a, 'Gi1/0/1')!;
    const pb = s().addInterface(b, 'vmnic0')!;
    s().placeInRack(a, r, slot({ ru: 40 }));
    s().placeInRack(b, r, slot({ ru: 36, ruSpan: 2 }));
    s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#fff');

    const newId = s().cloneRack(r)!;
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(r);
    expect(s().racksAll()).toHaveLength(2);
    const clonedDevices = s().devicesAll().filter((d) => d.rackId === newId);
    expect(clonedDevices).toHaveLength(2); // gear duplicated
    // cable duplicated and rewired to the cloned devices (2 cables total now)
    const cables = s().rackCablesAll();
    expect(cables).toHaveLength(2);
    const clonedIds = new Set(clonedDevices.map((d) => d.id));
    expect(cables.some((c) => clonedIds.has(c.aEnd.deviceId) && clonedIds.has(c.bEnd.deviceId))).toBe(true);

    s().undo();
    expect(s().racksAll()).toHaveLength(1);
    expect(s().rackCablesAll()).toHaveLength(1);
  });

  it('drops the source rack order so the clone lands at the end of the row', () => {
    const r = s().addRack('MDF');
    s().updateRack(r, { order: undefined }, { order: 5 }); // user reordered this rack
    const cloneId = s().cloneRack(r)!;
    expect(s().racksAll().find((x) => x.id === cloneId)!.order).toBeUndefined();
  });

  it('drops cross-rack cables when cloning', () => {
    const r1 = s().addRack('A');
    const r2 = s().addRack('B');
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('switch', 0, 0);
    const pa = s().addInterface(a, 'p1')!;
    const pb = s().addInterface(b, 'p1')!;
    s().placeInRack(a, r1, slot({ ru: 40 }));
    s().placeInRack(b, r2, slot({ ru: 40 }));
    s().connectRackCable({ deviceId: a, ifaceId: pa }, { deviceId: b, ifaceId: pb }, '#fff'); // cross-rack
    s().cloneRack(r1);
    // the clone of r1 has device a' but its only cable was cross-rack → not copied
    expect(s().rackCablesAll()).toHaveLength(1);
  });
});
