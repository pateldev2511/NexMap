/**
 * Faceplate zone geometry. The load-bearing property is DISJOINTNESS: if the zones
 * never overlap, and ports are laid out inside `ports` while furniture is drawn in
 * the others, then a port can never land on a vent or a fan — by construction
 * rather than by coincidence.
 */
import { describe, expect, it } from 'vitest';
import {
  PORTS_PER_PANEL_ROW,
  fanCircles,
  patchPanelOverCapacity,
  patchPanelRowCapacity,
  patchPanelRows,
  serverFaceZones,
} from './faceZones';
import { BAY_W, RAIL_PX, U_PX, type Rect } from './rackLayout';

/** A full-bay panel of `span` U, matching what deviceRect produces. */
const panel = (span: number): Rect => ({
  x: RAIL_PX,
  y: 0,
  w: BAY_W - RAIL_PX * 2,
  h: span * U_PX,
});

const overlap = (a: Rect, b: Rect) => {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0.01 && oy > 0.01 ? ox * oy : 0;
};

const SPANS = [1, 2, 3, 4, 6, 8];

describe('serverFaceZones — disjointness', () => {
  it('ports never overlap vents, fans, drives, or the label, at any height', () => {
    for (const span of SPANS) {
      const p = panel(span);
      const z = serverFaceZones(p);
      const others: [string, Rect | null][] = [
        ['label', z.label],
        ['fans', z.fans],
        ['drives', z.drives],
        ['vents', z.vents],
      ];
      for (const [name, other] of others) {
        if (!other) continue;
        expect(
          overlap(z.ports, other),
          `${span}U: ports overlap ${name} by ${overlap(z.ports, other).toFixed(1)}px²`,
        ).toBe(0);
      }
    }
  });

  it('every zone stays inside the panel', () => {
    for (const span of SPANS) {
      const p = panel(span);
      const z = serverFaceZones(p);
      for (const r of [z.label, z.ports, z.fans, z.drives, z.vents]) {
        if (!r) continue;
        expect(r.x).toBeGreaterThanOrEqual(p.x - 0.01);
        expect(r.y).toBeGreaterThanOrEqual(p.y - 0.01);
        expect(r.x + r.w).toBeLessThanOrEqual(p.x + p.w + 0.01);
        expect(r.y + r.h).toBeLessThanOrEqual(p.y + p.h + 0.01);
      }
    }
  });

  it('zones run label → ports → fans → drives, left to right', () => {
    const z = serverFaceZones(panel(2));
    expect(z.label.x + z.label.w).toBeLessThanOrEqual(z.ports.x);
    expect(z.ports.x + z.ports.w).toBeLessThanOrEqual(z.fans.x);
    expect(z.fans.x + z.fans.w).toBeLessThanOrEqual(z.drives.x);
  });

  it('a 1U chassis has NO vent strip — there is no room outside the port band', () => {
    // Real 1U server fronts are bezel + drive bays; the perforation is part of the
    // bezel. Cramming a slat block over the ports is what caused the original bug.
    expect(serverFaceZones(panel(1)).vents).toBeNull();
  });

  it('2U and taller DO get a vent strip, below the ports', () => {
    for (const span of [2, 3, 4]) {
      const z = serverFaceZones(panel(span));
      expect(z.vents).not.toBeNull();
      expect(z.vents!.y).toBeGreaterThanOrEqual(z.ports.y + z.ports.h);
    }
  });

  it('the port band keeps its minimum width even when the drive bezel is greedy', () => {
    for (const span of SPANS) {
      expect(serverFaceZones(panel(span)).ports.w).toBeGreaterThanOrEqual(40);
    }
  });

  it('a narrow half-bay panel still yields disjoint zones', () => {
    // bay: 'left' / 'right' devices get roughly half the width.
    const half: Rect = { x: RAIL_PX, y: 0, w: (BAY_W - RAIL_PX * 2) / 2 - 2, h: U_PX };
    const z = serverFaceZones(half);
    expect(overlap(z.ports, z.drives)).toBe(0);
    expect(overlap(z.ports, z.fans)).toBe(0);
    expect(z.ports.w).toBeGreaterThanOrEqual(40);
  });

  it('tall is false at 1U and true from 2U', () => {
    expect(serverFaceZones(panel(1)).tall).toBe(false);
    expect(serverFaceZones(panel(2)).tall).toBe(true);
  });
});

describe('fanCircles', () => {
  it('every fan stays wholly inside its zone', () => {
    for (const span of SPANS) {
      const z = serverFaceZones(panel(span));
      for (const count of [1, 2, 3]) {
        for (const f of fanCircles(z.fans, count)) {
          expect(f.cx - f.r).toBeGreaterThanOrEqual(z.fans.x - 0.01);
          expect(f.cx + f.r).toBeLessThanOrEqual(z.fans.x + z.fans.w + 0.01);
          expect(f.cy - f.r).toBeGreaterThanOrEqual(z.fans.y - 0.01);
          expect(f.cy + f.r).toBeLessThanOrEqual(z.fans.y + z.fans.h + 0.01);
        }
      }
    }
  });

  it('degrades to fewer fans rather than drawing slivers', () => {
    const narrow: Rect = { x: 0, y: 0, w: 20, h: 20 };
    const fans = fanCircles(narrow, 3);
    expect(fans.length).toBeLessThan(3);
    for (const f of fans) expect(f.r).toBeGreaterThanOrEqual(4);
  });

  it('returns nothing for a zone with no room', () => {
    expect(fanCircles({ x: 0, y: 0, w: 0, h: 0 }, 3)).toEqual([]);
    expect(fanCircles({ x: 0, y: 0, w: 8, h: 8 }, 1)).toEqual([]);
  });

  it('fans never reach the port band, whatever the count', () => {
    for (const span of SPANS) {
      const z = serverFaceZones(panel(span));
      for (const count of [1, 2, 3, 5]) {
        for (const f of fanCircles(z.fans, count)) {
          const box = { x: f.cx - f.r, y: f.cy - f.r, w: f.r * 2, h: f.r * 2 };
          expect(overlap(box, z.ports)).toBe(0);
        }
      }
    }
  });
});

describe('patch-panel density', () => {
  it('24 ports is one row — the universal real-world density', () => {
    expect(PORTS_PER_PANEL_ROW).toBe(24);
    expect(patchPanelRows(24)).toBe(1);
    expect(patchPanelRows(1)).toBe(1);
  });

  it('48 ports needs two rows — one row of 48 does not exist as hardware', () => {
    expect(patchPanelRows(48)).toBe(2);
    expect(patchPanelRows(25)).toBe(2);
  });

  it('scales past 48', () => {
    expect(patchPanelRows(72)).toBe(3);
    expect(patchPanelRows(96)).toBe(4);
  });

  it('capacity is one keystone row per U', () => {
    expect(patchPanelRowCapacity(1)).toBe(1);
    expect(patchPanelRowCapacity(2)).toBe(2);
  });

  it('48 ports in 1U is over capacity; in 2U it is not', () => {
    expect(patchPanelOverCapacity(48, 1)).toBe(true);
    expect(patchPanelOverCapacity(48, 2)).toBe(false);
    expect(patchPanelOverCapacity(24, 1)).toBe(false);
  });

  it('a fractional or zero span never divides by zero', () => {
    expect(patchPanelRowCapacity(0)).toBe(1);
    expect(patchPanelOverCapacity(24, 0)).toBe(false);
  });
});
