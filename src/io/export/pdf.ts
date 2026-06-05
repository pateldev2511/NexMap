/**
 * Single-page PDF export (PLAN.md DA-ENG-H1: MVP = single page; multi-page tiling
 * + inventory/IP/validation appendices are Post-MVP).
 *
 * MVP embeds a high-DPI raster of the model-built SVG, fitted to the chosen page.
 * Crisp vector PDF (drawing primitives directly) is a tracked Post-MVP refinement;
 * raster keeps fonts/strokes faithful and avoids the svg2pdf fidelity pitfalls the
 * review flagged, which is the right tradeoff for a quick "export a PDF" MVP.
 */
import { rasterize } from './raster';

export type PageSize = 'a4' | 'letter';

export interface PdfOptions {
  pageSize: PageSize;
  orientation: 'portrait' | 'landscape';
  scale: number; // raster DPI multiplier
}

export async function buildPdfBlob(svg: string, opts: PdfOptions): Promise<Blob> {
  const { blob, width, height } = await rasterize(svg, {
    scale: opts.scale,
    mimeType: 'image/png',
    background: '#ffffff',
  });
  const dataUrl = await blobToDataUrl(blob);

  // Lazy-load jsPDF so non-PDF users don't pay for it (it pulls in html2canvas).
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: opts.orientation,
    unit: 'pt',
    format: opts.pageSize,
  });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 24;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;

  // Fit the image into the page while preserving aspect ratio.
  const ratio = Math.min(availW / width, availH / height);
  const drawW = width * ratio;
  const drawH = height * ratio;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;

  doc.addImage(dataUrl, 'PNG', x, y, drawW, drawH);
  return doc.output('blob');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
