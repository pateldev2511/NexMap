/**
 * CSV export for inventory + links (spec Export). Pure string output, unit-tested.
 *
 * Security (DA-S2): every cell is guarded against CSV/formula injection — a value
 * beginning with = + - @ (or tab/CR) is prefixed with a single quote so opening the
 * export in Excel/Sheets can't execute it. Cells with commas/quotes/newlines are
 * RFC-4180 quoted.
 */
import { stripPrefix } from '@/lib/ipcidr';
import { defaultDeviceName } from '@/model/schema';
import type { Device, Link } from '@/model/types';

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvCell(value: string | undefined | null): string {
  let v = value == null ? '' : String(value);
  if (FORMULA_TRIGGER.test(v)) v = `'${v}`; // neutralize formula injection
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}

export function exportInventoryCsv(devices: Device[]): string {
  const headers = ['name', 'type', 'vendor', 'model', 'role', 'location', 'management_ip', 'notes'];
  const rows = devices.map((d) => [
    d.name,
    defaultDeviceName(d.type),
    d.vendor ?? '',
    d.model ?? '',
    d.role ?? '',
    d.location ?? '',
    d.managementIp ? stripPrefix(d.managementIp) : '',
    d.notes ?? '',
  ]);
  return toCsv(headers, rows);
}

export function exportLinksCsv(links: Link[], devices: Device[]): string {
  const name = new Map(devices.map((d) => [d.id, d.name]));
  const headers = [
    'name', 'source', 'source_interface', 'target', 'target_interface', 'type', 'bandwidth',
  ];
  const rows = links.map((l) => [
    l.name ?? '',
    name.get(l.sourceId) ?? '',
    l.sourceInterface ?? '',
    name.get(l.targetId) ?? '',
    l.targetInterface ?? '',
    l.linkType ?? '',
    l.bandwidth ?? '',
  ]);
  return toCsv(headers, rows);
}
