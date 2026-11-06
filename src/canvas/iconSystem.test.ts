import { describe, expect, it } from 'vitest';
import { DEVICE_TYPES } from '@/model/schema';
import { artBounds, artElements, pathBounds, type ArtBox } from './iconBounds';
import { deviceIcon } from './deviceVisuals';
import { deviceFlatArt } from './deviceFlatArt';
import { BLUEPRINT, deviceBlueprintArt } from './blueprintArt';
import {
  FLAT_DETAIL_STROKE,
  ICON_CORNER,
  ICON_LIVE,
  ICON_LIVE_SLACK,
  ICON_PORT,
  ICON_SILHOUETTES,
  ICON_STROKE,
  SILHOUETTE_TOLERANCE,
} from './iconSystem';

const SKINS = {
  line: (t: (typeof DEVICE_TYPES)[number]) => artBounds(deviceIcon(t), ICON_STROKE.line),
  flat: (t: (typeof DEVICE_TYPES)[number]) => artBounds(deviceFlatArt(t)),
  blueprint: (t: (typeof DEVICE_TYPES)[number]) =>
    artBounds(deviceBlueprintArt(t), ICON_STROKE.blueprint),
};

const fmt = (b: ArtBox) =>
  `[${[b.minX, b.minY, b.maxX, b.maxY].map((n) => +n.toFixed(2)).join(', ')}]`;

describe('iconBounds', () => {
  it('measures rects, circles and stroked paths', () => {
    expect(artBounds('<rect x="2" y="3" width="4" height="5"/>')).toEqual({
      minX: 2,
      minY: 3,
      maxX: 6,
      maxY: 8,
    });
    // A 2px pen pokes 1px past the geometry.
    expect(artBounds('<circle cx="12" cy="12" r="3"/>', 2)).toEqual({
      minX: 8,
      minY: 8,
      maxX: 16,
      maxY: 16,
    });
    // Filled port dots with stroke="none" don't grow.
    expect(artBounds('<circle cx="5" cy="5" r="1" fill="#fff" stroke="none"/>', 2)!.minX).toBe(4);
  });

  it('follows relative commands and the bulge of an arc', () => {
    expect(pathBounds('M2 2h4v4H2z')).toEqual({ minX: 2, minY: 2, maxX: 6, maxY: 6 });
    // Half circle from (4,10) to (20,10) bulging upward reaches y=2.
    const b = pathBounds('M4 10a8 8 0 0 1 16 0')!;
    expect(b.minY).toBeCloseTo(2, 1);
    expect(b.maxX).toBeCloseTo(20, 5);
  });
});

describe('icon-system spec', () => {
  it('has one silhouette per device type', () => {
    expect(Object.keys(ICON_SILHOUETTES).sort()).toEqual([...DEVICE_TYPES].sort());
  });

  for (const [skin, measure] of Object.entries(SKINS)) {
    it(`${skin}: every icon keeps its ink inside the live area`, () => {
      const out: string[] = [];
      for (const t of DEVICE_TYPES) {
        const b = measure(t)!;
        const lo = ICON_LIVE.min - ICON_LIVE_SLACK;
        const hi = ICON_LIVE.max + ICON_LIVE_SLACK;
        if (b.minX < lo || b.minY < lo || b.maxX > hi || b.maxY > hi) out.push(`${t} ${fmt(b)}`);
      }
      expect(out).toEqual([]);
    });
  }

  for (const skin of ['flat', 'line'] as const) {
    it(`${skin}: every icon traces its type's silhouette`, () => {
      const tol = SILHOUETTE_TOLERANCE[skin];
      const out: string[] = [];
      for (const t of DEVICE_TYPES) {
        const b = SKINS[skin](t)!;
        const [x0, y0, x1, y1] = ICON_SILHOUETTES[t].box;
        const off = Math.max(
          Math.abs(b.minX - x0),
          Math.abs(b.minY - y0),
          Math.abs(b.maxX - x1),
          Math.abs(b.maxY - y1),
        );
        if (off > tol + 1e-9) out.push(`${t} ${fmt(b)} vs [${[x0, y0, x1, y1].join(', ')}]`);
      }
      expect(out).toEqual([]);
    });
  }

  it('line art uses the one pen — no per-element stroke weights', () => {
    const out = DEVICE_TYPES.filter((t) =>
      artElements(deviceIcon(t)).some((e) => e.attrs['stroke-width'] !== undefined),
    );
    expect(out).toEqual([]);
  });

  it('line art corners come from the spec, and only regions use the soft one', () => {
    const allowed = new Set<number>([ICON_CORNER.port, ICON_CORNER.body, ICON_CORNER.region]);
    const out: string[] = [];
    for (const t of DEVICE_TYPES) {
      for (const e of artElements(deviceIcon(t))) {
        if (e.tag !== 'rect' || e.attrs.rx === undefined) continue;
        const rx = Number.parseFloat(e.attrs.rx);
        const region = ICON_SILHOUETTES[t].form === 'region';
        if (!allowed.has(rx) || (rx === ICON_CORNER.region && !region)) out.push(`${t} rx=${rx}`);
      }
    }
    expect(out).toEqual([]);
  });

  it('every port row draws the one port size', () => {
    for (const t of ['switch', 'patch-panel'] as const) {
      const ports = artElements(deviceIcon(t)).filter(
        (e) => e.tag === 'rect' && e.attrs.stroke === 'none',
      );
      expect(ports.length).toBeGreaterThan(0);
      for (const p of ports) {
        expect([+p.attrs.width!, +p.attrs.height!, +p.attrs.rx!]).toEqual([
          ICON_PORT.size,
          ICON_PORT.size,
          ICON_PORT.corner,
        ]);
      }
    }
  });

  it('flat detail lines stay within the detail pen range', () => {
    const out: string[] = [];
    for (const t of DEVICE_TYPES) {
      for (const e of artElements(deviceFlatArt(t))) {
        const sw = e.attrs['stroke-width'];
        if (sw === undefined) continue;
        const w = Number.parseFloat(sw);
        if (w < FLAT_DETAIL_STROKE.min || w > FLAT_DETAIL_STROKE.max) out.push(`${t} ${w}`);
      }
    }
    expect(out).toEqual([]);
  });
});

describe('blueprint skin', () => {
  it('traces the line set: same geometry, in a single ink', () => {
    for (const t of DEVICE_TYPES) {
      const art = deviceBlueprintArt(t);
      // Every line-art primitive is present, recoloured.
      expect(art).toContain(deviceIcon(t, BLUEPRINT.ink));
      // No other paint sneaks in (no fills, no accent colours).
      const paints = [...art.matchAll(/(?:fill|stroke)="(#[0-9a-f]{3,6})"/gi)].map((m) => m[1]);
      expect(new Set(paints)).toEqual(new Set([BLUEPRINT.ink]));
    }
  });

  it('marks the silhouette box with corner registration ticks', () => {
    // UPS box starts at (5, 3); the 0.5 pen sits half inside it.
    expect(deviceBlueprintArt('ups')).toContain('M5.25 4.85V3.25H6.85');
  });
});
