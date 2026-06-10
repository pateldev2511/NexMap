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
    return { a, b };
  };

  it('connects two ports and lists the cable', () => {
    const { a, b } = setup();
    const id = s().connectRackCable({ deviceId: a, ifaceId: 'p1' }, { deviceId: b, ifaceId: 'nic0' }, '#22d3ee', 'uplink');
    expect(id).toBeTruthy();
    const all = s().rackCablesAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ color: '#22d3ee', label: 'uplink' });
  });

  it('refuses a port that is already cabled, and a self-cable', () => {
    const { a, b } = setup();
    s().connectRackCable({ deviceId: a, ifaceId: 'p1' }, { deviceId: b, ifaceId: 'nic0' }, '#fff');
    expect(s().connectRackCable({ deviceId: a, ifaceId: 'p1' }, { deviceId: b, ifaceId: 'nic1' }, '#fff')).toBeNull();
    expect(s().connectRackCable({ deviceId: a, ifaceId: 'p9' }, { deviceId: a, ifaceId: 'p9' }, '#fff')).toBeNull();
  });

  it('disconnect removes the cable and is undoable', () => {
    const { a, b } = setup();
    const id = s().connectRackCable({ deviceId: a, ifaceId: 'p1' }, { deviceId: b, ifaceId: 'nic0' }, '#fff')!;
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
    s().connectRackCable({ deviceId: a, ifaceId: 'p1' }, { deviceId: b, ifaceId: 'nic0' }, '#fff');
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
    s().connectRackCable({ deviceId: a, ifaceId: 'p1' }, { deviceId: b, ifaceId: 'nic0' }, '#fff');
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
    s().connectRackCable({ deviceId: a, ifaceId: 'p1' }, { deviceId: b, ifaceId: 'nic0' }, '#fff');
    s().pruneInterfaceCables(a, ['p1', 'p2']);
    expect(s().rackCablesAll()).toHaveLength(1);
  });
});
