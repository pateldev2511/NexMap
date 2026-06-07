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
