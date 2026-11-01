/**
 * Export package (.zip) — bundles everything a handoff needs (spec Export):
 * the editable .nexmap, a PNG + SVG + PDF render, inventory + links CSV, a
 * plain-text validation report, and (when rules are declared) the rules report. Built with fflate (tiny, dependency-light).
 */
import { zipSync, strToU8 } from 'fflate';
import type { CanvasObject, Device, Link, Rack, Subnet, Vlan } from '@/model/types';
import { validate, severityRank } from '@/model/validate';
import { buildSvg } from './buildSvg';
import { rasterize } from './raster';
import { buildPdfBlob } from './pdf';
import { exportInventoryCsv, exportLinksCsv, exportRulesCsv } from './csvExport';
import { buildRulesReport, hasDeclaredRules, type RulesReportInput } from './rulesReport';

export interface PackageInput {
  devices: Device[];
  links: Link[];
  objects: CanvasObject[];
  vlans: Vlan[];
  subnets: Subnet[];
  racks: Rack[];
  projectName: string;
  /** Serialized .nexmap JSON for the editable file in the bundle. */
  docJson: string;
  /** The whole design + its declared rules; adds rules.csv (and a PDF rules page) when any are declared. */
  rules?: RulesReportInput;
}

export function validationReport(input: {
  devices: Device[];
  links: Link[];
  vlans?: Vlan[];
  subnets?: Subnet[];
  racks?: Rack[];
  projectName?: string;
}): string {
  const {
    devices,
    links,
    vlans = [],
    subnets = [],
    racks = [],
    projectName = 'project export',
  } = input;
  const issues = validate({ devices, links, vlans, subnets, racks }).sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );
  const lines = [
    'NexMap validation report',
    `Generated for: ${projectName}`,
    `Devices: ${devices.length}  Links: ${links.length}  VLANs: ${vlans.length}  Subnets: ${subnets.length}  Racks: ${racks.length}`,
    `Issues: ${issues.length}`,
    '',
  ];
  if (issues.length === 0) lines.push('No validation issues — clean.');
  for (const i of issues) lines.push(`[${i.severity.toUpperCase()}] ${i.message}`);
  return lines.join('\n');
}

/**
 * The package's text entries (everything but the renders): the editable file,
 * the CSVs and the reports. rules.csv only when the design declares any rules.
 */
export function packageTextFiles(input: PackageInput): Record<string, string> {
  const files: Record<string, string> = {
    'project.nexmap': input.docJson,
    'inventory.csv': exportInventoryCsv(input.devices),
    'links.csv': exportLinksCsv(input.links, input.devices),
    'validation-report.txt': validationReport(input),
  };
  if (hasDeclaredRules(input.rules)) files['rules.csv'] = exportRulesCsv(input.rules);
  return files;
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
  const png = await rasterize(svg, {
    scale,
    mimeType: 'image/png',
    background: '#ffffff',
  });
  const pdf = await buildPdfBlob(
    svg,
    { pageSize: 'a4', orientation: 'landscape', scale },
    hasDeclaredRules(input.rules) ? buildRulesReport(input.rules) : [],
    input.projectName,
  );

  const files: Record<string, Uint8Array> = {
    'diagram.svg': strToU8(svg),
    'diagram.png': await blobToU8(png.blob),
    'diagram.pdf': await blobToU8(pdf),
  };
  for (const [name, text] of Object.entries(packageTextFiles(input))) files[name] = strToU8(text);
  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer so the Blob gets a clean ArrayBuffer (not SharedArrayBuffer).
  return new Blob([zipped.slice()], { type: 'application/zip' });
}
