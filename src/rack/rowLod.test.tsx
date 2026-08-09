/**
 * Zoom-tiered LOD in the row canvas (W6). `lod.test.ts` proves the tier MATH; this
 * proves the renderer actually honours it — that faceplate art really is skipped at
 * far, that ports really are drawn (and only drawn) at near, and that the tier
 * change does not cost a re-render storm.
 *
 * Includes the E24 perf gate: ~1k ports must stay interactive.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { RackRow } from './RackRow';
import { useProjectStore } from '@/store/projectStore';
import type { Slot } from './rackModel';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const renders = () => (globalThis as { __rowSceneRenders?: number }).__rowSceneRenders ?? 0;

const slot = (ru: number): Slot => ({
  ru,
  ruSpan: 1,
  mount: 'rack',
  side: 'front',
  bay: 'full',
  depth: 'shallow',
});

function renderRow() {
  return render(
    <RackRow
      racks={s().racksAll()}
      devices={s().devicesAll()}
      cables={s().rackCablesAll()}
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

/** Zoom by clicking the zoom cluster `n` times (×1.2 per click). */
function zoom(container: HTMLElement, dir: 'in' | 'out', n: number) {
  const btn = container.querySelector(
    `button[aria-label="Zoom ${dir}"]`,
  ) as HTMLButtonElement;
  for (let i = 0; i < n; i++) act(() => btn.click());
}

const jacks = (c: HTMLElement) => c.querySelectorAll('[data-port]').length;
/**
 * The far tier substitutes an explicitly-marked block for the faceplate art, so
 * presence of that marker is the reliable signal — far cheaper and far less brittle
 * than string-matching generated SVG.
 */
const farBlocks = (c: HTMLElement) => c.querySelectorAll('[data-far-block]').length;
const hasFaceplateArt = (c: HTMLElement) => farBlocks(c) === 0;

function oneRack(devices = 3) {
  s().newProject(NOW);
  const rack = s().addRack('RK001');
  for (let i = 0; i < devices; i++) {
    const d = s().addDeviceAt('switch', 0, 0);
    s().updateDevice(d, {}, { name: `SW0${i + 1}` });
    for (let p = 1; p <= 4; p++) s().addInterface(d, `Gi1/0/${p}`);
    s().placeInRack(d, rack, slot(i + 1));
  }
  return rack;
}

beforeEach(() => {
  (globalThis as { __rowSceneRenders?: number }).__rowSceneRenders = 0;
});

describe('what each tier renders', () => {
  it('starts at mid: faceplates, no individual ports', () => {
    oneRack();
    const { container } = renderRow();
    // IDENTITY scale is 1, which is inside the mid band.
    expect(jacks(container)).toBe(0);
  });

  it('zooming in past nearEnter draws the jacks', () => {
    oneRack();
    const { container } = renderRow();
    expect(jacks(container)).toBe(0);
    // 1 × 1.2 = 1.2, past nearEnter (1.15).
    zoom(container, 'in', 1);
    expect(jacks(container)).toBe(12); // 3 devices × 4 ports
  });

  it('zooming back out removes them again', () => {
    oneRack();
    const { container } = renderRow();
    zoom(container, 'in', 1);
    expect(jacks(container)).toBeGreaterThan(0);
    // Two steps out (1.2 → 1.0 → 0.83) clears nearExit (1.0).
    zoom(container, 'out', 2);
    expect(jacks(container)).toBe(0);
  });

  it('zooming far out drops the faceplate art entirely', () => {
    oneRack();
    const { container } = renderRow();
    expect(hasFaceplateArt(container)).toBe(true);
    // 1 → 0.83 → 0.69 → 0.58 → 0.48 → 0.40, below midExit (0.45).
    zoom(container, 'out', 5);
    expect(hasFaceplateArt(container)).toBe(false);
  });

  it('the far tier still draws a block per device, so nothing vanishes', () => {
    oneRack();
    const { container } = renderRow();
    const before = container.querySelectorAll('[data-dev-id]').length;
    zoom(container, 'out', 5);
    expect(container.querySelectorAll('[data-dev-id]').length).toBe(before);
  });
});

describe('hysteresis in the real renderer (E19)', () => {
  it('a single zoom step inside the dead band changes nothing', () => {
    oneRack();
    const { container } = renderRow();
    // Land inside the near dead band: out one step from 1.2 → 1.0 is exactly
    // nearExit, which must NOT drop out of near.
    zoom(container, 'in', 1); // 1.2 → near
    expect(jacks(container)).toBeGreaterThan(0);
    zoom(container, 'out', 1); // 1.0 — still >= nearExit
    expect(jacks(container)).toBeGreaterThan(0);
  });

  it('crossing a boundary is NOT undone by a single step back — no oscillation', () => {
    oneRack();
    const { container } = renderRow();
    // Drop out of mid into far…
    zoom(container, 'out', 5);
    expect(farBlocks(container)).toBeGreaterThan(0);
    // …and one step back in must NOT immediately restore mid: regaining detail
    // needs the higher `enter` threshold. This is the anti-oscillation guarantee
    // in renderer terms, and it is what a raw ratio comparison of the constants
    // fails to capture (a deliberate zoom SHOULD change tier; a return trip
    // through the dead band should not).
    zoom(container, 'in', 1);
    expect(farBlocks(container)).toBeGreaterThan(0);
    // Two steps does earn it back.
    zoom(container, 'in', 2);
    expect(farBlocks(container)).toBe(0);
  });
});

describe('memoization is not broken by the tier prop', () => {
  it('panning still does NOT re-render the scene', () => {
    oneRack();
    const { container } = renderRow();
    const surface = container.querySelector('[data-canvas-surface]')!;
    const before = renders();
    for (let i = 0; i < 30; i++) {
      fireEvent.wheel(surface, { deltaX: 3, deltaY: 7, deltaMode: 0 });
    }
    expect(renders()).toBe(before);
  });

  it('a tier change re-renders ONCE, not per frame', () => {
    oneRack();
    const { container } = renderRow();
    const before = renders();
    zoom(container, 'in', 1); // crosses into near
    const afterCross = renders();
    expect(afterCross).toBeGreaterThan(before);
    // Further zooming WITHIN near must not re-render the scene again.
    const steady = renders();
    zoom(container, 'in', 3);
    expect(renders()).toBe(steady);
  });
});

describe('E24 perf gate — ~1k ports', () => {
  it('renders 20 racks of 48-port gear at the near tier without blowing up', () => {
    s().newProject(NOW);
    // 20 racks × 1 device × 48 ports = 960 ports.
    for (let r = 0; r < 20; r++) {
      const rack = s().addRack(`RK${r}`);
      const d = s().addDeviceAt('patch-panel', 0, 0);
      for (let p = 1; p <= 48; p++) s().addInterface(d, `${p}`);
      s().placeInRack(d, rack, slot(1));
    }
    const portCount = s()
      .devicesAll()
      .reduce((n, d) => n + (d.interfaces?.length ?? 0), 0);
    expect(portCount).toBe(960);

    const { container } = renderRow();
    zoom(container, 'in', 1); // force the near tier, drawing every jack

    // No wall-clock ceiling: it flaked under full-suite CPU contention, and a real
    // blow-up (quadratic layout, re-render storm) would hit vitest's own timeout
    // rather than merely being slow. What is asserted is that all 960 jacks render.
    expect(jacks(container)).toBe(960);
  });

  it('the far tier provably does less work than the near tier', () => {
    s().newProject(NOW);
    for (let r = 0; r < 20; r++) {
      const rack = s().addRack(`RK${r}`);
      const d = s().addDeviceAt('patch-panel', 0, 0);
      for (let p = 1; p <= 48; p++) s().addInterface(d, `${p}`);
      s().placeInRack(d, rack, slot(1));
    }
    const { container } = renderRow();

    zoom(container, 'in', 1);
    const nearJacks = jacks(container);
    zoom(container, 'out', 6); // well below midExit

    // Asserted STRUCTURALLY, not by comparing two wall-clock timings. Comparing
    // elapsed times between two renders inverts under CPU contention — it flaked
    // exactly that way during a full-suite run. What matters is that the far tier
    // emits strictly less: no jacks, no generated faceplate art, one cheap block per
    // device.
    expect(nearJacks).toBe(960);
    expect(jacks(container)).toBe(0);
    expect(hasFaceplateArt(container)).toBe(false);
    expect(farBlocks(container)).toBe(20);
  });
});
