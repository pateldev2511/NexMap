/**
 * Single-page PDF export (PLAN.md DA-ENG-H1: MVP = single page; multi-page tiling
 * + inventory/IP/validation appendices are Post-MVP). The one appendix it has: the
 * declared rules, when there are any.
 *
 * MVP embeds a high-DPI raster of the model-built SVG, fitted to the chosen page.
 * Crisp vector PDF (drawing primitives directly) is a tracked Post-MVP refinement;
 * raster keeps fonts/strokes faithful and avoids the svg2pdf fidelity pitfalls the
 * review flagged, which is the right tradeoff for a quick "export a PDF" MVP.
 */
import { rasterize, svgDimensions, type RasterResult } from './raster';
import { pdfSafe, rulesReportLines, rulesVerdict, type RuleReportEntry } from './rulesReport';

export type PageSize = 'a4' | 'letter';

export interface PdfOptions {
  pageSize: PageSize;
  orientation: 'portrait' | 'landscape';
  scale: number; // raster DPI multiplier
}

/** The slice of jsPDF the rules appendix draws with (so it's testable on a real doc). */
interface PdfDoc {
  addPage(): unknown;
  setFontSize(size: number): unknown;
  setFont(name: string, style: string): unknown;
  text(text: string, x: number, y: number): unknown;
  splitTextToSize(text: string, maxWidth: number): string[];
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
}

/**
 * Append the declared rules after the diagram: the verdict, then each rule with
 * its status and every offender with its reason, flowing onto more pages as needed.
 */
export function appendRulesPages(doc: PdfDoc, rules: readonly RuleReportEntry[], projectName: string): void {
  if (rules.length === 0) return;
  const margin = 40;
  const lineH = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.addPage();
  let y = margin + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(pdfSafe(`${projectName || 'NexMap diagram'} - declared rules`), margin, y);
  y += lineH * 1.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${rulesVerdict(rules)}, checked against the whole design when exported.`, margin, y);
  y += lineH * 1.5;
  for (const line of rulesReportLines(rules)) {
    const offender = line.startsWith('    ');
    doc.setFont('helvetica', offender ? 'normal' : 'bold');
    for (const part of doc.splitTextToSize(line.trimStart(), pageW - margin * 2 - (offender ? 16 : 0))) {
      if (y > pageH - margin) {
        doc.addPage();
        y = margin + 6;
      }
      doc.text(part, margin + (offender ? 16 : 0), y);
      y += lineH;
    }
  }
}

export async function buildPdfBlob(
  svg: string,
  opts: PdfOptions,
  rules: readonly RuleReportEntry[] = [],
  projectName = '',
): Promise<Blob> {
  return (await buildPdf(svg, opts, rules, projectName)).blob;
}

/** Print resolution the embedded raster is budgeted for. */
export const PDF_TARGET_DPI = 300;
/** Hard budget on the embedded raster, in pixels (16 megapixels). */
export const PDF_MAX_PIXELS = 16e6;
/** Page margin around the fitted diagram, in pt. */
const PAGE_MARGIN = 24;
/** Device label size in buildSvg, in scene px (1 scene px = 1 pt before fitting). */
export const LABEL_PX = 11;
/** Below this many printed points a label is hard to read. */
export const MIN_LEGIBLE_PT = 6;

export interface PdfRasterPlan {
  /** Raster scale to request (never above what was asked). */
  scale: number;
  /** Printed points per scene px: how much the page shrinks the diagram. */
  fitRatio: number;
  /** True when the pixel budget pushed the scale below 1x. */
  capped: boolean;
}

/**
 * The raster scale a PDF page actually needs: enough for 300 dpi at the size the
 * diagram prints, never more than asked, never more than the pixel budget, and
 * never below 1x because of the dpi rule alone (small scenes stay as they were).
 */
export function planPdfRaster(p: {
  sceneW: number;
  sceneH: number;
  availWpt: number;
  availHpt: number;
  requestedScale: number;
}): PdfRasterPlan {
  const sceneW = Math.max(1, p.sceneW);
  const sceneH = Math.max(1, p.sceneH);
  const fitRatio = Math.min(p.availWpt / sceneW, p.availHpt / sceneH);
  const dpiScale = (fitRatio * PDF_TARGET_DPI) / 72;
  const pixelCap = Math.sqrt(PDF_MAX_PIXELS / (sceneW * sceneH));
  const scale = Math.min(p.requestedScale, Math.max(dpiScale, 1), pixelCap);
  return { scale, fitRatio, capped: pixelCap < 1 && scale < 1 };
}

/** Legibility and budget warnings for a planned PDF; undefined when there is nothing to say. */
export function pdfWarning(plan: Pick<PdfRasterPlan, 'fitRatio' | 'capped'>): string | undefined {
  const parts: string[] = [];
  const labelPt = LABEL_PX * plan.fitRatio;
  if (labelPt < MIN_LEGIBLE_PT) {
    parts.push(
      `Labels will print at about ${labelPt < 1 ? labelPt.toFixed(1) : Math.round(labelPt)} pt on this page \u2014 export a single view, or pick a larger page.`,
    );
  }
  if (plan.capped) {
    parts.push('Diagram is very large \u2014 the PDF image was reduced to stay within 16 megapixels.');
  }
  return parts.length ? parts.join(' ') : undefined;
}

/** Constructor options for the PDF: compress streams (the image is the bulk of the file). */
export function pdfDocOptions(opts: PdfOptions) {
  return { orientation: opts.orientation, unit: 'pt' as const, format: opts.pageSize, compress: true };
}

/** The slice of jsPDF that embeds the diagram image. */
interface ImageDoc {
  addImage(
    data: Uint8Array,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number,
    alias?: string,
    compression?: 'NONE' | 'FAST' | 'MEDIUM' | 'SLOW',
  ): unknown;
}

/** Centre `png` (PNG bytes) on the page at drawW x drawH pt, Flate-compressed. */
export function addDiagramImage(
  doc: ImageDoc,
  png: Uint8Array,
  pageW: number,
  pageH: number,
  drawW: number,
  drawH: number,
): void {
  doc.addImage(png, 'PNG', (pageW - drawW) / 2, (pageH - drawH) / 2, drawW, drawH, 'nexmap-diagram', 'FAST');
}

export interface PdfResult {
  blob: Blob;
  raster: RasterResult;
  /** Printed points per scene px (see planPdfRaster). */
  fitRatio: number;
  /** The scale the raster was planned at (what the PDF embeds, before any canvas clamp). */
  effectiveScale: number;
  /** The pixel budget reduced the image below 1x. */
  capped: boolean;
}

/** The PDF plus the raster it embeds, so a caller can warn when that came out smaller than asked. */
export async function buildPdf(
  svg: string,
  opts: PdfOptions,
  rules: readonly RuleReportEntry[] = [],
  projectName = '',
): Promise<PdfResult> {
  // Lazy-load jsPDF so non-PDF users don't pay for it (it pulls in html2canvas).
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF(pdfDocOptions(opts));
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Page geometry first, so the raster is sized for what will actually print.
  const { w: sceneW, h: sceneH } = svgDimensions(svg);
  const plan = planPdfRaster({
    sceneW,
    sceneH,
    availWpt: pageW - PAGE_MARGIN * 2,
    availHpt: pageH - PAGE_MARGIN * 2,
    requestedScale: opts.scale,
  });
  const raster = await rasterize(svg, { scale: plan.scale, mimeType: 'image/png', background: '#ffffff' });

  const png = await blobBytes(raster.blob);
  addDiagramImage(doc, png, pageW, pageH, sceneW * plan.fitRatio, sceneH * plan.fitRatio);
  appendRulesPages(doc, rules, projectName);
  return {
    blob: doc.output('blob'),
    raster,
    fitRatio: plan.fitRatio,
    effectiveScale: plan.scale,
    capped: plan.capped,
  };
}

/** Blob bytes; FileReader fallback for environments (jsdom) whose Blob lacks arrayBuffer(). */
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
