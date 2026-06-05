/**
 * Phase 8 editor-polish store ops: align, distribute, and transient object
 * resize. Drives the singleton store directly, resetting via newProject.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('alignSelection', () => {
  it('aligns left edges to the leftmost', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 100, 50);
    s().select([a, b]);
    s().alignSelection('left');
    expect(s().getDevice(a)!.x).toBe(0);
    expect(s().getDevice(b)!.x).toBe(0);
  });

  it('aligns top edges to the topmost', () => {
    const a = s().addDeviceAt('router', 0, 20);
    const b = s().addDeviceAt('switch', 100, 80);
    s().select([a, b]);
    s().alignSelection('top');
    expect(s().getDevice(a)!.y).toBe(20);
    expect(s().getDevice(b)!.y).toBe(20);
  });

  it('is a single undo entry', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 100, 50);
    s().select([a, b]);
    s().alignSelection('left');
    s().undo();
    expect(s().getDevice(b)!.x).toBe(100); // restored
  });

  it('ignores locked entities', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 100, 0);
    s().select([b]);
    s().toggleLockSelection();
    s().select([a, b]);
    s().alignSelection('left');
    expect(s().getDevice(b)!.x).toBe(100); // locked, unmoved
  });
});

describe('distributeSelection', () => {
  it('evenly spaces centers of the middle items', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 40, 0);
    const c = s().addDeviceAt('server', 200, 0);
    s().select([a, b, c]);
    s().distributeSelection('h');
    // First/last fixed; middle center sits halfway → b.x === 100 regardless of width.
    expect(s().getDevice(b)!.x).toBe(100);
    expect(s().getDevice(a)!.x).toBe(0);
    expect(s().getDevice(c)!.x).toBe(200);
  });

  it('is a no-op for fewer than 3 entities', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 40, 0);
    s().select([a, b]);
    s().distributeSelection('h');
    expect(s().getDevice(a)!.x).toBe(0);
    expect(s().getDevice(b)!.x).toBe(40); // unchanged
  });
});

describe('autoLayout', () => {
  it('repositions connected devices as one undoable entry', () => {
    const a = s().addDeviceAt('router', 5, 5);
    const b = s().addDeviceAt('switch', 999, 999);
    s().connect(a, b);
    const beforeB = { ...s().getDevice(b)! };
    s().autoLayout();
    const afterB = s().getDevice(b)!;
    expect(afterB.x !== beforeB.x || afterB.y !== beforeB.y).toBe(true);
    // single undo restores
    s().undo();
    expect(s().getDevice(b)!.x).toBe(beforeB.x);
    expect(s().getDevice(b)!.y).toBe(beforeB.y);
  });

  it('leaves locked devices in place', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 700, 700);
    s().connect(a, b);
    s().select([b]);
    s().toggleLockSelection();
    const lockedPos = { ...s().getDevice(b)! };
    s().autoLayout();
    expect(s().getDevice(b)!.x).toBe(lockedPos.x);
    expect(s().getDevice(b)!.y).toBe(lockedPos.y);
  });

  it('is a no-op with no devices', () => {
    s().autoLayout();
    expect(s().canUndo).toBe(false);
  });
});

describe('projection (Phase 9)', () => {
  it('defaults to flat and toggles', () => {
    expect(s().projection).toBe('flat');
    s().setProjection('iso');
    expect(s().projection).toBe('iso');
    s().setProjection('flat');
    expect(s().projection).toBe('flat');
  });

  it('saved views capture and restore the projection', () => {
    s().setProjection('iso');
    const viewId = s().addView('Iso view');
    s().setProjection('flat');
    expect(s().projection).toBe('flat');
    s().applyView(viewId);
    expect(s().projection).toBe('iso');
  });

  it('resets to flat on new project', () => {
    s().setProjection('iso');
    s().newProject(NOW);
    expect(s().projection).toBe('flat');
  });
});

describe('object resize', () => {
  it('commits a transient resize as one undoable entry', () => {
    const id = s().addShape(10, 10, 100, 80);
    s().select([id]);
    s().beginResize(id);
    s().resizeTo({ x: 10, y: 10, width: 200, height: 80 });
    s().endResize();
    expect(s().getObject(id)!.width).toBe(200);
    s().undo();
    expect(s().getObject(id)!.width).toBe(100);
  });

  it('does not record history when nothing changed', () => {
    const id = s().addShape(10, 10, 100, 80);
    s().select([id]);
    const before = s().canUndo;
    s().beginResize(id);
    s().resizeTo({ x: 10, y: 10, width: 100, height: 80 });
    s().endResize();
    expect(s().canUndo).toBe(before);
  });

  it('refuses to resize a locked object', () => {
    const id = s().addShape(10, 10, 100, 80);
    s().select([id]);
    s().toggleLockSelection();
    s().beginResize(id);
    s().resizeTo({ x: 10, y: 10, width: 300, height: 80 });
    s().endResize();
    expect(s().getObject(id)!.width).toBe(100);
  });
});
