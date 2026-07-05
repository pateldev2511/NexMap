/**
 * M4f perf pin: pan/zoom in the row view must NOT re-render the scene.
 *
 * The row svg's viewport is a CSS transform on the <svg>; everything inside
 * (rack shells, device art via dangerouslySetInnerHTML, cables, budgets) is
 * the memoized RowScene. If a viewport frame re-rendered it, every pan frame
 * would regenerate N racks × M devices of innerHTML strings — the exact hot
 * path this milestone kills. RowScene bumps globalThis.__rowSceneRenders in
 * test mode; wheel-panning here must leave that counter untouched.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RackRow } from './RackRow';
import { useProjectStore } from '@/store/projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const renders = () => (globalThis as { __rowSceneRenders?: number }).__rowSceneRenders ?? 0;

function buildTwoRacks() {
  s().newProject(NOW);
  const rackA = s().addRack('Rack A');
  const rackB = s().addRack('Rack B');
  const d1 = s().addDeviceAt('switch', 0, 0);
  const d2 = s().addDeviceAt('server', 0, 200);
  s().placeInRack(d1, rackA, { ru: 10, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', depth: 'full' });
  s().placeInRack(d2, rackA, { ru: 5, ruSpan: 2, mount: 'rack', side: 'front', bay: 'full', depth: 'full' });
  return { rackA, rackB };
}

function renderRow() {
  const racks = s().racksAll();
  const devices = s().devicesAll();
  return render(
    <RackRow
      racks={racks}
      devices={devices}
      cables={[]}
      selectedId={null}
      searchHits={new Set()}
      showRear={false}
      colorBy="gear"
      onFocusRack={() => {}}
      onSelect={() => {}}
      onReorder={() => {}}
    />,
  );
}

describe('RowScene memoization (M4f)', () => {
  beforeEach(() => {
    (globalThis as { __rowSceneRenders?: number }).__rowSceneRenders = 0;
    buildTwoRacks();
  });

  it('wheel-pan frames do not re-render the scene', () => {
    const { container } = renderRow();
    const surface = container.querySelector('[data-canvas-surface]')!;
    expect(renders()).toBeGreaterThan(0); // scene rendered at least once

    const before = renders();
    // 30 pan frames — the wheel contract pans on plain wheel.
    for (let i = 0; i < 30; i++) {
      fireEvent.wheel(surface, { deltaX: 3, deltaY: 7, deltaMode: 0 });
    }
    expect(renders()).toBe(before);
  });

  it('a model change DOES re-render the scene (memo is not stuck)', () => {
    const view = renderRow();
    const before = renders();
    const d3 = s().addDeviceAt('firewall', 0, 400);
    s().placeInRack(d3, s().racksAll()[0]!.id, {
      ru: 20, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', depth: 'full',
    });
    // Parent (here: the test) hands down fresh arrays like RackDesigner's
    // rev-memoized selectors do.
    view.rerender(
      <RackRow
        racks={s().racksAll()}
        devices={s().devicesAll()}
        cables={[]}
        selectedId={null}
        searchHits={new Set()}
        showRear={false}
        colorBy="gear"
        onFocusRack={() => {}}
        onSelect={() => {}}
        onReorder={() => {}}
      />,
    );
    expect(renders()).toBeGreaterThan(before);
    expect(view.container.querySelectorAll('g[data-dev-id]').length).toBe(3);
  });
});
