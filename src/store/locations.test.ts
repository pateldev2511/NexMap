/**
 * Location store actions (schema v5): add / rename / reparent / delete, rack+device
 * placement, and the legacy `site` conversion. Every mutation must be exactly ONE
 * undo entry, and the two refusals (cycle, non-empty delete) must never write.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('add / update', () => {
  it('adds a root location', () => {
    const id = s().addLocation('HQ', 'site');
    expect(s().locationsAll()).toHaveLength(1);
    const l = s().locationsAll()[0]!;
    expect(l.id).toBe(id);
    expect(l.name).toBe('HQ');
    expect(l.kind).toBe('site');
    expect(l.parentId).toBeUndefined();
  });

  it('adds a child under a parent', () => {
    const hq = s().addLocation('HQ', 'site');
    const room = s().addLocation('28', 'room', hq);
    expect(s().locationsAll().find((l) => l.id === room)!.parentId).toBe(hq);
  });

  it('add is one undoable step', () => {
    const id = s().addLocation('HQ', 'site');
    s().undo();
    expect(s().locationsAll()).toEqual([]);
    s().redo();
    expect(s().locationsAll().map((l) => l.id)).toEqual([id]);
  });

  it('renames via updateLocation, undoably', () => {
    const id = s().addLocation('HQ', 'site');
    s().updateLocation(id, { name: 'HQ' }, { name: 'Head Office' });
    expect(s().locationsAll()[0]!.name).toBe('Head Office');
    s().undo();
    expect(s().locationsAll()[0]!.name).toBe('HQ');
  });

  it('sets a code', () => {
    const id = s().addLocation('Room 28', 'room');
    s().updateLocation(id, { code: undefined }, { code: '28' });
    expect(s().locationsAll()[0]!.code).toBe('28');
  });
});

describe('reparent (E12 — refuses cycles before writing)', () => {
  it('moves a node under a new parent', () => {
    const hq = s().addLocation('HQ', 'site');
    const dr = s().addLocation('DR', 'site');
    const room = s().addLocation('28', 'room', hq);
    expect(s().reparentLocation(room, dr)).toBe(true);
    expect(s().locationsAll().find((l) => l.id === room)!.parentId).toBe(dr);
  });

  it('promotes to a root with undefined', () => {
    const hq = s().addLocation('HQ', 'site');
    const room = s().addLocation('28', 'room', hq);
    expect(s().reparentLocation(room, undefined)).toBe(true);
    expect(s().locationsAll().find((l) => l.id === room)!.parentId).toBeUndefined();
  });

  it('REFUSES self-parenting and does not write', () => {
    const hq = s().addLocation('HQ', 'site');
    const before = s().locationsAll()[0]!.parentId;
    expect(s().reparentLocation(hq, hq)).toBe(false);
    expect(s().locationsAll()[0]!.parentId).toBe(before);
  });

  it('REFUSES moving a node under its own descendant', () => {
    const hq = s().addLocation('HQ', 'site');
    const b = s().addLocation('B1', 'building', hq);
    const f = s().addLocation('F2', 'floor', b);
    expect(s().reparentLocation(hq, f)).toBe(false);
    expect(s().locationsAll().find((l) => l.id === hq)!.parentId).toBeUndefined();
  });

  it('a refused reparent leaves NO undo entry behind', () => {
    const hq = s().addLocation('HQ', 'site');
    s().reparentLocation(hq, hq);
    // The only undoable thing so far is the add.
    s().undo();
    expect(s().locationsAll()).toEqual([]);
  });

  it('refuses an unknown target parent', () => {
    const hq = s().addLocation('HQ', 'site');
    expect(s().reparentLocation(hq, 'ghost')).toBe(false);
  });

  it('refuses an unknown node', () => {
    expect(s().reparentLocation('ghost', undefined)).toBe(false);
  });

  it('a no-op reparent succeeds without adding history', () => {
    const hq = s().addLocation('HQ', 'site');
    const room = s().addLocation('28', 'room', hq);
    expect(s().reparentLocation(room, hq)).toBe(true);
    s().undo(); // undoes the ADD of room, proving the reparent wrote nothing
    expect(s().locationsAll().map((l) => l.id)).toEqual([hq]);
  });

  it('reparent is undoable', () => {
    const hq = s().addLocation('HQ', 'site');
    const dr = s().addLocation('DR', 'site');
    const room = s().addLocation('28', 'room', hq);
    s().reparentLocation(room, dr);
    s().undo();
    expect(s().locationsAll().find((l) => l.id === room)!.parentId).toBe(hq);
  });
});

describe('delete (E14 — blocked, never cascaded)', () => {
  it('deletes an empty location', () => {
    const id = s().addLocation('HQ', 'site');
    expect(s().deleteLocation(id)).toBeNull();
    expect(s().locationsAll()).toEqual([]);
  });

  it('BLOCKS when a child location remains, and does not write', () => {
    const hq = s().addLocation('HQ', 'site');
    s().addLocation('28', 'room', hq);
    const blockers = s().deleteLocation(hq);
    expect(blockers).toEqual({ childLocations: 1, racks: 0, devices: 0 });
    expect(s().locationsAll()).toHaveLength(2);
  });

  it('BLOCKS when a rack still points at it', () => {
    const hq = s().addLocation('HQ', 'site');
    const rack = s().addRack('RK001');
    s().setRackLocation(rack, hq);
    expect(s().deleteLocation(hq)).toEqual({ childLocations: 0, racks: 1, devices: 0 });
    expect(s().locationsAll()).toHaveLength(1);
  });

  it('BLOCKS when a device still points at it', () => {
    const hq = s().addLocation('HQ', 'site');
    const d = s().addDeviceAt('switch', 0, 0);
    s().setDeviceLocation(d, hq);
    expect(s().deleteLocation(hq)).toEqual({ childLocations: 0, racks: 0, devices: 1 });
  });

  it('deletes once emptied', () => {
    const hq = s().addLocation('HQ', 'site');
    const room = s().addLocation('28', 'room', hq);
    expect(s().deleteLocation(hq)).not.toBeNull();
    s().deleteLocation(room);
    expect(s().deleteLocation(hq)).toBeNull();
    expect(s().locationsAll()).toEqual([]);
  });

  it('delete is undoable and restores every field', () => {
    const id = s().addLocation('HQ', 'site');
    s().updateLocation(id, {}, { code: 'HQ', notes: 'main' });
    s().deleteLocation(id);
    expect(s().locationsAll()).toEqual([]);
    s().undo();
    const restored = s().locationsAll()[0]!;
    expect(restored.code).toBe('HQ');
    expect(restored.notes).toBe('main');
  });

  it('returns null for an unknown id (nothing to block on)', () => {
    expect(s().deleteLocation('ghost')).toBeNull();
  });
});

describe('rack / device placement', () => {
  it('places and unplaces a rack', () => {
    const hq = s().addLocation('HQ', 'site');
    const rack = s().addRack('RK001');
    s().setRackLocation(rack, hq);
    expect(s().racksAll()[0]!.locationId).toBe(hq);
    s().setRackLocation(rack, undefined);
    expect(s().racksAll()[0]!.locationId).toBeUndefined();
  });

  it('refuses a location that does not exist', () => {
    const rack = s().addRack('RK001');
    s().setRackLocation(rack, 'ghost');
    expect(s().racksAll()[0]!.locationId).toBeUndefined();
  });

  it('placement is undoable', () => {
    const hq = s().addLocation('HQ', 'site');
    const d = s().addDeviceAt('switch', 0, 0);
    s().setDeviceLocation(d, hq);
    s().undo();
    expect(s().devicesAll()[0]!.locationId).toBeUndefined();
  });

  it('is a no-op for unknown rack / device ids', () => {
    const hq = s().addLocation('HQ', 'site');
    expect(() => s().setRackLocation('ghost', hq)).not.toThrow();
    expect(() => s().setDeviceLocation('ghost', hq)).not.toThrow();
  });
});

describe('convertSitesToLocations (SD-10 / OQ-1)', () => {
  it('creates one site per distinct name and assigns the racks', () => {
    const r1 = s().addRack('RK001');
    const r2 = s().addRack('RK002');
    const r3 = s().addRack('RK003');
    s().updateRack(r1, {}, { site: 'HQ' });
    s().updateRack(r2, {}, { site: 'HQ' });
    s().updateRack(r3, {}, { site: 'DR' });

    expect(s().convertSitesToLocations()).toEqual({ created: 2, assigned: 3 });
    const locs = s().locationsAll();
    expect(locs).toHaveLength(2);
    expect(locs.every((l) => l.kind === 'site')).toBe(true);

    const byId = new Map(locs.map((l) => [l.id, l.name]));
    const racks = s().racksAll();
    const nameFor = (id: string) => byId.get(racks.find((r) => r.id === id)!.locationId!);
    expect(nameFor(r1)).toBe('HQ');
    expect(nameFor(r2)).toBe('HQ');
    expect(nameFor(r3)).toBe('DR');
  });

  it('NEVER clears the legacy site text', () => {
    const r1 = s().addRack('RK001');
    s().updateRack(r1, {}, { site: 'HQ' });
    s().convertSitesToLocations();
    expect(s().racksAll()[0]!.site).toBe('HQ');
  });

  it('never clobbers a rack that already has a location', () => {
    const existing = s().addLocation('Existing', 'site');
    const r1 = s().addRack('RK001');
    s().updateRack(r1, {}, { site: 'HQ' });
    s().setRackLocation(r1, existing);

    expect(s().convertSitesToLocations()).toEqual({ created: 0, assigned: 0 });
    expect(s().racksAll()[0]!.locationId).toBe(existing);
    expect(s().locationsAll()).toHaveLength(1);
  });

  it('is a no-op when no rack carries a site', () => {
    s().addRack('RK001');
    expect(s().convertSitesToLocations()).toEqual({ created: 0, assigned: 0 });
    expect(s().locationsAll()).toEqual([]);
  });

  it('is ONE undoable transaction — sites and assignments revert together', () => {
    const r1 = s().addRack('RK001');
    const r2 = s().addRack('RK002');
    s().updateRack(r1, {}, { site: 'HQ' });
    s().updateRack(r2, {}, { site: 'DR' });
    s().convertSitesToLocations();
    expect(s().locationsAll()).toHaveLength(2);

    s().undo();
    expect(s().locationsAll()).toEqual([]);
    expect(s().racksAll().every((r) => r.locationId === undefined)).toBe(true);
    // …and the legacy text is still intact after the undo.
    expect(s().racksAll().map((r) => r.site).sort()).toEqual(['DR', 'HQ']);
  });
});

describe('validation wiring', () => {
  const codes = () => s().issues.map((i) => i.code);

  it('a sound tree raises no location issues', () => {
    const hq = s().addLocation('HQ', 'site');
    s().addLocation('28', 'room', hq);
    expect(codes().filter((c) => c.startsWith('location-'))).toEqual([]);
  });

  it('flags a duplicate sibling code', () => {
    const hq = s().addLocation('HQ', 'site');
    const a = s().addLocation('A', 'room', hq);
    const b = s().addLocation('B', 'room', hq);
    s().updateLocation(a, {}, { code: '28' });
    s().updateLocation(b, {}, { code: '28' });
    expect(codes()).toContain('location-duplicate-sibling-code');
  });

  it('flags odd nesting as info only, never an error', () => {
    const room = s().addLocation('Room', 'room');
    s().addLocation('Floor', 'floor', room);
    const issue = s().issues.find((i) => i.code === 'location-odd-nesting');
    expect(issue).toBeTruthy();
    expect(issue!.severity).toBe('info');
  });

  it('flags a rack pointing at a deleted location', () => {
    const hq = s().addLocation('HQ', 'site');
    const rack = s().addRack('RK001');
    s().setRackLocation(rack, hq);
    // Empty it the only legal way, then strand the rack ref by unplacing first.
    s().setRackLocation(rack, undefined);
    s().deleteLocation(hq);
    // Re-point at the now-dead id to simulate a stale ref surviving in a file.
    s().updateRack(rack, {}, { locationId: hq });
    s().runValidation();
    expect(codes()).toContain('location-missing-ref');
  });

  it('zero locations is a valid, quiet state (E17)', () => {
    s().addDeviceAt('switch', 0, 0);
    s().runValidation();
    expect(codes().filter((c) => c.startsWith('location-'))).toEqual([]);
  });
});

describe('persistence round-trip', () => {
  it('locations survive getDocument → loadDoc', () => {
    const hq = s().addLocation('HQ', 'site');
    const room = s().addLocation('28', 'room', hq);
    s().updateLocation(room, {}, { code: '28' });
    const rack = s().addRack('RK001');
    s().setRackLocation(rack, room);

    const doc = s().getDocument();
    expect(doc.locations).toHaveLength(2);

    s().newProject(NOW);
    expect(s().locationsAll()).toEqual([]);
    s().loadDoc(doc);

    expect(s().locationsAll()).toHaveLength(2);
    expect(s().locationsAll().find((l) => l.id === room)!.code).toBe('28');
    expect(s().racksAll()[0]!.locationId).toBe(room);
  });
});
