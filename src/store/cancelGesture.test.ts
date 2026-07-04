/**
 * Abort paths for in-flight gestures (pointer-native canvas, M1): cancelDrag
 * and cancelResize restore pre-gesture state and record NOTHING in history.
 * These are what the keyboard router calls before ever letting an undo run,
 * killing the stale-dragOrigins corruption class.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('cancelDrag', () => {
  it('restores device positions and adds no history entry', () => {
    const a = s().addDeviceAt('router', 100, 100);
    const undoBefore = s().canUndo;

    s().select([a]);
    s().beginDrag();
    s().dragTo(60, 40, true);
    expect(s().getDevice(a)!.x).toBe(160); // live move applied

    s().cancelDrag();
    expect(s().getDevice(a)!.x).toBe(100);
    expect(s().getDevice(a)!.y).toBe(100);
    expect(s().canUndo).toBe(undoBefore); // the gesture never happened

    // endDrag after a cancel is a harmless no-op (no dangling origins).
    s().endDrag();
    expect(s().getDevice(a)!.x).toBe(100);
    expect(s().canUndo).toBe(undoBefore);
  });

  it('restores rigid group-link waypoints too', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const linkId = s().connect(a, b)!;
    s().updateLink(linkId, {}, { waypoints: [{ x: 100, y: 50 }] });

    s().select([a, b]);
    s().beginDrag();
    s().dragTo(40, 30, true);
    expect(s().linksAll()[0]!.waypoints![0]).toEqual({ x: 140, y: 80 });

    s().cancelDrag();
    expect(s().linksAll()[0]!.waypoints![0]).toEqual({ x: 100, y: 50 });
  });

  it('undo after a cancelled drag undoes the PREVIOUS edit, not the drag', () => {
    const a = s().addDeviceAt('router', 100, 100); // this is the undoable edit
    s().select([a]);
    s().beginDrag();
    s().dragTo(50, 0, true);
    s().cancelDrag();

    s().undo(); // must remove the device (the add), not fight the drag
    expect(s().getDevice(a)).toBeUndefined();
  });
});

describe('cancelResize', () => {
  it('restores the original box and adds no history entry', () => {
    const id = s().addShape(10, 10, 160, 100);
    const o = s().getObject(id)!;
    const undoBefore = s().canUndo;

    s().beginResize(id);
    s().resizeTo({ x: 10, y: 10, width: o.width + 80, height: o.height + 40 });
    expect(s().getObject(id)!.width).toBe(o.width + 80);

    s().cancelResize();
    const back = s().getObject(id)!;
    expect(back.width).toBe(o.width);
    expect(back.height).toBe(o.height);
    expect(s().canUndo).toBe(undoBefore);

    s().endResize(); // no-op after cancel
    expect(s().canUndo).toBe(undoBefore);
  });
});
