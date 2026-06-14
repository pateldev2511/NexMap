/**
 * Bill of materials — roll up the fleet into a procurement-ready list: quantity by model,
 * with total power, weight, and (where prices exist) cost. Pure; CSV output reuses the
 * injection-guarded csvCell from the shared exporter.
 *
 * Grouping key is vendor+model+type so two "Dell R660" servers collapse into one line of
 * qty 2. Gear with no vendor/model groups by type ("server", "switch", …) so nothing is
 * dropped. Cost is optional: totalPriceUsd sums only priced devices and pricedCount tells
 * the UI how complete the costing is (never imply a total is complete when it isn't).
 */
import type { Device, DeviceType } from '@/model/types';
import { csvCell } from '@/io/export/csvExport';
import { defaultDeviceName } from '@/model/schema';

export interface BomLine {
  key: string;
  vendor: string;
  model: string;
  type: DeviceType;
  qty: number;
  /** Line total watts / weight (per-unit × qty, summed from actual device values). */
  watts: number;
  weightKg: number;
  /** Line total price, present only if every device in the line has a price. */
  priceUsd?: number;
}

export interface Bom {
  lines: BomLine[];
  totalDevices: number;
  totalWatts: number;
  totalWeightKg: number;
  /** Sum of priced devices only. */
  totalPriceUsd: number;
  /** How many devices carried a price (vs totalDevices) — surfaces costing completeness. */
  pricedCount: number;
}

function label(d: Device): { vendor: string; model: string; type: DeviceType; key: string } {
  const vendor = d.vendor?.trim() ?? '';
  const model = d.model?.trim() ?? '';
  const type = d.type;
  return { vendor, model, type, key: `${vendor}||${model}||${type}` };
}

export function buildBom(devices: Device[]): Bom {
  const byKey = new Map<string, BomLine>();
  let totalWatts = 0;
  let totalWeightKg = 0;
  let totalPriceUsd = 0;
  let pricedCount = 0;

  for (const d of devices) {
    const { vendor, model, type, key } = label(d);
    const watts = d.watts ?? 0;
    const weightKg = d.weightKg ?? 0;
    totalWatts += watts;
    totalWeightKg += weightKg;
    if (d.priceUsd != null) {
      totalPriceUsd += d.priceUsd;
      pricedCount++;
    }

    let line = byKey.get(key);
    if (!line) {
      line = { key, vendor, model, type, qty: 0, watts: 0, weightKg: 0 };
      byKey.set(key, line);
    }
    line.qty += 1;
    line.watts += watts;
    line.weightKg += weightKg;
    if (d.priceUsd != null) line.priceUsd = (line.priceUsd ?? 0) + d.priceUsd;
    else line.priceUsd = undefined; // any unpriced unit makes the line price incomplete
  }

  const lines = [...byKey.values()].sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      a.vendor.localeCompare(b.vendor) ||
      a.model.localeCompare(b.model),
  );

  return {
    lines,
    totalDevices: devices.length,
    totalWatts,
    totalWeightKg,
    totalPriceUsd,
    pricedCount,
  };
}

/** Human-friendly model name for a BOM line (falls back to the type's default name). */
export function bomLineName(line: BomLine): string {
  const vm = [line.vendor, line.model].filter(Boolean).join(' ');
  return vm || defaultDeviceName(line.type);
}

/** RFC-4180 + injection-guarded CSV of the bill of materials. */
export function bomCsv(devices: Device[]): string {
  const bom = buildBom(devices);
  const headers = ['qty', 'vendor', 'model', 'type', 'watts', 'weight_kg', 'price_usd'];
  const lines = [headers.map(csvCell).join(',')];
  for (const l of bom.lines) {
    lines.push(
      [
        String(l.qty),
        l.vendor,
        l.model,
        defaultDeviceName(l.type),
        String(l.watts),
        String(l.weightKg),
        l.priceUsd != null ? l.priceUsd.toFixed(2) : '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // Totals row.
  lines.push(
    [
      String(bom.totalDevices),
      'TOTAL',
      '',
      '',
      String(bom.totalWatts),
      String(bom.totalWeightKg),
      bom.pricedCount > 0 ? bom.totalPriceUsd.toFixed(2) : '',
    ]
      .map(csvCell)
      .join(','),
  );
  return lines.join('\r\n');
}
