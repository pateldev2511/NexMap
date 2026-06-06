/**
 * Export orchestrator: format → build-from-model → download. One entry point so
 * the dialog stays declarative and the build/download wiring lives in one place.
 */
import type { CanvasObject, Device, Link, Rack, Subnet, Vlan } from '@/model/types';
import { buildSvg } from './buildSvg';
import { buildStandaloneHtml } from './html';
import { rasterize, downloadBlob } from './raster';
import { buildPdfBlob, type PageSize } from './pdf';
import { exportInventoryCsv, exportLinksCsv } from './csvExport';
import { buildPackageZip } from './zip';

export type ExportFormat =
  | 'png'
  | 'jpg'
  | 'svg'
  | 'pdf'
  | 'html'
  | 'csv-inventory'
  | 'csv-links'
  | 'zip';

export interface ExportScene {
  devices: Device[];
  links: Link[];
  objects: CanvasObject[];
  vlans: Vlan[];
  subnets: Subnet[];
  racks: Rack[];
  projectName: string;
  /** Serialized .nexmap JSON (for the ZIP package's editable file). */
  docJson: string;
}

export interface ExportOptions {
  format: ExportFormat;
  scale: number;
  background: string | null; // null = transparent (png/svg)
  includeLabels: boolean;
  quality: number; // jpg
  pageSize: PageSize;
  orientation: 'portrait' | 'landscape';
  fileName: string;
  /** Render the isometric projection in image/vector exports (Phase 9.6). */
  projection?: 'flat' | 'iso';
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

  if (opts.format === 'zip') {
    const blob = await buildPackageZip(
      {
        devices,
        links,
        objects: scene.objects,
        vlans: scene.vlans,
        subnets: scene.subnets,
        racks: scene.racks,
        projectName: scene.projectName,
        docJson: scene.docJson,
      },
      opts.scale,
    );
    const fn = safeName(opts.fileName || `${scene.projectName}-package`, 'zip');
    downloadBlob(blob, fn);
    return { fileName: fn };
  }

  const svg = buildSvg(devices, links, {
    background: opts.format === 'jpg' ? (opts.background ?? '#ffffff') : opts.background,
    includeLabels: opts.includeLabels,
    objects: scene.objects,
    projection: opts.projection,
  });

  if (opts.format === 'svg') {
    const fn = safeName(opts.fileName || scene.projectName, 'svg');
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), fn);
    return { fileName: fn };
  }

  if (opts.format === 'html') {
    const html = buildStandaloneHtml(svg, {
      projectName: scene.projectName,
      deviceCount: devices.length,
      linkCount: links.length,
    });
    const fn = safeName(opts.fileName || scene.projectName, 'html');
    downloadBlob(new Blob([html], { type: 'text/html' }), fn);
    return { fileName: fn };
  }

  if (opts.format === 'pdf') {
    const blob = await buildPdfBlob(svg, {
      pageSize: opts.pageSize,
      orientation: opts.orientation,
      scale: opts.scale,
    });
    const fn = safeName(opts.fileName || scene.projectName, 'pdf');
    downloadBlob(blob, fn);
    return { fileName: fn };
  }

  // png / jpg
  const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
  const result = await rasterize(svg, {
    scale: opts.scale,
    mimeType: mime,
    background: opts.format === 'jpg' ? (opts.background ?? '#ffffff') : opts.background,
    quality: opts.quality,
  });
  const fn = safeName(opts.fileName || scene.projectName, opts.format);
  downloadBlob(result.blob, fn);
  return {
    fileName: fn,
    warning: result.clamped
      ? `Diagram too large at ${opts.scale}× — exported at ${result.effectiveScale.toFixed(2)}× to fit the browser canvas limit.`
      : undefined,
  };
}
