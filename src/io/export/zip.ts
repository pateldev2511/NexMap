/**
 * Export package (.zip) — bundles everything a handoff needs (spec Export):
 * the editable .nexmap, a PNG + SVG + PDF render, inventory + links CSV, a
 * plain-text validation report, and (when rules are declared) the rules report. Built with fflate (tiny, dependency-light).
 *
 * The package is always the WHOLE project, never an export scope: every file is
 * derived from the one document it carries, so the editable file, the CSVs, the
 * reports and the renders can't disagree about what's in it. (Declared rules only
 * mean something on the whole design — see rulesReport.ts — so a scoped package
 * couldn't keep its rules report honest.)
 */
import { zipSync, strToU8 } from 'fflate';
import type { Device, Link, NexMapDocument, Rack, RackCable, Subnet, Vlan } from '@/model/types';
import { validate, severityRank } from '@/model/validate';
import { buildDiagramSvg, type DiagramRenderOptions } from './diagram';
import { rasterize, scaleWarning } from './raster';
import { buildPdf } from './pdf';
import { exportInventoryCsv, exportLinksCsv, exportRulesCsv } from './csvExport';
import { buildRulesReport, documentRules, hasDeclaredRules } from './rulesReport';

export interface PackageInput {
  /** The whole project; every file in the package is derived from it. */
  doc: NexMapDocument;
  projectName: string;
}

export interface PackageOptions {
  /** Raster DPI multiplier for diagram.png and the PDF's embedded image. */
  scale: number;
  /** The same render options the Export dialog previews. */
  render: DiagramRenderOptions;
}

export interface PackageResult {
  blob: Blob;
  /** Set when a render came out smaller than asked, or had to be left out. */
  warning?: string;
}

export function validationReport(input: {
  devices: Device[];
  links: Link[];
  vlans?: Vlan[];
  subnets?: Subnet[];
  racks?: Rack[];
  rackCables?: RackCable[];
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
  const issues = validate({ devices, links, vlans, subnets, racks, rackCables: input.rackCables }).sort(
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
  const { doc } = input;
  const rules = documentRules(doc);
  const files: Record<string, string> = {
    'project.nexmap': JSON.stringify(doc, null, 2),
    'inventory.csv': exportInventoryCsv(doc.devices),
    'links.csv': exportLinksCsv(doc.links, doc.devices),
    'validation-report.txt': validationReport({ ...doc, projectName: input.projectName }),
  };
  if (hasDeclaredRules(rules)) files['rules.csv'] = exportRulesCsv(rules);
  return files;
}

/** The package's diagram.svg — exactly what the Export dialog previews for it. */
export function packageSvg(input: PackageInput, render: DiagramRenderOptions): string {
  const { doc } = input;
  return buildDiagramSvg(
    { devices: doc.devices, links: doc.links, objects: doc.objects, projectName: input.projectName },
    render,
  );
}

async function blobToU8(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildPackageZip(input: PackageInput, opts: PackageOptions): Promise<PackageResult> {
  const svg = packageSvg(input, opts.render);
  const rules = documentRules(input.doc);
  const files: Record<string, Uint8Array> = { 'diagram.svg': strToU8(svg) };
  let warning: string | undefined;
  try {
    const png = await rasterize(svg, {
      scale: opts.scale,
      mimeType: 'image/png',
      background: opts.render.background ?? '#ffffff',
    });
    const pdf = await buildPdf(
      svg,
      { pageSize: 'a4', orientation: 'landscape', scale: opts.scale },
      hasDeclaredRules(rules) ? buildRulesReport(rules) : [],
      input.projectName,
    );
    files['diagram.png'] = await blobToU8(png.blob);
    files['diagram.pdf'] = await blobToU8(pdf.blob);
    warning = scaleWarning(opts.scale, png);
  } catch {
    // The vector render and the text files are still a usable handoff.
    warning =
      "Packaged without diagram.png and diagram.pdf — the browser couldn't render the diagram that large. diagram.svg is included.";
  }
  for (const [name, text] of Object.entries(packageTextFiles(input))) files[name] = strToU8(text);
  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer so the Blob gets a clean ArrayBuffer (not SharedArrayBuffer).
  return { blob: new Blob([zipped.slice()], { type: 'application/zip' }), warning };
}
