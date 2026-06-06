/**
 * Group move carries connector waypoints: when both endpoints of a link are in
 * the moving selection, the link's bend points translate rigidly with the group.
 * When only one endpoint moves, the link reshapes (waypoints stay put).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

function withWaypoint(linkId: string, x: number, y: number) {
  s().updateLink(linkId, {}, { waypoints: [{ x, y }] });
}

describe('group move + connector waypoints', () => {
  it('translates waypoints when BOTH endpoints are dragged', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const linkId = s().connect(a, b)!;
    withWaypoint(linkId, 100, 50);

    s().select([a, b]);
    s().beginDrag();
    s().dragTo(40, 30, true); // suspendSnap → exact delta
    s().endDrag();

    expect(s().linksAll()[0]!.waypoints![0]).toEqual({ x: 140, y: 80 });
  });

  it('leaves waypoints untouched when only ONE endpoint is dragged', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const linkId = s().connect(a, b)!;
    withWaypoint(linkId, 100, 50);

    s().select([a]); // source only
    s().beginDrag();
    s().dragTo(40, 30, true);
    s().endDrag();

    expect(s().linksAll()[0]!.waypoints![0]).toEqual({ x: 100, y: 50 });
  });

  it('one undo restores node positions AND waypoints together', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const ax = s().getDevice(a)!.x;
    const linkId = s().connect(a, b)!;
    withWaypoint(linkId, 100, 50);

    s().select([a, b]);
    s().beginDrag();
    s().dragTo(40, 30, true);
    s().endDrag();
    expect(s().linksAll()[0]!.waypoints![0]).toEqual({ x: 140, y: 80 });

    s().undo();
    expect(s().linksAll()[0]!.waypoints![0]).toEqual({ x: 100, y: 50 });
    expect(s().getDevice(a)!.x).toBe(ax);
  });

  it('keyboard nudge also carries waypoints for a fully-grouped link', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const linkId = s().connect(a, b)!;
    withWaypoint(linkId, 100, 50);

    s().select([a, b]);
    s().nudgeSelection(10, -5);

    expect(s().linksAll()[0]!.waypoints![0]).toEqual({ x: 110, y: 45 });
  });

  it('a waypoint-free link needs no special handling (both ends move)', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    s().connect(a, b);

    s().select([a, b]);
    s().beginDrag();
    s().dragTo(25, 25, true);
    s().endDrag();

    expect(s().linksAll()[0]!.waypoints ?? []).toEqual([]);
  });
});
