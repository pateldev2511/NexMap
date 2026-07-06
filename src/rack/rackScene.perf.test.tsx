/**
 * Perf pin (review 2026-07-05): pan/zoom frames in the rack FOCUS editor must
 * not re-render the scene (shell/device innerHTML art, cables). RackRow got
 * this memo boundary in M4f; this pins the focus editor's RackFocusScene the
 * same way. The viewport is a CSS transform on the <svg> — wheel-panning must
 * move it WITHOUT calling the art generators again.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RackCanvas } from './RackCanvas';
import { useProjectStore } from '@/store/projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const renders = () => (globalThis as { __rackSceneRenders?: number }).__rackSceneRenders ?? 0;

function buildRack() {
  s().newProject(NOW);
  const rackId = s().addRack('Rack A');
  const d1 = s().addDeviceAt('switch', 0, 0);
  const d2 = s().addDeviceAt('server', 0, 200);
  s().placeInRack(d1, rackId, { ru: 10, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', depth: 'full' });
  s().placeInRack(d2, rackId, { ru: 5, ruSpan: 2, mount: 'rack', side: 'front', bay: 'full', depth: 'full' });
  return rackId;
}

function renderFocus() {
  const rack = s().racksAll()[0]!;
  return render(
    <RackCanvas
      rack={rack}
      devices={s().devicesAll()}
      cables={[]}
      selectedId={null}
      selectedCableId={null}
      side="front"
      armed={false}
      reject={null}
      onPlaceAt={() => {}}
      onDropPreset={() => {}}
      onSelect={() => {}}
      onSelectCable={() => {}}
      onMoveTo={() => {}}
    />,
  );
}

describe('RackFocusScene memoization', () => {
  beforeEach(() => {
    (globalThis as { __rackSceneRenders?: number }).__rackSceneRenders = 0;
    buildRack();
  });

  it('wheel-pan frames move the viewport WITHOUT re-rendering the scene', () => {
    const { container } = renderFocus();
    const surface = container.querySelector('[data-canvas-surface]')!;
    const svg = surface.querySelector('svg')!;
    expect(renders()).toBeGreaterThan(0);

    const styleBefore = svg.getAttribute('style');
    const before = renders();
    for (let i = 0; i < 30; i++) {
      fireEvent.wheel(surface, { deltaX: 3, deltaY: 7, deltaMode: 0 });
    }
    expect(svg.getAttribute('style')).not.toBe(styleBefore); // pan really happened
    expect(renders()).toBe(before); // scene untouched
  });

  it('a model change DOES re-render the scene (memo is not stuck)', () => {
    const view = renderFocus();
    const before = renders();
    const d3 = s().addDeviceAt('firewall', 0, 400);
    s().placeInRack(d3, s().racksAll()[0]!.id, {
      ru: 20, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', depth: 'full',
    });
    const rack = s().racksAll()[0]!;
    view.rerender(
      <RackCanvas
        rack={rack}
        devices={s().devicesAll()}
        cables={[]}
        selectedId={null}
        selectedCableId={null}
        side="front"
        armed={false}
        reject={null}
        onPlaceAt={() => {}}
        onDropPreset={() => {}}
        onSelect={() => {}}
        onSelectCable={() => {}}
        onMoveTo={() => {}}
      />,
    );
    expect(renders()).toBeGreaterThan(before);
    // The new device really is in the scene (3 mounted panels now).
    expect(view.container.querySelectorAll('g[role="button"]').length).toBe(3);
  });
});
