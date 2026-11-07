/**
 * Rasterize an SVG string to PNG/JPG (spec Export). The SVG is built from the
 * model (buildSvg), drawn onto a canvas at the chosen scale, and exported.
 *
 * Guards the browser canvas-size limit (DA-ENG-H5): if scale would exceed the max
 * canvas dimension or area, we clamp it and report the effective scale so the UI
 * can warn rather than silently producing a blank/clipped image. The caps apply to
 * the canvas actually allocated (after rounding), and a canvas the browser still
 * can't allocate is retried smaller before giving up.
 */

/** Per-axis canvas limit. */
export const MAX_CANVAS_DIM = 16384;
/**
 * Canvas area limit: Firefox's (11,180²), the smallest of the desktop engines, so a
 * large square that fits each axis still gets a canvas every browser can allocate.
 */
export const MAX_CANVAS_AREA = 11180 * 11180;
/** Retries at half the scale when the browser can't allocate the canvas anyway. */
const RETRIES = 3;

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

export interface RasterPlan {
  width: number;
  height: number;
  effectiveScale: number;
  clamped: boolean;
}

/**
 * The canvas a `w`×`h` drawing gets at `scale`: the largest scale (up to the one
 * asked for) whose canvas fits both caps. There's no minimum scale, since one would
 * break the cap on a very long scene. Rounding is checked too, so a size that lands
 * a hair over a cap is trimmed back under it.
 */
export function planRaster(w: number, h: number, scale: number): RasterPlan {
  w = Math.max(1, w);
  h = Math.max(1, h);
  const fit = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h, Math.sqrt(MAX_CANVAS_AREA / (w * h)));
  const effectiveScale = Math.min(scale, fit);
  let clamped = scale > fit;
  let width = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(w * effectiveScale)));
  let height = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(h * effectiveScale)));
  if (width * height > MAX_CANVAS_AREA) {
    if (width >= height) width = Math.floor(MAX_CANVAS_AREA / height);
    else height = Math.floor(MAX_CANVAS_AREA / width);
    clamped = true;
  }
  return { width, height, effectiveScale, clamped };
}

/** Draw onto a `width`×`height` canvas; null when the browser can't allocate or encode it. */
async function drawToBlob(
  img: HTMLImageElement,
  width: number,
  height: number,
  opts: RasterOptions,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // JPEG has no alpha — always paint a background.
  const bg = opts.background ?? (opts.mimeType === 'image/jpeg' ? '#ffffff' : null);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, opts.mimeType, opts.quality));
}

export async function rasterize(svg: string, opts: RasterOptions): Promise<RasterResult> {
  const { w, h } = svgDimensions(svg);
  const img = await loadSvg(svg);
  let plan = planRaster(w, h, opts.scale);
  // A canvas inside the caps can still fail on a memory-tight device: step the
  // scale down rather than fail the export outright.
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) plan = { ...planRaster(w, h, plan.effectiveScale / 2), clamped: true };
    const blob = await drawToBlob(img, plan.width, plan.height, opts);
    if (blob) return { blob, ...plan };
  }
  throw new Error(
    `the browser couldn't create a ${plan.width}×${plan.height} image even at ${plan.effectiveScale.toFixed(2)}×. ` +
      'Export SVG instead: it is vector and has no size limit.',
  );
}

/** The dialog's note when a raster came out smaller than asked; undefined when it didn't. */
export function scaleWarning(requested: number, r: Pick<RasterResult, 'clamped' | 'effectiveScale'>): string | undefined {
  return r.clamped
    ? `Diagram too large at ${requested}× — exported at ${r.effectiveScale.toFixed(2)}× to fit the browser canvas limit.`
    : undefined;
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
