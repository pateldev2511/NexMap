/**
 * Paste-to-canvas (Stage 2). Turns clipboard CSV into model objects, reusing the SAME
 * CSV model as the Import dialog (detectCsvKind + autoMap + build*) so there is one
 * parsing path, not two. Pure and testable; the React hook (usePasteToCanvas) applies
 * the result through the store as one undoable transaction.
 *
 * Image paste is handled separately in the hook (sanitized/raster underlay).
 */
import { parseCsv } from '@/lib/csv';
import type { Device, Link, Subnet, Vlan } from '@/model/types';
import {
  autoMap,
  buildDevices,
  buildLinks,
  buildSubnets,
  buildVlans,
  detectCsvKind,
  DEVICE_FIELDS,
  LINK_FIELDS,
} from './csvImport';

export interface PastedCsv {
  kind: 'devices' | 'links' | 'subnets' | 'vlans';
  devices: Device[];
  links: Link[];
  subnets: Subnet[];
  vlans: Vlan[];
  warnings: string[];
}

/** Cheap heuristic: non-empty text whose first line is delimiter-separated. */
export function looksLikeCsv(text: string): boolean {
  const first = text.split(/\r?\n/)[0] ?? '';
  return text.trim().length > 0 && (first.includes(',') || first.includes('\t'));
}

/**
 * Parse pasted CSV into model objects, auto-detecting whether it is devices, links,
 * subnets, or VLANs. Returns null if nothing usable was produced (so the caller can
 * fall through to the default paste behavior).
 */
export function importPastedCsv(
  text: string,
  layerId: string,
  existingDevices: Device[],
): PastedCsv | null {
  const { headers, rows } = parseCsv(text);
  if (rows.length === 0 || headers.length === 0) return null;

  const kind = detectCsvKind(headers);

  if (kind === 'subnets') {
    const subnets = buildSubnets(rows, headers);
    return subnets.length
      ? { kind, devices: [], links: [], subnets, vlans: [], warnings: [] }
      : null;
  }
  if (kind === 'vlans') {
    const vlans = buildVlans(rows, headers);
    return vlans.length
      ? { kind, devices: [], links: [], subnets: [], vlans, warnings: [] }
      : null;
  }
  if (kind === 'links') {
    const r = buildLinks(rows, autoMap(headers, LINK_FIELDS), existingDevices, layerId);
    return r.links.length
      ? { kind, devices: [], links: r.links, subnets: [], vlans: [], warnings: r.warnings }
      : null;
  }

  const r = buildDevices(rows, autoMap(headers, DEVICE_FIELDS), layerId);
  return r.devices.length
    ? { kind: 'devices', devices: r.devices, links: [], subnets: [], vlans: [], warnings: r.warnings }
    : null;
}
