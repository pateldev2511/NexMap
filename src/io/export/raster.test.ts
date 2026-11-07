/**
 * The rasterizer's canvas-size guard, checked on the canvas it actually allocates.
 * jsdom has no 2D canvas or SVG decoding, so both are stubbed: the stub canvas
 * records the dimensions it was given and can be told to fail like a browser that
 * couldn't allocate the bitmap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MAX_CANVAS_AREA, MAX_CANVAS_DIM, RasterSizeError, planRaster, rasterize } from './raster';
import { buildPdf } from './pdf';

vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 842, getHeight: () => 595 } };
    addImage() {}
    output() {
      return new Blob(['%PDF']);
    }
  },
}));

const svgOf = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"></svg>`;

interface StubCanvas {
  width: number;
  height: number;
}
let canvases: StubCanvas[] = [];
/** How many toBlob calls fail (null blob) before one succeeds. */
let failures = 0;

beforeEach(() => {
  canvases = [];
  failures = 0;
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') return create(tag);
    const c = {
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, drawImage() {}, fillStyle: '' }),
      toBlob: (cb: (b: Blob | null) => void) => {
        if (failures > 0) {
          failures--;
          cb(null);
        } else cb(new Blob(['png'], { type: 'image/png' }));
      },
    };
    canvases.push(c);
    return c as unknown as HTMLCanvasElement;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const within = (r: { width: number; height: number }) => {
  expect(r.width).toBeGreaterThanOrEqual(1);
  expect(r.height).toBeGreaterThanOrEqual(1);
  expect(r.width).toBeLessThanOrEqual(MAX_CANVAS_DIM);
  expect(r.height).toBeLessThanOrEqual(MAX_CANVAS_DIM);
  expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
};

describe('rasterize — canvas-size guard', () => {
  it('keeps an ordinary diagram at the requested scale', async () => {
    const r = await rasterize(svgOf(800, 600), { scale: 2, mimeType: 'image/png', background: null });
    expect([r.width, r.height]).toEqual([1600, 1200]);
    expect(r.clamped).toBe(false);
    expect(r.effectiveScale).toBe(2);
  });

  it('caps a long, narrow scene on its long axis (no 0.1× floor)', async () => {
    const r = await rasterize(svgOf(200_000, 20), { scale: 1, mimeType: 'image/png', background: null });
    within(r);
    expect(canvases[0]).toMatchObject({ width: r.width, height: r.height });
    expect(r.width).toBe(MAX_CANVAS_DIM);
    expect(r.clamped).toBe(true);
    expect(r.effectiveScale).toBeLessThan(0.1);
  });

  it('caps a very tall scene on its tall axis', async () => {
    const r = await rasterize(svgOf(20, 200_000), { scale: 3, mimeType: 'image/jpeg', background: null });
    within(r);
    expect(canvases[0]).toMatchObject({ width: r.width, height: r.height });
    expect(r.height).toBe(MAX_CANVAS_DIM);
    expect(r.clamped).toBe(true);
  });

  it('caps a large square by canvas area, not just per axis', async () => {
    const r = await rasterize(svgOf(12_000, 12_000), { scale: 2, mimeType: 'image/png', background: null });
    within(r);
    expect(canvases[0]).toMatchObject({ width: r.width, height: r.height });
    // Each axis alone would fit at 16,384; the area is what binds.
    expect(r.width).toBeLessThan(MAX_CANVAS_DIM);
    expect(r.clamped).toBe(true);
  });

  it('steps down and retries when the browser cannot allocate the canvas', async () => {
    failures = 2;
    const r = await rasterize(svgOf(4000, 3000), { scale: 1, mimeType: 'image/png', background: null });
    expect(canvases.map((c) => c.width)).toEqual([4000, 2000, 1000]);
    expect([r.width, r.height]).toEqual([1000, 750]);
    expect(r.effectiveScale).toBe(0.25);
    expect(r.clamped).toBe(true);
  });

  it('fails with a typed size error naming the last attempt when every attempt fails', async () => {
    failures = 99;
    const run = rasterize(svgOf(800, 600), { scale: 2, mimeType: 'image/png', background: null });
    await expect(run).rejects.toBeInstanceOf(RasterSizeError);
    await expect(run).rejects.toThrow(/couldn't create a \d+×\d+ image, even at 0\.\d\d×$/);
  });
});

describe('formats sharing the rasterizer', () => {
  it('a PDF embeds the capped canvas, and reports it', async () => {
    const { raster } = await buildPdf(svgOf(200_000, 20), { pageSize: 'a4', orientation: 'landscape', scale: 2 });
    within(raster);
    expect(canvases[0]).toMatchObject({ width: raster.width, height: raster.height });
    expect(raster.clamped).toBe(true);
  });

  it('a very tall PDF too', async () => {
    const { raster } = await buildPdf(svgOf(20, 200_000), { pageSize: 'a4', orientation: 'portrait', scale: 1 });
    within(raster);
    expect(raster.height).toBe(MAX_CANVAS_DIM);
  });
});

describe('planRaster', () => {
  it('rounds without ever exceeding the caps', () => {
    for (const [w, h, s] of [
      [16_383.7, 1, 1],
      [11_180.4, 11_180.4, 1],
      [9999.5, 13_000.5, 1.3],
      [3, 200_000, 0.5],
    ] as const) {
      within(planRaster(w, h, s));
    }
  });
});
