/**
 * Viewport culling: the renderer reads devices / links / objects through
 * visible*(box) so large diagrams only mount what's on screen. These assert the
 * spatial query actually excludes off-screen content.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const near = { x: -50, y: -50, width: 300, height: 300 };

beforeEach(() => s().newProject(NOW));

describe('viewport culling', () => {
  it('visibleDevices returns only devices intersecting the box', () => {
    const inA = s().addDeviceAt('router', 50, 50);
    s().addDeviceAt('switch', 5000, 5000); // far off-screen
    const vis = s().visibleDevices(near).map((d) => d.id);
    expect(vis).toContain(inA);
    expect(vis).toHaveLength(1);
  });

  it('visibleObjects culls off-screen shapes/text', () => {
    const inShape = s().addShape(40, 40, 120, 80);
    s().addText(6000, 6000); // far away
    const vis = s().visibleObjects(near).map((o) => o.id);
    expect(vis).toContain(inShape);
    expect(vis).toHaveLength(1);
  });

  it('visibleLinks keeps a link when an endpoint is in view', () => {
    const a = s().addDeviceAt('router', 50, 50); // on-screen
    const b = s().addDeviceAt('switch', 5000, 5000); // off-screen
    const link = s().connect(a, b)!;
    const vis = s().visibleLinks(near).map((l) => l.id);
    expect(vis).toContain(link); // visible because endpoint A is in view
  });

  it('visibleLinks drops a link with both endpoints off-screen', () => {
    const a = s().addDeviceAt('router', 5000, 5000);
    const b = s().addDeviceAt('switch', 5300, 5000);
    s().connect(a, b);
    expect(s().visibleLinks(near)).toHaveLength(0);
  });
});

// A long cable whose endpoints are both off-screen still crosses the viewport
// (issue #34): culling tests the drawn route, not just its endpoints.
describe('visibleLinks — routes crossing the viewport', () => {
  /** Center of a device, so boxes can be placed relative to the drawn route. */
  const c = (id: string) => {
    const d = s().getDevice(id)!;
    return { x: d.x + d.width / 2, y: d.y + d.height / 2 };
  };
  const boxAt = (x: number, y: number, size = 100) => ({
    x: x - size / 2,
    y: y - size / 2,
    width: size,
    height: size,
  });
  const visibleIds = (box: { x: number; y: number; width: number; height: number }) =>
    s().visibleLinks(box).map((l) => l.id);

  it('keeps a straight link whose segment crosses the box', () => {
    const a = s().addDeviceAt('router', -1000, 0);
    const b = s().addDeviceAt('switch', 1000, 0);
    const link = s().connect(a, b)!;
    const mid = { x: (c(a).x + c(b).x) / 2, y: c(a).y };
    expect(visibleIds(boxAt(mid.x, mid.y))).toEqual([link]);
    // …and a diagonal crossing, not just an axis-aligned one.
    const d1 = s().addDeviceAt('router', -2000, -2000);
    const d2 = s().addDeviceAt('switch', 2000, 2000);
    const diag = s().connect(d1, d2)!;
    const dm = { x: (c(d1).x + c(d2).x) / 2, y: (c(d1).y + c(d2).y) / 2 };
    expect(visibleIds(boxAt(dm.x, dm.y, 40))).toContain(diag);
  });

  it('still culls a straight link that passes beside the box', () => {
    const a = s().addDeviceAt('router', -1000, 0);
    const b = s().addDeviceAt('switch', 1000, 0);
    s().connect(a, b);
    const mid = { x: (c(a).x + c(b).x) / 2, y: c(a).y };
    expect(visibleIds(boxAt(mid.x, mid.y + 400))).toEqual([]);
  });

  it('tests an orthogonal route by its elbow, not the straight chord', () => {
    const a = s().addDeviceAt('router', -1000, -1000);
    const b = s().addDeviceAt('switch', 1000, 1000);
    const link = s().connect(a, b)!;
    s().updateLink(link, { routing: undefined }, { routing: 'orthogonal' });
    const A = c(a);
    const B = c(b);
    const midX = (A.x + B.x) / 2;
    // The vertical leg runs along x = midX between the two rows.
    expect(visibleIds(boxAt(midX, (A.y + B.y) / 2))).toEqual([link]);
    // The horizontal legs run along each endpoint's row.
    expect(visibleIds(boxAt((A.x + midX) / 2, A.y))).toEqual([link]);
    // A point on the straight chord but off the elbow route is genuinely empty.
    const onChord = { x: A.x + (B.x - A.x) * 0.25, y: A.y + (B.y - A.y) * 0.25 };
    expect(visibleIds(boxAt(onChord.x, onChord.y, 40))).toEqual([]);
  });

  it('tests a waypoint route segment by segment', () => {
    const a = s().addDeviceAt('router', -1000, 0);
    const b = s().addDeviceAt('switch', 1000, 0);
    const link = s().connect(a, b)!;
    const A = c(a);
    const B = c(b);
    const wp = { x: (A.x + B.x) / 2, y: A.y + 2000 };
    s().updateLink(link, { waypoints: undefined }, { waypoints: [wp] });
    // The detour through the waypoint is visible…
    expect(visibleIds(boxAt(wp.x, wp.y))).toEqual([link]);
    expect(visibleIds(boxAt((A.x + wp.x) / 2, (A.y + wp.y) / 2, 40))).toEqual([link]);
    // …the straight chord it no longer follows is not.
    expect(visibleIds(boxAt((A.x + B.x) / 2, A.y))).toEqual([]);
  });

  it('keeps a fanned parallel link whose bowed run crosses the box', () => {
    const a = s().addDeviceAt('router', -1000, 0);
    const b = s().addDeviceAt('switch', 1000, 0);
    // Five parallel links fan out ±36px from the chord at the midpoint.
    const ids = Array.from({ length: 5 }, () => s().connect(a, b)!);
    const mid = { x: (c(a).x + c(b).x) / 2, y: c(a).y };
    // A thin box just beside the chord, inside the fan's outer reach.
    const beside = { x: mid.x - 5, y: mid.y + 30, width: 10, height: 4 };
    expect(new Set(visibleIds(beside))).toEqual(new Set(ids));
  });
});
