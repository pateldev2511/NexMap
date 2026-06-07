/**
 * rerouteSelectedLinks: A* obstacle avoidance stored as waypoints, undoable.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('rerouteSelectedLinks', () => {
  it('adds bend waypoints to route a selected link around a device in the way', () => {
    const a = s().addDeviceAt('router', 0, 200);
    const b = s().addDeviceAt('switch', 600, 200);
    // A blocker sitting on the straight line between A and B.
    s().addDeviceAt('firewall', 300, 180);
    const link = s().connect(a, b)!;

    s().select([link]);
    s().rerouteSelectedLinks();

    const wp = s().linksAll()[0]!.waypoints ?? [];
    expect(wp.length).toBeGreaterThan(0); // it bent around the blocker
    expect(s().linksAll()[0]!.routing).toBe('orthogonal');
  });

  it('is undoable in one step', () => {
    const a = s().addDeviceAt('router', 0, 200);
    const b = s().addDeviceAt('switch', 600, 200);
    s().addDeviceAt('firewall', 300, 180);
    const link = s().connect(a, b)!;
    s().select([link]);
    s().rerouteSelectedLinks();
    expect((s().linksAll()[0]!.waypoints ?? []).length).toBeGreaterThan(0);
    s().undo();
    expect(s().linksAll()[0]!.waypoints ?? []).toEqual([]);
  });

  it('does nothing when no links are selected', () => {
    const a = s().addDeviceAt('router', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    s().connect(a, b);
    s().clearSelection();
    s().rerouteSelectedLinks();
    expect(s().linksAll()[0]!.waypoints ?? []).toEqual([]);
  });
});
