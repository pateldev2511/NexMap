/**
 * Pure rack-elevation SVG builder for EXPORT (schema v3).
 *
 * Eng-review A2: this is the export-side renderer. It emits LITERAL hex colors and
 * integer width/height (no CSS var(), no foreignObject, no CSS classes) so the string
 * rasterizes correctly out of document context via the existing rasterize()/
 * buildPdfBlob(). The live editor shares only the LAYOUT math (rackLayout.ts), never
 * this markup. Every user string is run through escapeXml.
 */
import type { Device, Location, Rack, RackCable, TextObject } from '@/model/types';
import { portPath } from '@/model/location';
import { escapeXml } from '@/io/export/buildSvg';
import { calloutRowsOrPlaceholder, rowAnchor } from '@/model/callout';
import { DEFAULT_LEADER, leaderDashArray, leaderGeometry, type LeaderRect } from '@/model/leader';
import {
  bayOrigin,
  rowLayout,
  deviceRect,
  uLabelCenterY,
  BAY_W,
  U_PX,
  type Rect,
  type RackPlacement,
} from './rackLayout';
import { isFullDepth, slotOf, orderRacks } from './rackModel';
import { deviceFaceParts, deviceOppositeFaceParts, devicePortLayout, rackShellParts, RACK_ART_DEFS } from './rackDeviceArt';
import { cablePath } from './cablePath';

/** Literal-hex export palette for labels, tables, and U numbers. */
const C = {
  uNum: '#0e7490',
  title: '#15212e',
} as const;

// Device front-panel art now lives in the shared rackDeviceArt.ts (Studio Realism), used
// identically by the live editor, the multi-rack canvas, and this export renderer.

/** Center point of a cabled port in ABSOLUTE row coords (offsetX shifts the cabinet). */
function portCenter(rack: Rack, device: Device, ifaceId: string, offsetX = 0): { x: number; y: number } | null {
  const panel = deviceRect(rack, device);
  const origin = bayOrigin(offsetX);
  const layout = devicePortLayout(device, { x: origin.x + panel.x, y: origin.y + panel.y, w: panel.w, h: panel.h });
  const p = layout.find((l) => l.ifaceId === ifaceId);
  if (!p) return null;
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
}

export interface BuildRackSvgOptions {
  /** Solid background color, or null/undefined for transparent. */
  background?: string | null;
  /** Which mounting face to render. Default 'front'. */
  side?: 'front' | 'rear';
  /**
   * Also draw opposite-face gear so the hidden side still reads as occupying its U.
   * Full-depth devices render as real rear hardware; shallow devices stay as muted hints.
   */
  ghostOpposite?: boolean;
  /** Draw only full-depth backs from the opposite face; used when both front/rear are shown. */
  showFullDepthBacks?: boolean;
  /** Rack-scoped callouts (objects with rackScope) to draw beside their rack. */
  callouts?: TextObject[];
}

/**
 * One rack-scoped callout → SVG (box + shared calloutRows text + leader). Mirrors
 * the live RackCalloutLayer so the elevation export matches the editor. `boxX` is
 * the callout's scene x (already includes the rack's row offset).
 */
function calloutSvgParts(o: TextObject, boxX: number, target: LeaderRect | null): string[] {
  const out: string[] = [];
  const style = o.leader ?? DEFAULT_LEADER;
  if (target) {
    const g = leaderGeometry({ x: boxX, y: o.y, width: o.width, height: o.height }, target);
    if (g) {
      const dash = leaderDashArray(style);
      out.push(
        `<line data-leader-for="${escapeXml(o.id)}" x1="${g.x1.toFixed(1)}" y1="${g.y1.toFixed(1)}" x2="${g.x2.toFixed(1)}" y2="${g.y2.toFixed(1)}" ` +
          `stroke="${escapeXml(style.color)}" stroke-width="${style.width}" fill="none" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
      );
    }
  }
  out.push(
    `<rect data-callout-id="${escapeXml(o.id)}" x="${boxX.toFixed(1)}" y="${o.y.toFixed(1)}" width="${o.width}" height="${o.height}" rx="4" fill="#ffffff" fill-opacity="0.94" stroke="#cbd5e1" stroke-width="1"/>`,
  );
  const fs = o.fontSize ?? 13;
  let y = o.y;
  for (const r of calloutRowsOrPlaceholder(o.blocks, fs)) {
    y += r.size * 1.25;
    const a = rowAnchor(r.align, boxX, o.width, 6);
    const fill = r.muted ? '#64748b' : escapeXml(o.color ?? '#1c2733');
    const fam = r.mono ? ' font-family="monospace"' : '';
    const inner = r.runs
      .map((run) => {
        const w = run.bold ? ' font-weight="700"' : '';
        const st = run.italic ? ' font-style="italic"' : '';
        const rf = run.mono ? ' font-family="monospace"' : '';
        return w || st || rf
          ? `<tspan${w}${st}${rf}>${escapeXml(run.text)}</tspan>`
          : escapeXml(run.text);
      })
      .join('');
    out.push(
      `<text x="${a.x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${a.anchor}" font-size="${r.size}" font-weight="${r.weight}" fill="${fill}"${fam}>${inner}</text>`,
    );
  }
  return out;
}

/** Render one cabinet (frame, bay, U labels, on-face devices) at its row offset. */
function renderCabinet(
  placement: RackPlacement,
  mounted: Device[],
  face: 'front' | 'rear',
  ghostOpposite = false,
  showFullDepthBacks = false,
): string[] {
  const { rack, offsetX, size } = placement;
  const origin = bayOrigin(offsetX);
  const left = offsetX;
  const { height } = size;
  const parts: string[] = [];

  const bayH = rack.ruHeight * U_PX;
  parts.push(...rackShellParts({
    rackName: rack.name,
    ruHeight: rack.ruHeight,
    face,
    x: left,
    y: 0,
    width: size.width,
    height,
    bayX: origin.x,
    bayY: origin.y,
    bayW: BAY_W,
    bayH,
    title: true,
  }));

  // U-number gutter (top→bottom labels, U1 at the bottom)
  for (let u = 1; u <= rack.ruHeight; u++) {
    const y = origin.y + uLabelCenterY(rack, u) + 3;
    parts.push(
      `<text x="${(origin.x - 23).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="9" fill="${C.uNum}">${u}</text>`,
    );
  }

  // Opposite-face context first (behind), so the U doesn't read as empty. When both faces
  // are exported, only full-depth devices span into the opposite aisle.
  if (ghostOpposite || showFullDepthBacks) {
    for (const d of mounted) {
      if (d.rackId !== rack.id || d.ru == null) continue;
      const s = slotOf(d);
      if (s.side === face || s.mount === 'rail') continue;
      if (!ghostOpposite && !isFullDepth(d.type)) continue;
      const r = deviceRect(rack, d);
      const panel: Rect = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
      parts.push(...deviceOppositeFaceParts(d, panel, face));
    }
  }
  // devices on the requested face — realistic art from the shared generator
  for (const d of mounted) {
    if (d.rackId !== rack.id || d.ru == null) continue;
    if (slotOf(d).side !== face) continue;
    const r = deviceRect(rack, d);
    const panel: Rect = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
    parts.push(...deviceFaceParts(d, panel, face, rack.hideFaceplateText));
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

  const ghostOpposite = opts.ghostOpposite ?? false;
  const parts: string[] = [RACK_ART_DEFS];
  if (opts.background) parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(opts.background)}"/>`);
  const showFullDepthBacks = opts.showFullDepthBacks ?? false;
  for (const p of placements) parts.push(...renderCabinet(p, devices, face, ghostOpposite, showFullDepthBacks));

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
      const { d, control } = cablePath(pa, pb, i, crossRack);
      parts.push(`<path d="${d}" fill="none" stroke="#020617" stroke-width="7" stroke-linecap="round" opacity="0.22" filter="url(#rkCableShadow)"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="#f8fafc" stroke-width="5.2" stroke-linecap="round" opacity="0.82"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-width="0.8" stroke-linecap="round" opacity="0.45"/>`);
      if (c.label) {
        parts.push(`<rect x="${(control.x - 28).toFixed(1)}" y="${(control.y - 13).toFixed(1)}" width="56" height="18" rx="5" fill="#ffffff" stroke="#bfdbfe" stroke-width="1"/>`);
        parts.push(`<text x="${control.x.toFixed(1)}" y="${(control.y - 1).toFixed(1)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="8.5" font-weight="700" fill="#2563eb">${escapeXml(c.label)}</text>`);
      }
    }
    for (const p of [pa, pb]) {
      if (p) {
        parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.8" fill="#0f172a" stroke="#f8fafc" stroke-width="1"/>`);
        parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="${color}"/>`);
      }
    }
  });

  // Rack-scoped callouts (+ leaders), drawn beside their cabinet. Export bounds
  // MUST grow to include the callout column or a margin note would be clipped out.
  let outW = width;
  let outH = height;
  const callouts = opts.callouts ?? [];
  if (callouts.length > 0) {
    const placeById = new Map(placements.map((p) => [p.rack.id, p]));
    for (const o of callouts) {
      const p = o.rackScope ? placeById.get(o.rackScope) : undefined;
      if (!p) continue;
      const boxX = o.x + p.offsetX;
      let target: LeaderRect | null = null;
      if (o.anchor?.type === 'device') {
        const d = devOf.get(o.anchor.id);
        if (d && d.rackId === p.rack.id && slotOf(d).side === face) {
          const r = deviceRect(p.rack, d);
          const origin = bayOrigin(p.offsetX);
          target = { x: origin.x + r.x, y: origin.y + r.y, width: r.w, height: r.h };
        }
      } else if (o.anchor?.type === 'point') {
        target = { x: o.anchor.x + p.offsetX, y: o.anchor.y, width: 0, height: 0 };
      }
      parts.push(...calloutSvgParts(o, boxX, target));
      outW = Math.max(outW, boxX + o.width + 8);
      outH = Math.max(outH, o.y + o.height + 8);
    }
  }

  const w = Math.round(outW);
  const h = Math.round(outH);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    parts.join('') +
    `</svg>`
  );
}

/**
 * Printable label sheet (schema v3): one cut-out label per mounted device with its name,
 * rack + U position, and model — the physical-install handoff. Pure, literal-hex, escaped
 * text, integer dims; rasterizes/PDFs through the same pipeline as the elevation. Rail gear
 * (PDUs) is included since it still needs a label.
 */
export function buildLabelSheetSvg(
  racks: Rack[],
  devices: Device[],
  opts: { background?: string | null } = {},
): string {
  const cols = 3;
  const cw = 230, ch = 48, padX = 16, padY = 16, gap = 10, headH = 26;
  const cells: { rack: string; name: string; sub: string; model: string }[] = [];
  for (const rack of orderRacks(racks)) {
    const inRack = devices
      .filter((d) => d.rackId === rack.id && d.ru != null)
      .sort((a, b) => (b.ru ?? 0) - (a.ru ?? 0));
    for (const d of inRack) {
      const s = slotOf(d);
      const top = (d.ru ?? 0) + (s.ruSpan - 1);
      const uLabel = s.ruSpan > 1 ? `U${d.ru}–U${top}` : `U${d.ru}`;
      cells.push({
        rack: rack.name,
        name: d.name,
        sub: `${rack.name} · ${uLabel} · ${s.side}`,
        model: [d.vendor, d.model].filter(Boolean).join(' '),
      });
    }
  }

  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const width = padX * 2 + cols * cw + (cols - 1) * gap;
  const height = padY * 2 + headH + rows * (ch + gap);
  const parts: string[] = [];
  if (opts.background) parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(opts.background)}"/>`);
  parts.push(`<text x="${padX}" y="${padY + 14}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="15" font-weight="700" fill="${C.title}">Rack labels · ${cells.length}</text>`);
  if (cells.length === 0) {
    parts.push(`<text x="${padX}" y="${padY + headH + 16}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" fill="${C.uNum}">No mounted devices.</text>`);
  }
  cells.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = padX + col * (cw + gap);
    const y = padY + headH + row * (ch + gap);
    parts.push(`<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="4" fill="#ffffff" stroke="#c4ccd6" stroke-width="1"/>`);
    parts.push(`<rect x="${x}" y="${y}" width="4" height="${ch}" fill="#0e7490"/>`);
    parts.push(`<text x="${x + 12}" y="${y + 19}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="700" fill="#15212e">${escapeXml(c.name)}</text>`);
    parts.push(`<text x="${x + 12}" y="${y + 34}" font-family="ui-monospace,Menlo,monospace" font-size="10" fill="#5b6573">${escapeXml(c.sub)}</text>`);
    if (c.model) parts.push(`<text x="${x + 12}" y="${y + 45}" font-family="ui-monospace,Menlo,monospace" font-size="9" fill="#8a93a0">${escapeXml(c.model)}</text>`);
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
  // A single focused rack shows one face → ghost the opposite side (matches the editor).
  return buildRackRowSvg([rack], devices, cables, { ghostOpposite: true, ...opts });
}

export interface CableScheduleRow {
  color: string;
  label: string;
  from: string;
  to: string;
  /**
   * Fully-qualified endpoint paths, e.g. "HQ/28/RK001/SW01/Gi1/0/13" (schema v5).
   * Empty when no location tree exists. Kept SEPARATE from `from`/`to` on purpose:
   * the exported SVG table has fixed column widths tuned for "SW01:Gi1/0/13", and a
   * full path would overflow it. The CSV — which an installer actually works from —
   * gets both.
   */
  fromPath: string;
  toPath: string;
  lengthFt: string;
  /** Port VLAN(s): a single id when both ends agree, "a/b" when they differ, "" when unset. */
  vlan: string;
}

/**
 * Derive the installer-facing patch list from drawn cables (E3).
 *
 * `locations`/`racks` are optional: supply them and each row also carries the
 * fully-qualified endpoint path shown by the port inspector, so a printed schedule
 * and the on-screen trace agree. Omit them and the output is exactly as before.
 */
export function cableScheduleRows(
  devices: Device[],
  cables: RackCable[],
  locations: Location[] = [],
  racks: Rack[] = [],
): CableScheduleRow[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const ifaceOf = (deviceId: string, ifaceId: string) =>
    byId.get(deviceId)?.interfaces?.find((i) => i.id === ifaceId);
  const endLabel = (deviceId: string, ifaceId: string): string => {
    const dev = byId.get(deviceId);
    const portName = ifaceOf(deviceId, ifaceId)?.name ?? ifaceId;
    return `${dev?.name ?? deviceId}:${portName}`;
  };
  const vlanCol = (c: RackCable): string => {
    const va = ifaceOf(c.aEnd.deviceId, c.aEnd.ifaceId)?.vlan;
    const vb = ifaceOf(c.bEnd.deviceId, c.bEnd.ifaceId)?.vlan;
    if (va == null && vb == null) return '';
    if (va != null && vb != null) return va === vb ? String(va) : `${va}/${vb}`;
    return String(va ?? vb);
  };
  const qualified = (deviceId: string, ifaceId: string): string =>
    locations.length > 0 ? portPath(locations, racks, devices, deviceId, ifaceId) : '';
  return cables.map((c) => ({
    color: c.color,
    label: c.label ?? '',
    from: endLabel(c.aEnd.deviceId, c.aEnd.ifaceId),
    to: endLabel(c.bEnd.deviceId, c.bEnd.ifaceId),
    fromPath: qualified(c.aEnd.deviceId, c.aEnd.ifaceId),
    toPath: qualified(c.bEnd.deviceId, c.bEnd.ifaceId),
    lengthFt: c.lengthFt != null ? String(c.lengthFt) : '',
    vlan: vlanCol(c),
  }));
}

/**
 * CSV patch list. Reuses the simple quoting convention of the existing CSV exports.
 *
 * The qualified-path columns are only emitted when a location tree exists, so a
 * project without locations produces the identical CSV it always did.
 */
export function cableScheduleCsv(
  devices: Device[],
  cables: RackCable[],
  locations: Location[] = [],
  racks: Rack[] = [],
): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = cableScheduleRows(devices, cables, locations, racks);
  const withPaths = rows.some((r) => r.fromPath !== '' || r.toPath !== '');
  const header = withPaths
    ? ['Color', 'Label', 'From', 'To', 'From path', 'To path', 'VLAN', 'Length (ft)']
    : ['Color', 'Label', 'From', 'To', 'VLAN', 'Length (ft)'];
  const body = rows.map((r) =>
    (withPaths
      ? [q(r.color), q(r.label), q(r.from), q(r.to), q(r.fromPath), q(r.toPath), q(r.vlan), q(r.lengthFt)]
      : [q(r.color), q(r.label), q(r.from), q(r.to), q(r.vlan), q(r.lengthFt)]
    ).join(','),
  );
  return [header.join(','), ...body].join('\n');
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
// [swatch, From, To, Label, VLAN, Length] — fixed widths keep the literal-hex SVG simple.
const TBL_COLS: { key: 'color' | 'from' | 'to' | 'label' | 'vlan' | 'lengthFt'; label: string; w: number }[] = [
  { key: 'color', label: '', w: 30 },
  { key: 'from', label: 'From', w: 180 },
  { key: 'to', label: 'To', w: 180 },
  { key: 'label', label: 'Label', w: 130 },
  { key: 'vlan', label: 'VLAN', w: 60 },
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
  opts: { showRear: boolean; background?: string | null; callouts?: TextObject[] },
): string {
  // Rear hidden → hint all rear gear on the front row. Rear shown → draw full-depth backs
  // on both rows so the rear aisle reads like physical hardware, without duplicating shallow gear.
  const front = buildRackRowSvg(racks, devices, cables, {
    background: opts.background,
    side: 'front',
    ghostOpposite: !opts.showRear,
    showFullDepthBacks: opts.showRear,
    callouts: opts.callouts, // callouts anchor to front-face devices
  });
  if (!opts.showRear) return front;
  const rear = buildRackRowSvg(racks, devices, cables, { background: opts.background, side: 'rear', showFullDepthBacks: true });
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
