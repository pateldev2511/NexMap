/**
 * Export package (.zip) — bundles everything a handoff needs (spec Export):
 * the editable .nexmap, a PNG + SVG + PDF render, inventory + links CSV, and a
 * plain-text validation report. Built with fflate (tiny, dependency-light).
 */
import { zipSync, strToU8 } from 'fflate';
import type { CanvasObject, Device, Link } from '@/model/types';
import { validate, severityRank } from '@/model/validate';
import { buildSvg } from './buildSvg';
import { rasterize } from './raster';
import { buildPdfBlob } from './pdf';
import { exportInventoryCsv, exportLinksCsv } from './csvExport';

export interface PackageInput {
  devices: Device[];
  links: Link[];
  objects: CanvasObject[];
  projectName: string;
  /** Serialized .nexmap JSON for the editable file in the bundle. */
  docJson: string;
}

export function validationReport(devices: Device[], links: Link[]): string {
  const issues = validate({ devices, links }).sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );
  const lines = [
    'NexMap validation report',
    `Generated for: project export`,
    `Devices: ${devices.length}  Links: ${links.length}`,
    `Issues: ${issues.length}`,
    '',
  ];
  if (issues.length === 0) lines.push('No validation issues — clean.');
  for (const i of issues) lines.push(`[${i.severity.toUpperCase()}] ${i.message}`);
  return lines.join('\n');
}

async function blobToU8(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildPackageZip(input: PackageInput, scale: number): Promise<Blob> {
  const svg = buildSvg(input.devices, input.links, {
    background: '#ffffff',
    includeLabels: true,
    objects: input.objects,
  });
  const png = await rasterize(svg, { scale, mimeType: 'image/png', background: '#ffffff' });
  const pdf = await buildPdfBlob(svg, { pageSize: 'a4', orientation: 'landscape', scale });

  const files: Record<string, Uint8Array> = {
    'project.nexmap': strToU8(input.docJson),
    'diagram.svg': strToU8(svg),
    'diagram.png': await blobToU8(png.blob),
    'diagram.pdf': await blobToU8(pdf),
    'inventory.csv': strToU8(exportInventoryCsv(input.devices)),
    'links.csv': strToU8(exportLinksCsv(input.links, input.devices)),
    'validation-report.txt': strToU8(validationReport(input.devices, input.links)),
  };
  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer so the Blob gets a clean ArrayBuffer (not SharedArrayBuffer).
  return new Blob([zipped.slice()], { type: 'application/zip' });
}
