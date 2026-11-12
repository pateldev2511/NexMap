/**
 * #86: the PDF embeds a raster budgeted for print (300 dpi, 16 MP) and compressed.
 * planPdfRaster is pure; the jsPDF test runs the real library on a real PNG.
 */
import { describe, it, expect, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { jsPDF } from 'jspdf';
import { addDiagramImage, pdfDocOptions, pdfWarning, planPdfRaster } from './pdf';

// A4 portrait / landscape minus the 24 pt margins buildPdf uses.
const LAND = { availWpt: 842 - 48, availHpt: 595 - 48 };
const PORT = { availWpt: 595 - 48, availHpt: 842 - 48 };

describe('planPdfRaster', () => {
  it('leaves a small scene exactly as requested (2x)', () => {
    const p = planPdfRaster({ sceneW: 800, sceneH: 600, ...LAND, requestedScale: 2 });
    expect(p.scale).toBe(2);
    expect(p.capped).toBe(false);
    expect(p.fitRatio).toBeCloseTo(547 / 600, 5);
  });

  it('never goes below 1x for dpi alone, and never above the request', () => {
    expect(planPdfRaster({ sceneW: 8000, sceneH: 600, ...LAND, requestedScale: 2 }).scale).toBe(1);
    expect(planPdfRaster({ sceneW: 800, sceneH: 600, ...LAND, requestedScale: 0.5 }).scale).toBe(0.5);
  });

  it('flat wide scene, landscape: width binds the fit', () => {
    const p = planPdfRaster({ sceneW: 2400, sceneH: 800, ...LAND, requestedScale: 4 });
    expect(p.fitRatio).toBeCloseTo(794 / 2400, 5);
    expect(p.scale).toBeCloseTo(Math.max((794 / 2400) * (300 / 72), 1), 5);
  });

  it('tall isometric scene, portrait vs landscape', () => {
    const tall = { sceneW: 3711 / 2, sceneH: 16384 / 2 };
    const port = planPdfRaster({ ...tall, ...PORT, requestedScale: 2 });
    const land = planPdfRaster({ ...tall, ...LAND, requestedScale: 2 });
    expect(port.fitRatio).toBeCloseTo(794 / tall.sceneH, 5);
    expect(land.fitRatio).toBeCloseTo(547 / tall.sceneH, 5);
    expect(port.fitRatio).toBeGreaterThan(land.fitRatio);
    expect(port.scale).toBe(1);
    expect(land.scale).toBe(1);
  });

  it('3711x16384 at 2x (scene 1855.5x8192) comes out at 1x, about 1856x8192', () => {
    const sceneW = 1855.5;
    const sceneH = 8192;
    const p = planPdfRaster({ sceneW, sceneH, ...LAND, requestedScale: 2 });
    expect(p.scale).toBe(1);
    expect(p.capped).toBe(false);
    expect(Math.round(sceneW * p.scale)).toBe(1856);
    expect(Math.round(sceneH * p.scale)).toBe(8192);
  });

  it('caps at 16 megapixels and flags it when that drops below 1x', () => {
    const p = planPdfRaster({ sceneW: 10_000, sceneH: 8_000, ...LAND, requestedScale: 2 });
    expect(p.capped).toBe(true);
    expect(p.scale).toBeLessThan(1);
    expect(10_000 * p.scale * 8_000 * p.scale).toBeLessThanOrEqual(16e6 * 1.0001);
  });

  it('a cap that still leaves 1x or more is not reported as capped', () => {
    const p = planPdfRaster({ sceneW: 3000, sceneH: 2000, ...LAND, requestedScale: 4 });
    expect(p.capped).toBe(false);
    expect(3000 * p.scale * 2000 * p.scale).toBeLessThanOrEqual(16e6 * 1.0001);
  });
});

describe('pdfWarning', () => {
  it('warns when labels print under 6 pt', () => {
    expect(pdfWarning({ fitRatio: 0.0333, capped: false })).toMatch(/Labels will print at about 0\.4 pt/);
    expect(pdfWarning({ fitRatio: 0.4, capped: false })).toMatch(/about 4 pt/);
  });
  it('is silent for readable, uncapped pages', () => {
    expect(pdfWarning({ fitRatio: 1, capped: false })).toBeUndefined();
  });
  it('warns when the pixel budget bit', () => {
    expect(pdfWarning({ fitRatio: 1, capped: true })).toMatch(/16 megapixels/);
  });
});

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A real RGB PNG of a flat diagram-like image (mostly white, a few lines). */
function makePng(w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h).fill(255);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    if (y % 40 === 0) raw.fill(30, y * (w * 3 + 1) + 1, y * (w * 3 + 1) + 1 + w * 3);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

describe('PDF embedding (real jsPDF)', () => {
  it('Flate-compresses the image, far below raw RGB size', () => {
    const w = 928;
    const h = 4096;
    const doc = new jsPDF(pdfDocOptions({ pageSize: 'a4', orientation: 'landscape', scale: 2 }));
    addDiagramImage(doc, makePng(w, h), 842, 595, 100, 440);
    const bytes = (doc.output('arraybuffer') as ArrayBuffer).byteLength;
    const text = new TextDecoder('latin1').decode(doc.output('arraybuffer') as ArrayBuffer);
    console.log(`PDF bytes for ${w}x${h}: ${bytes} (raw RGB ${w * h * 3})`);
    expect(text).toContain('/FlateDecode');
    expect(text).toContain(`/Width ${w}`);
    expect(bytes).toBeLessThan((w * h * 3) / 10);
  });
});

describe('buildPdf error propagation', () => {
  it('lets a RasterSizeError through', async () => {
    vi.resetModules();
    vi.doMock('./raster', async (orig) => {
      const real = await orig<typeof import('./raster')>();
      return {
        ...real,
        rasterize: async () => {
          throw new real.RasterSizeError('boom');
        },
      };
    });
    const { buildPdf } = await import('./pdf');
    const { RasterSizeError } = await import('./raster');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>';
    await expect(buildPdf(svg, { pageSize: 'a4', orientation: 'landscape', scale: 2 })).rejects.toBeInstanceOf(
      RasterSizeError,
    );
    vi.doUnmock('./raster');
  });
});
