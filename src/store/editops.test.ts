/**
 * Phase 1 edit-operation tests: clipboard, lock, nudge. Drives the store directly
 * (it's a singleton) and resets via newProject between cases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('clipboard', () => {
  it('copy + paste creates offset clones with new IDs', () => {
    const a = s().addDeviceAt('router', 100, 100);
    s().select([a]);
    s().copySelection();
    expect(s().hasClipboard()).toBe(true);
    s().paste();
    const devices = s().devicesAll();
    expect(devices).toHaveLength(2);
    const clone = devices.find((d) => d.id !== a);
    expect(clone).toBeTruthy();
    expect(clone!.id).not.toBe(a);
    expect(clone!.x).toBeGreaterThan(100); // offset
    // pasted clone is selected
    expect([...s().selection]).toEqual([clone!.id]);
  });

  it('paste is a single undo entry', () => {
    const a = s().addDeviceAt('router', 0, 0);
    s().select([a]);
    s().copySelection();
    s().paste();
    s().paste();
    expect(s().devicesAll()).toHaveLength(3);
    s().undo();
    expect(s().devicesAll()).toHaveLength(2);
    s().undo();
    expect(s().devicesAll()).toHaveLength(1);
  });

  it('cut copies then deletes', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    s().select([a]);
    s().cutSelection();
    expect(s().devicesAll()).toHaveLength(0);
    expect(s().hasClipboard()).toBe(true);
    s().paste();
    expect(s().devicesAll()).toHaveLength(1);
  });
});

describe('lock', () => {
  it('locked devices resist delete and move', () => {
    const a = s().addDeviceAt('router', 50, 50);
    s().select([a]);
    s().toggleLockSelection();
    expect(s().getDevice(a)!.locked).toBe(true);

    // Delete is blocked.
    s().select([a]);
    s().deleteSelection();
    expect(s().devicesAll()).toHaveLength(1);

    // Nudge is blocked (locked filtered out).
    s().select([a]);
    s().nudgeSelection(10, 0);
    expect(s().getDevice(a)!.x).toBe(50);

    // Unlock, then delete works.
    s().select([a]);
    s().toggleLockSelection();
    expect(s().getDevice(a)!.locked).toBe(false);
    s().select([a]);
    s().deleteSelection();
    expect(s().devicesAll()).toHaveLength(0);
  });
});

describe('nudge', () => {
  it('moves selected devices and is undoable', () => {
    const a = s().addDeviceAt('server', 0, 0);
    s().select([a]);
    s().nudgeSelection(5, -3);
    expect(s().getDevice(a)!.x).toBe(5);
    expect(s().getDevice(a)!.y).toBe(-3);
    s().undo();
    expect(s().getDevice(a)!.x).toBe(0);
    expect(s().getDevice(a)!.y).toBe(0);
  });
});

describe('grouping', () => {
  it('groups members and resolves the whole group from any member', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 100, 0);
    s().select([a, b]);
    s().groupSelection();
    const gid = s().getDevice(a)!.groupId;
    expect(gid).toBeTruthy();
    expect(s().getDevice(b)!.groupId).toBe(gid);
    expect(s().groupMembers(a).sort()).toEqual([a, b].sort());
  });

  it('ungroup clears the group; single selection does not group', () => {
    const a = s().addDeviceAt('router', 0, 0);
    s().select([a]);
    s().groupSelection(); // <2 → no-op
    expect(s().getDevice(a)!.groupId).toBeUndefined();
    const b = s().addDeviceAt('switch', 50, 0);
    s().select([a, b]);
    s().groupSelection();
    s().select([a]);
    s().ungroupSelection();
    expect(s().getDevice(a)!.groupId).toBeUndefined();
  });
});

describe('canvas objects (text + shape)', () => {
  it('creates text and shape objects', () => {
    const t = s().addText(10, 20);
    const sh = s().addShape(0, 0, 200, 120);
    expect(s().getObject(t)!.kind).toBe('text');
    expect(s().getObject(sh)!.kind).toBe('shape');
    expect(s().objectsAll()).toHaveLength(2);
  });

  it('moves objects via the shared drag flow and is undoable', () => {
    const sh = s().addShape(0, 0, 100, 60);
    s().select([sh]);
    s().beginDrag();
    s().dragTo(40, 24, true); // suspend snap
    s().endDrag();
    expect(s().getObject(sh)!.x).toBe(40);
    s().undo();
    expect(s().getObject(sh)!.x).toBe(0);
  });

  it('deletes objects, and lock protects them', () => {
    const t = s().addText(0, 0);
    s().select([t]);
    s().toggleLockSelection();
    expect(s().getObject(t)!.locked).toBe(true);
    s().select([t]);
    s().deleteSelection();
    expect(s().objectsAll()).toHaveLength(1); // locked, not deleted
    s().select([t]);
    s().toggleLockSelection();
    s().select([t]);
    s().deleteSelection();
    expect(s().objectsAll()).toHaveLength(0);
  });

  it('objects survive a document round-trip', () => {
    s().addText(5, 5);
    s().addShape(0, 0, 80, 40);
    const doc = s().getDocument();
    expect(doc.objects).toHaveLength(2);
    s().loadDoc(doc);
    expect(s().objectsAll()).toHaveLength(2);
  });
});

describe('z-order', () => {
  it('bring to front raises z above all others', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 50, 0);
    const c = s().addDeviceAt('server', 100, 0);
    s().select([a]);
    s().bringToFront();
    const za = s().getDevice(a)!.z ?? 0;
    expect(za).toBeGreaterThan(s().getDevice(b)!.z ?? 0);
    expect(za).toBeGreaterThan(s().getDevice(c)!.z ?? 0);
  });

  it('send to back lowers z below all others and is undoable', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 50, 0);
    s().select([b]);
    s().bringToFront(); // b on top
    s().select([a]);
    s().sendToBack();
    expect(s().getDevice(a)!.z ?? 0).toBeLessThan(s().getDevice(b)!.z ?? 0);
    s().undo();
    expect(s().getDevice(a)!.z ?? 0).toBe(0);
  });
});
