/**
 * Export orchestrator: format → build-from-model → download. One entry point so
 * the dialog stays declarative and the build/download wiring lives in one place.
 */
import type { CanvasObject, Device, Link, NexMapDocument, Rack, Subnet, Vlan } from '@/model/types';
import { buildDiagramSvg, type DiagramRenderOptions } from './diagram';
import { buildStandaloneHtml } from './html';
import { rasterize, downloadBlob, scaleWarning } from './raster';
import { buildPdf, type PageSize } from './pdf';
import { exportInventoryCsv, exportLinksCsv, exportRulesCsv } from './csvExport';
import { buildRulesReport, hasDeclaredRules, type RulesReportInput } from './rulesReport';
import { buildPackageZip, packageSvg } from './zip';

export { localDate } from './diagram';

export type ExportFormat =
  | 'png'
  | 'jpg'
  | 'svg'
  | 'pdf'
  | 'html'
  | 'csv-inventory'
  | 'csv-links'
  | 'csv-rules'
  | 'zip';

/**
 * Whether a format honors the export scope. The ZIP package is always the whole
 * project (see zip.ts), and the rules report always the whole design.
 */
export function formatHasScope(format: ExportFormat): boolean {
  return format !== 'zip' && format !== 'csv-rules';
}

export interface ExportScene {
  devices: Device[];
  links: Link[];
  objects: CanvasObject[];
  vlans: Vlan[];
  subnets: Subnet[];
  racks: Rack[];
  projectName: string;
  /** The whole document. The ZIP package is built from it alone, never from the scope above. */
  doc: NexMapDocument;
  /** The whole design + its declared rules, for the rules report (never scoped). */
  rules?: RulesReportInput;
}

export interface ExportOptions extends DiagramRenderOptions {
  format: ExportFormat;
  scale: number;
  quality: number; // jpg
  pageSize: PageSize;
  orientation: 'portrait' | 'landscape';
  fileName: string;
}

function renderOptions(opts: ExportOptions): DiagramRenderOptions {
  return {
    // JPEG has no alpha, so it always gets paper.
    background: opts.format === 'jpg' ? (opts.background ?? '#ffffff') : opts.background,
    includeLabels: opts.includeLabels,
    projection: opts.projection,
    health: opts.health,
    modern: opts.modern,
  };
}

/**
 * The diagram a format renders. The Export dialog previews exactly this, and the
 * export writes exactly this, so the preview can't drift from the file.
 */
export function exportDiagramSvg(scene: ExportScene, opts: ExportOptions): string {
  return opts.format === 'zip'
    ? packageSvg({ doc: scene.doc, projectName: scene.projectName }, renderOptions(opts))
    : buildDiagramSvg(scene, renderOptions(opts));
}

function safeName(name: string, ext: string): string {
  const base =
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .slice(0, 80) || 'nexmap';
  return base.endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

export interface ExportOutcome {
  fileName: string;
  warning?: string;
}

export async function runExport(
  scene: ExportScene,
  opts: ExportOptions,
): Promise<ExportOutcome> {
  const { devices, links } = scene;

  if (opts.format === 'csv-inventory') {
    const csv = exportInventoryCsv(devices);
    const fn = safeName(opts.fileName || `${scene.projectName}-inventory`, 'csv');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), fn);
    return { fileName: fn };
  }
  if (opts.format === 'csv-links') {
    const csv = exportLinksCsv(links, devices);
    const fn = safeName(opts.fileName || `${scene.projectName}-links`, 'csv');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), fn);
    return { fileName: fn };
  }

  if (opts.format === 'csv-rules') {
    const csv = exportRulesCsv(
      scene.rules ?? { devices, links, subnets: scene.subnets, invariants: [], customRules: [] },
    );
    const fn = safeName(opts.fileName || `${scene.projectName}-rules`, 'csv');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), fn);
    return { fileName: fn };
  }

  if (opts.format === 'zip') {
    const { blob, warning } = await buildPackageZip(
      { doc: scene.doc, projectName: scene.projectName },
      { scale: opts.scale, render: renderOptions(opts) },
    );
    const fn = safeName(opts.fileName || `${scene.projectName}-package`, 'zip');
    downloadBlob(blob, fn);
    return { fileName: fn, warning };
  }

  const svg = exportDiagramSvg(scene, opts);

  if (opts.format === 'svg') {
    const fn = safeName(opts.fileName || scene.projectName, 'svg');
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), fn);
    return { fileName: fn };
  }

  // The shareable formats carry the declared rules too (whole design, like the CSV).
  const rulesReport = hasDeclaredRules(scene.rules) ? buildRulesReport(scene.rules) : [];

  if (opts.format === 'html') {
    const html = buildStandaloneHtml(svg, {
      projectName: scene.projectName,
      deviceCount: devices.length,
      linkCount: links.length,
      rules: rulesReport,
    });
    const fn = safeName(opts.fileName || scene.projectName, 'html');
    downloadBlob(new Blob([html], { type: 'text/html' }), fn);
    return { fileName: fn };
  }

  if (opts.format === 'pdf') {
    const { blob, raster } = await buildPdf(
      svg,
      { pageSize: opts.pageSize, orientation: opts.orientation, scale: opts.scale },
      rulesReport,
      scene.projectName,
    );
    const fn = safeName(opts.fileName || scene.projectName, 'pdf');
    downloadBlob(blob, fn);
    return { fileName: fn, warning: scaleWarning(opts.scale, raster) };
  }

  // png / jpg
  const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
  const result = await rasterize(svg, {
    scale: opts.scale,
    mimeType: mime,
    background: renderOptions(opts).background,
    quality: opts.quality,
  });
  const fn = safeName(opts.fileName || scene.projectName, opts.format);
  downloadBlob(result.blob, fn);
  return { fileName: fn, warning: scaleWarning(opts.scale, result) };
}
