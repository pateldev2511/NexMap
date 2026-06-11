/**
 * Pure rack-elevation SVG builder for EXPORT (schema v3).
 *
 * Eng-review A2: this is the export-side renderer. It emits LITERAL hex colors and
 * integer width/height (no CSS var(), no foreignObject, no CSS classes) so the string
 * rasterizes correctly out of document context via the existing rasterize()/
 * buildPdfBlob(). The live editor shares only the LAYOUT math (rackLayout.ts), never
 * this markup. Every user string is run through escapeXml.
 */
import type { Device, Rack, RackCable } from '@/model/types';
import { escapeXml } from '@/io/export/buildSvg';
import {
  bayOrigin,
  rowLayout,
  deviceRect,
  uLabelCenterY,
  portLayout,
  BAY_W,
  RAIL_PX,
  FRAME_PAD,
  U_PX,
  type Rect,
  type RackPlacement,
} from './rackLayout';
import { slotOf } from './rackModel';
import { deviceFaceParts, RACK_ART_DEFS } from './rackDeviceArt';

/** Literal-hex CABINET-CHROME palette (device colors now live in rackDeviceArt.ts). */
const C = {
  frame: '#ffffff',
  frameBd: '#b9c4d0',
  screw: '#cdd6e0',
  rail: '#c4ccd6',
  railHole: '#9aa6b2',
  uNum: '#0e7490',
  bayBg: '#eef2f7',
  title: '#15212e',
} as const;

function rect(r: Rect, fill: string, extra = ''): string {
  return `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="${fill}" ${extra}/>`;
}

// Device front-panel art now lives in the shared rackDeviceArt.ts (Studio Realism), used
// identically by the live editor, the multi-rack canvas, and this export renderer.

/** Center point of a cabled port in ABSOLUTE row coords (offsetX shifts the cabinet). */
function portCenter(rack: Rack, device: Device, ifaceId: string, offsetX = 0): { x: number; y: number } | null {
  const ports = (device.interfaces ?? []).map((i) => ({ id: i.id, name: i.name }));
  const panel = deviceRect(rack, device);
  const origin = bayOrigin(offsetX);
  const layout = portLayout(panel, ports);
  const p = layout.find((l) => l.ifaceId === ifaceId);
  if (!p) return null;
  return { x: origin.x + p.x + p.w / 2, y: origin.y + p.y + p.h / 2 };
}

export interface BuildRackSvgOptions {
  /** Solid background color, or null/undefined for transparent. */
  background?: string | null;
  /** Which mounting face to render. Default 'front'. */
  side?: 'front' | 'rear';
}

/** Render one cabinet (frame, bay, U labels, on-face devices) at its row offset. */
function renderCabinet(placement: RackPlacement, mounted: Device[], face: 'front' | 'rear'): string[] {
  const { rack, offsetX, size } = placement;
  const origin = bayOrigin(offsetX);
  const left = offsetX;
  const right = offsetX + size.width;
  const { height } = size;
  const parts: string[] = [];

  // cabinet frame + corner screws + title
  parts.push(`<rect x="${left + 1}" y="1" width="${size.width - 2}" height="${height - 2}" rx="12" fill="${C.frame}" stroke="${C.frameBd}" stroke-width="2"/>`);
  for (const [cx, cy] of [
    [left + 8, 8],
    [right - 8, 8],
    [left + 8, height - 8],
    [right - 8, height - 8],
  ]) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${C.screw}" stroke="${C.railHole}" stroke-width="1"/>`);
  }
  parts.push(
    `<text x="${origin.x}" y="${FRAME_PAD - 2}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="700" fill="${C.title}">${escapeXml(rack.name)} · ${rack.ruHeight}U · ${face}</text>`,
  );

  // bay background + mounting rails
  const bayH = rack.ruHeight * U_PX;
  parts.push(rect({ x: origin.x, y: origin.y, w: BAY_W, h: bayH }, C.bayBg, `rx="4"`));
  for (const railX of [origin.x + 1, origin.x + BAY_W - RAIL_PX - 1]) {
    parts.push(rect({ x: railX, y: origin.y + 4, w: RAIL_PX, h: bayH - 8 }, C.rail, `rx="2"`));
  }

  // U-number gutter (top→bottom labels, U1 at the bottom)
  for (let u = 1; u <= rack.ruHeight; u++) {
    const y = origin.y + uLabelCenterY(rack, u) + 3;
    parts.push(
      `<text x="${(origin.x - 6).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="9" fill="${C.uNum}">${u}</text>`,
    );
  }

  // devices on the requested face — realistic art from the shared generator
  for (const d of mounted) {
    if (d.rackId !== rack.id || d.ru == null) continue;
    if (slotOf(d).side !== face) continue;
    const r = deviceRect(rack, d);
    const panel: Rect = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
    parts.push(...deviceFaceParts(d, panel));
  }
  return parts;
}

/**
 * Build a rack-elevation SVG for a ROW of racks (one or many). Pure + total. Cabinets are
 * laid left-to-right (`rowLayout`); cables — intra- OR cross-rack — are drawn in one global
 * pass as bowed, haloed, color-coded curves. Endpoints on the other face are stubbed.
 * Cross-rack runs arc up and over the gap so they read as leaving the cabinet.
 */
export function buildRackRowSvg(
  racks: Rack[],
  devices: Device[],
  cables: RackCable[],
  opts: BuildRackSvgOptions = {},
): string {
  const face = opts.side ?? 'front';
  const { placements, width, height } = rowLayout(racks);
  // deviceId → {device, placement} for every mounted device across all racks.
  const placeOf = new Map<string, RackPlacement>();
  const devOf = new Map<string, Device>();
  for (const p of placements) {
    for (const d of devices) {
      if (d.rackId === p.rack.id && d.ru != null) {
        placeOf.set(d.id, p);
        devOf.set(d.id, d);
      }
    }
  }

  const parts: string[] = [RACK_ART_DEFS];
  if (opts.background) parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(opts.background)}"/>`);
  for (const p of placements) parts.push(...renderCabinet(p, devices, face));

  // cables (global pass — both endpoints resolved with their own cabinet offset)
  const endPoint = (deviceId: string, ifaceId: string): { x: number; y: number } | null => {
    const d = devOf.get(deviceId);
    const p = placeOf.get(deviceId);
    if (!d || !p || slotOf(d).side !== face) return null;
    return portCenter(p.rack, d, ifaceId, p.offsetX);
  };
  cables.forEach((c, i) => {
    const pa = endPoint(c.aEnd.deviceId, c.aEnd.ifaceId);
    const pb = endPoint(c.bEnd.deviceId, c.bEnd.ifaceId);
    const color = escapeXml(c.color);
    if (pa && pb) {
      const crossRack = placeOf.get(c.aEnd.deviceId) !== placeOf.get(c.bEnd.deviceId);
      let d: string;
      if (crossRack) {
        // Arc up and over the gap between cabinets.
        const my = Math.min(pa.y, pb.y) - 40 - (i % 5) * 12;
        const mx = (pa.x + pb.x) / 2;
        d = `M ${pa.x.toFixed(1)} ${pa.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`;
      } else {
        const bow = ((i % 6) - 2.5) * 18;
        const mx = (pa.x + pb.x) / 2 + bow;
        const my = (pa.y + pb.y) / 2;
        d = `M ${pa.x.toFixed(1)} ${pa.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`;
      }
      parts.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.9"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`);
    }
    for (const p of [pa, pb]) {
      if (p) parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}" stroke="#ffffff" stroke-width="1"/>`);
    }
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">` +
    parts.join('') +
    `</svg>`
  );
}

/** Single-rack elevation SVG — thin wrapper over the row builder (back-compat). */
export function buildRackSvg(
  rack: Rack,
  devices: Device[],
  cables: RackCable[],
  opts: BuildRackSvgOptions = {},
): string {
  return buildRackRowSvg([rack], devices, cables, opts);
}

export interface CableScheduleRow {
  color: string;
  label: string;
  from: string;
  to: string;
  lengthFt: string;
}

/** Derive the installer-facing patch list from drawn cables (E3). */
export function cableScheduleRows(devices: Device[], cables: RackCable[]): CableScheduleRow[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const endLabel = (deviceId: string, ifaceId: string): string => {
    const dev = byId.get(deviceId);
    const iface = dev?.interfaces?.find((i) => i.id === ifaceId);
    const devName = dev?.name ?? deviceId;
    const portName = iface?.name ?? ifaceId;
    return `${devName}:${portName}`;
  };
  return cables.map((c) => ({
    color: c.color,
    label: c.label ?? '',
    from: endLabel(c.aEnd.deviceId, c.aEnd.ifaceId),
    to: endLabel(c.bEnd.deviceId, c.bEnd.ifaceId),
    lengthFt: c.lengthFt != null ? String(c.lengthFt) : '',
  }));
}

/** CSV patch list. Reuses the simple quoting convention of the existing CSV exports. */
export function cableScheduleCsv(devices: Device[], cables: RackCable[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = ['Color', 'Label', 'From', 'To', 'Length (ft)'].join(',');
  const rows = cableScheduleRows(devices, cables).map((r) =>
    [q(r.color), q(r.label), q(r.from), q(r.to), q(r.lengthFt)].join(','),
  );
  return [header, ...rows].join('\n');
}

/* ── connection table (export-safe SVG) ──────────────────────────────────────── */

const TBL = {
  pad: 10,
  rowH: 24,
  headH: 28,
  font: 12,
  bg: '#ffffff',
  headerBg: '#15212e',
  headerFg: '#ffffff',
  rowBg: '#ffffff',
  zebra: '#eef2f7',
  border: '#cdd6e0',
  text: '#15212e',
} as const;
// [swatch, From, To, Label, Length] — fixed widths keep the literal-hex SVG simple.
const TBL_COLS: { key: 'color' | 'from' | 'to' | 'label' | 'lengthFt'; label: string; w: number }[] = [
  { key: 'color', label: '', w: 30 },
  { key: 'from', label: 'From', w: 190 },
  { key: 'to', label: 'To', w: 190 },
  { key: 'label', label: 'Label', w: 150 },
  { key: 'lengthFt', label: 'Length (ft)', w: 90 },
];

/**
 * Render the connection schedule as a literal-hex SVG table (header + zebra rows, color
 * swatch per row, escaped text, integer dims). Mirrors buildRackSvg's export-safety rules
 * so it rasterizes out of document context. Empty list still yields a valid header table.
 */
export function buildConnectionsTableSvg(rows: CableScheduleRow[], opts: { background?: string | null; title?: string } = {}): string {
  const innerW = TBL_COLS.reduce((s, c) => s + c.w, 0);
  const width = innerW + TBL.pad * 2;
  const titleH = opts.title ? 26 : 0;
  const height = TBL.pad * 2 + titleH + TBL.headH + rows.length * TBL.rowH;
  const parts: string[] = [];
  if (opts.background) parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(opts.background)}"/>`);
  if (opts.title) {
    parts.push(`<text x="${TBL.pad}" y="${TBL.pad + 16}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="14" font-weight="700" fill="${TBL.text}">${escapeXml(opts.title)}</text>`);
  }
  const x0 = TBL.pad;
  let y = TBL.pad + titleH;

  // header
  parts.push(`<rect x="${x0}" y="${y}" width="${innerW}" height="${TBL.headH}" fill="${TBL.headerBg}"/>`);
  let cx = x0;
  for (const col of TBL_COLS) {
    if (col.label) {
      parts.push(`<text x="${cx + 6}" y="${y + TBL.headH / 2 + 4}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${TBL.font}" font-weight="700" fill="${TBL.headerFg}">${escapeXml(col.label)}</text>`);
    }
    cx += col.w;
  }
  y += TBL.headH;

  // rows
  rows.forEach((r, i) => {
    if (i % 2 === 1) parts.push(`<rect x="${x0}" y="${y}" width="${innerW}" height="${TBL.rowH}" fill="${TBL.zebra}"/>`);
    let colX = x0;
    for (const col of TBL_COLS) {
      if (col.key === 'color') {
        parts.push(`<rect x="${colX + 7}" y="${y + TBL.rowH / 2 - 6}" width="14" height="12" rx="2" fill="${escapeXml(r.color)}" stroke="${TBL.border}" stroke-width="1"/>`);
      } else {
        const val = String(r[col.key] ?? '');
        if (val) parts.push(`<text x="${colX + 6}" y="${y + TBL.rowH / 2 + 4}" font-family="ui-monospace,Menlo,monospace" font-size="${TBL.font}" fill="${TBL.text}">${escapeXml(val)}</text>`);
      }
      colX += col.w;
    }
    parts.push(`<line x1="${x0}" y1="${y + TBL.rowH}" x2="${x0 + innerW}" y2="${y + TBL.rowH}" stroke="${TBL.border}" stroke-width="0.5"/>`);
    y += TBL.rowH;
  });
  // outer border
  parts.push(`<rect x="${x0}" y="${TBL.pad + titleH}" width="${innerW}" height="${TBL.headH + rows.length * TBL.rowH}" fill="none" stroke="${TBL.border}" stroke-width="1"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

export type ExportMode = 'diagram' | 'diagram+table' | 'table-only';

function svgDims(svg: string): { w: number; h: number } {
  const m = svg.match(/width="(\d+)" height="(\d+)"/);
  return { w: m ? Number(m[1]) : 0, h: m ? Number(m[2]) : 0 };
}

/** Stack two rack-row SVGs vertically into one. De-dupes the shared art `<defs>` so the
 *  composed document has exactly one (ids must be unique per SVG document). */
function vstackSvg(top: string, bottom: string, background?: string | null, gap = 28): string {
  const a = svgDims(top);
  const b = svgDims(bottom);
  const width = Math.max(a.w, b.w);
  const height = a.h + gap + b.h;
  const strip = (s: string) => s.replace(RACK_ART_DEFS, '');
  const bg = background ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(background)}"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    RACK_ART_DEFS + bg +
    `<g>${strip(top)}</g>` +
    `<g transform="translate(0,${a.h + gap})">${strip(bottom)}</g>` +
    `</svg>`
  );
}

/**
 * Multi-rack elevation for export honoring the canvas's face setting. `showRear` stacks the
 * front row above the rear row (one de-duped `<defs>`); otherwise front only. Pure +
 * testable, so the both-faces composition isn't trapped in a component closure.
 */
export function buildRackRowFacesSvg(
  racks: Rack[],
  devices: Device[],
  cables: RackCable[],
  opts: { showRear: boolean; background?: string | null },
): string {
  const front = buildRackRowSvg(racks, devices, cables, { background: opts.background, side: 'front' });
  if (!opts.showRear) return front;
  const rear = buildRackRowSvg(racks, devices, cables, { background: opts.background, side: 'rear' });
  return vstackSvg(front, rear, opts.background);
}

/**
 * Compose the rack diagram and the connection table per the chosen export mode. For
 * 'diagram+table' the table is stacked below the diagram in one outer SVG (each inner
 * SVG is nested in a translated `<g>`, so they rasterize as one image).
 */
export function composeExport(rackSvg: string, tableSvg: string, mode: ExportMode, background?: string | null): string {
  if (mode === 'diagram') return rackSvg;
  if (mode === 'table-only') return tableSvg;
  const a = svgDims(rackSvg);
  const b = svgDims(tableSvg);
  const gap = 28;
  const width = Math.max(a.w, b.w);
  const height = a.h + gap + b.h;
  const bg = background ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(background)}"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    bg +
    `<g>${rackSvg}</g>` +
    `<g transform="translate(0,${a.h + gap})">${tableSvg}</g>` +
    `</svg>`
  );
}
