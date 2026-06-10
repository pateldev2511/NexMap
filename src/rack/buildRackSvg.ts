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
  cabinetSize,
  bayOrigin,
  deviceRect,
  uLabelCenterY,
  portLayout,
  BAY_W,
  RAIL_PX,
  GUTTER_PX,
  FRAME_PAD,
  U_PX,
  type Rect,
} from './rackLayout';
import { panelKindFor } from './panelKind';
import { slotOf } from './rackModel';

/** Literal-hex export palette (B+ console, light-on-print). */
const C = {
  frame: '#ffffff',
  frameBd: '#b9c4d0',
  screw: '#cdd6e0',
  rail: '#c4ccd6',
  railHole: '#9aa6b2',
  uNum: '#0e7490',
  bayBg: '#eef2f7',
  chassis: '#2b323b',
  chassisBd: '#10131b',
  text: '#eef2f7',
  textMut: '#9aa6b2',
  jack: '#0a1018',
  jackBd: '#46525f',
  led: '#34d399',
  drive: '#3a424c',
  title: '#15212e',
} as const;

function rect(r: Rect, fill: string, extra = ''): string {
  return `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="${fill}" ${extra}/>`;
}

/** Draw the front-panel contents of one device (panel-local svg, already translated). */
function devicePanel(device: Device, panel: Rect): string {
  const parts: string[] = [];
  // chassis
  parts.push(
    `<rect x="${panel.x.toFixed(1)}" y="${panel.y.toFixed(1)}" width="${panel.w.toFixed(1)}" height="${panel.h.toFixed(1)}" rx="3" fill="${C.chassis}" stroke="${C.chassisBd}" stroke-width="1"/>`,
  );
  // brand label
  const name = escapeXml(device.name);
  parts.push(
    `<text x="${(panel.x + 8).toFixed(1)}" y="${(panel.y + panel.h / 2 + 4).toFixed(1)}" font-family="ui-monospace,Menlo,monospace" font-size="11" fill="${C.text}">${name}</text>`,
  );

  const kind = panelKindFor(device.type);
  const ports = (device.interfaces ?? []).map((i) => ({ id: i.id, name: i.name }));

  if (kind === 'switch' || kind === 'patch' || kind === 'firewall') {
    const jacks = portLayout(panel, ports);
    for (const j of jacks) {
      parts.push(rect({ x: j.x, y: j.y, w: j.w, h: j.h }, C.jack, `rx="1.5" stroke="${C.jackBd}" stroke-width="0.75"`));
    }
    // status LED
    parts.push(`<circle cx="${(panel.x + panel.w - 6).toFixed(1)}" cy="${(panel.y + 6).toFixed(1)}" r="2.5" fill="${C.led}"/>`);
  } else if (kind === 'server') {
    // drive-bay array on the right
    const bays = 6;
    const bw = 12;
    const gap = 4;
    const totalW = bays * bw + (bays - 1) * gap;
    const startX = panel.x + panel.w - 10 - totalW;
    for (let i = 0; i < bays; i++) {
      parts.push(
        rect({ x: startX + i * (bw + gap), y: panel.y + 5, w: bw, h: panel.h - 10 }, C.drive, `rx="1.5" stroke="${C.chassisBd}" stroke-width="0.75"`),
      );
    }
    parts.push(`<circle cx="${(panel.x + panel.w - 4).toFixed(1)}" cy="${(panel.y + 6).toFixed(1)}" r="2.5" fill="${C.led}"/>`);
  } else if (kind === 'psu') {
    // two fan grilles
    const r = Math.min(panel.h - 8, 22) / 2;
    const cy = panel.y + panel.h / 2;
    for (let i = 0; i < 2; i++) {
      const cx = panel.x + panel.w - 16 - i * (r * 2 + 6);
      parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${C.jack}" stroke="${C.jackBd}" stroke-width="1"/>`);
    }
  }
  return parts.join('');
}

/** Center point of a cabled port in CABINET coords, or null if not locatable. */
function portCenter(rack: Rack, device: Device, ifaceId: string): { x: number; y: number } | null {
  const ports = (device.interfaces ?? []).map((i) => ({ id: i.id, name: i.name }));
  const panel = deviceRect(rack, device);
  const origin = bayOrigin();
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

/**
 * Build a complete rack-elevation SVG string for one rack. Pure + total — devices not
 * mounted in this rack are ignored; cables with both endpoints in this rack on the
 * front are drawn as straight color-coded lines (v1), others as a colored port stub.
 */
export function buildRackSvg(
  rack: Rack,
  devices: Device[],
  cables: RackCable[],
  opts: BuildRackSvgOptions = {},
): string {
  const face = opts.side ?? 'front';
  const { width, height } = cabinetSize(rack);
  const origin = bayOrigin();
  const mounted = devices.filter((d) => d.rackId === rack.id && d.ru != null);
  const byId = new Map(mounted.map((d) => [d.id, d]));

  const parts: string[] = [];
  if (opts.background) parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(opts.background)}"/>`);

  // cabinet frame + corner screws + title
  parts.push(`<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="12" fill="${C.frame}" stroke="${C.frameBd}" stroke-width="2"/>`);
  for (const [cx, cy] of [
    [8, 8],
    [width - 8, 8],
    [8, height - 8],
    [width - 8, height - 8],
  ]) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${C.screw}" stroke="${C.railHole}" stroke-width="1"/>`);
  }
  parts.push(
    `<text x="${FRAME_PAD + GUTTER_PX}" y="${FRAME_PAD - 2}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="700" fill="${C.title}">${escapeXml(rack.name)} · ${rack.ruHeight}U · ${face}</text>`,
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
      `<text x="${FRAME_PAD + GUTTER_PX - 6}" y="${y.toFixed(1)}" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="9" fill="${C.uNum}">${u}</text>`,
    );
  }

  // devices on the requested face
  for (const d of mounted) {
    if (slotOf(d).side !== face) continue;
    const r = deviceRect(rack, d);
    const panel: Rect = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
    parts.push(devicePanel(d, panel));
  }

  // cables: bowed, color-coded curves with a white halo for readability (parallels fan
  // apart by index, matching the live editor). Endpoints on the other face are stubbed.
  cables.forEach((c, i) => {
    const a = byId.get(c.aEnd.deviceId);
    const b = byId.get(c.bEnd.deviceId);
    const pa = a && slotOf(a).side === face ? portCenter(rack, a, c.aEnd.ifaceId) : null;
    const pb = b && slotOf(b).side === face ? portCenter(rack, b, c.bEnd.ifaceId) : null;
    const color = escapeXml(c.color);
    if (pa && pb) {
      const bow = ((i % 6) - 2.5) * 18;
      const mx = (pa.x + pb.x) / 2 + bow;
      const my = (pa.y + pb.y) / 2;
      const d = `M ${pa.x.toFixed(1)} ${pa.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`;
      parts.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.9"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`);
    }
    for (const p of [pa, pb]) {
      if (p) parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}" stroke="#ffffff" stroke-width="1"/>`);
    }
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    parts.join('') +
    `</svg>`
  );
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
