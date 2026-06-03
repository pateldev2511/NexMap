/**
 * Rasterize an SVG string to PNG/JPG (spec Export). The SVG is built from the
 * model (buildSvg), drawn onto a canvas at the chosen scale, and exported.
 *
 * Guards the browser canvas-size limit (DA-ENG-H5): if scale would exceed the max
 * canvas dimension, we clamp it and report the effective scale so the UI can warn
 * rather than silently producing a blank/clipped image.
 */

const MAX_CANVAS_DIM = 16384;

export interface RasterOptions {
  scale: number;
  mimeType: 'image/png' | 'image/jpeg';
  background: string | null;
  quality?: number;
}

export interface RasterResult {
  blob: Blob;
  width: number;
  height: number;
  effectiveScale: number;
  clamped: boolean;
}

function svgDimensions(svg: string): { w: number; h: number } {
  const w = Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 800);
  const h = Number(/height="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 600);
  return { w, h };
}

function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to rasterize SVG'));
    img.src = url;
  });
}

export async function rasterize(svg: string, opts: RasterOptions): Promise<RasterResult> {
  const { w, h } = svgDimensions(svg);
  let scale = opts.scale;
  let clamped = false;
  const maxScale = MAX_CANVAS_DIM / Math.max(w, h);
  if (scale > maxScale) {
    scale = Math.max(0.1, maxScale);
    clamped = true;
  }
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const img = await loadSvg(svg);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  // JPEG has no alpha — always paint a background.
  const bg = opts.background ?? (opts.mimeType === 'image/jpeg' ? '#ffffff' : null);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);
  }
  ctx.drawImage(img, 0, 0, cw, ch);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
      opts.mimeType,
      opts.quality,
    );
  });
  return { blob, width: cw, height: ch, effectiveScale: scale, clamped };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
