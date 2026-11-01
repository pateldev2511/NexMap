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
import { rasterize } from './raster';
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
  appendRulesPages(doc, rules, projectName);
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
