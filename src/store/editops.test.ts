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
