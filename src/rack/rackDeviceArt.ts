/**
 * Realistic rack device art — the shared entry point every rack view draws through.
 *
 * One source of truth for how a rack and its gear look, consumed by the live editor
 * (RackCanvas), the multi-rack row (RackRow), the library thumbnails (RackDesigner),
 * and the export (buildRackSvg). Faceplates come from rackFaceArt (unbranded) or a
 * vendor theme over it (rackPhotoSkins); this module owns the cabinet shell, the 0U
 * rail gear (PDU strips, vertical managers), opposite-face ghosts, and the lifecycle
 * overlay. It emits LITERAL-HEX SVG strings (real gear is black/grey regardless of
 * app theme); gradients DO rasterize, so the metal, glass and LED glow survive PNG/PDF.
 *
 * Every consumer includes RACK_ART_DEFS once at its SVG root; the gradient ids are
 * shared (not per-device), so there are no id collisions.
 */
import type { Device } from '@/model/types';
import { escapeXml } from '@/io/export/buildSvg';
import type { Rect } from './rackLayout';
import { isCableManager } from './panelKind';
import { isFullDepth, slotOf } from './rackModel';
import { rackPhotoSkinParts } from './rackPhotoSkins';
import { defaultTheme, faceStyleFor, frontFaceParts, rearFaceParts } from './rackFaceArt';

export { devicePortLayout, faceStyleFor, type FaceStyle } from './rackFaceArt';

const lin = (id: string, x2: number, y2: number, stops: Array<[number, string, number?]>) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">` +
  stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`).join('') +
  '</linearGradient>';
const rad = (id: string, stops: Array<[number, string]>, cx = 0.5, cy = 0.4, r = 0.6) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">` +
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') +
  '</radialGradient>';

/** Shared gradient defs. Include ONCE per SVG document (root). */
export const RACK_ART_DEFS = [
  '<defs>',
  '<filter id="rkSoftShadow" x="-20%" y="-20%" width="140%" height="145%">',
  '<feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#0f172a" flood-opacity="0.22"/></filter>',
  '<filter id="rkDeviceShadow" x="-8%" y="-35%" width="116%" height="170%">',
  '<feDropShadow dx="0" dy="1.4" stdDeviation="1.2" flood-color="#020617" flood-opacity="0.52"/></filter>',
  '<filter id="rkCableShadow" x="-18%" y="-60%" width="136%" height="220%">',
  '<feDropShadow dx="0" dy="2.2" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.34"/></filter>',
  // Cabinet: powder-coated frame, the dark bay, square-hole rail posts.
  lin('rkRackFrame', 0, 1, [[0, '#2b333d'], [0.06, '#171d24'], [0.94, '#0f1419'], [1, '#232a33']]),
  lin('rkRackSide', 1, 0, [[0, '#0b0f14'], [0.5, '#1a2129'], [1, '#0b0f14']]),
  lin('rkRackBay', 1, 0, [[0, '#06090d'], [0.08, '#11171e'], [0.5, '#0b1015'], [0.92, '#11171e'], [1, '#06090d']]),
  lin('rkRail', 1, 0, [[0, '#2a323c'], [0.3, '#56616e'], [0.55, '#3a444f'], [1, '#1a2028']]),
  // Faceplate finishes.
  lin('rkMetal', 0, 1, [[0, '#4b5562'], [0.08, '#2b333d'], [0.5, '#1d232b'], [0.92, '#151a21'], [1, '#262d36']]),
  lin('rkRear', 0, 1, [[0, '#3a434e'], [0.1, '#232a33'], [1, '#161b22']]),
  lin('rkBrushed', 1, 0, [[0, '#111821'], [0.18, '#3b4653'], [0.5, '#202936'], [0.82, '#465260'], [1, '#141b24']]),
  lin('rkSilver', 0, 1, [[0, '#e9edf1'], [0.1, '#c3cbd4'], [0.55, '#a9b3be'], [1, '#8b95a1']]),
  lin('rkWhite', 0, 1, [[0, '#ffffff'], [0.1, '#eef1f4'], [1, '#c9d0d8']]),
  lin('rkOxblood', 0, 1, [[0, '#5a1820'], [0.1, '#3a0d13'], [1, '#22070b']]),
  lin('rkPatch', 0, 1, [[0, '#3a424d'], [0.1, '#1f252d'], [1, '#14181e']]),
  lin('rkEar', 1, 0, [[0, '#1a2028'], [0.5, '#3a434e'], [1, '#1a2028']]),
  lin('rkSheen', 0, 1, [[0, '#ffffff', 0.2], [0.3, '#ffffff', 0]]),
  // Parts.
  lin('rkJack', 0, 1, [[0, '#e5e9ee'], [0.5, '#a7b1bc'], [1, '#6b7683']]),
  lin('rkCage', 0, 1, [[0, '#d5dbe2'], [1, '#7b8590']]),
  lin('rkHandle', 0, 1, [[0, '#f1f4f7'], [0.45, '#aab3bd'], [1, '#5b6470']]),
  lin('rkCaddy', 0, 1, [[0, '#3b4451'], [1, '#1b2027']]),
  lin('rkModule', 0, 1, [[0, '#2f3742'], [1, '#151a20']]),
  lin('rkPduBody', 1, 0, [[0, '#14191f'], [0.35, '#3a434e'], [0.6, '#262d36'], [1, '#0e1217']]),
  lin('rkLCD', 1, 1, [[0, '#0f766e'], [0.5, '#042f2e'], [1, '#14b8a6']]),
  rad('rkHub', [[0, '#8b95a1'], [1, '#2a323c']], 0.4, 0.35, 0.7),
  rad('rkScrew', [[0, '#e5e9ee'], [0.6, '#8b95a1'], [1, '#3a434e']], 0.38, 0.32, 0.7),
  rad('rkLedG', [[0, '#d1ffe0'], [0.4, '#34d399'], [1, '#0f7a4d']]),
  rad('rkLedA', [[0, '#ffe9a8'], [0.5, '#f59e0b'], [1, '#a25c04']]),
  rad('rkLedB', [[0, '#dbeafe'], [0.45, '#3b82f6'], [1, '#1e3a8a']]),
  rad('rkLedR', [[0, '#fee2e2'], [0.45, '#ef4444'], [1, '#7f1d1d']]),
  '</defs>',
].join('');

const C = {
  text: '#e7edf4',
  cage: '#161c24',
  jackBd: '#566372',
  notch: '#05080c',
  cageBd: '#3a4654',
  // opposite-face "ghost" (back of a chassis seen from the other side)
  ghostFill: '#161b22',
  ghostBd: '#39424f',
  ghostHatch: '#2c343f',
  ghostText: '#6b7787',
} as const;

const n = (v: number) => v.toFixed(1);

export interface RackShellOptions {
  rackName: string;
  ruHeight: number;
  face: 'front' | 'rear';
  x: number;
  y: number;
  width: number;
  height: number;
  bayX: number;
  bayY: number;
  bayW: number;
  bayH: number;
  active?: boolean;
  title?: boolean;
}

/**
 * The cabinet: a powder-coated frame with side panels, a vented top cap, the dark bay,
 * and two square-hole mounting posts (three cage-nut holes per U, the middle one
 * marking the U boundary like real EIA rails), on levelling feet.
 */
export function rackShellParts({
  rackName,
  ruHeight,
  face,
  x,
  y,
  width,
  height,
  bayX,
  bayY,
  bayW,
  bayH,
  active = false,
  title = true,
}: RackShellOptions): string[] {
  const out: string[] = [];
  if (title) {
    out.push(`<text x="${n(bayX)}" y="${n(Math.max(10, y - 5))}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="800" fill="#111827">${escapeXml(rackName)} · ${ruHeight}U · ${face}</text>`);
  }
  // Floor shadow, then the frame.
  out.push(`<rect x="${n(x + 10)}" y="${n(y + height - 9)}" width="${n(width - 20)}" height="11" rx="5.5" fill="#020617" fill-opacity="0.18"/>`);
  out.push(`<rect x="${n(x + 1)}" y="${n(y + 1)}" width="${n(width - 2)}" height="${n(height - 2)}" rx="8" fill="url(#rkRackFrame)" stroke="${active ? '#2563eb' : '#1d2631'}" stroke-width="${active ? '2.4' : '1.6'}" filter="url(#rkSoftShadow)"/>`);
  // Side panels (the cabinet's depth, seen as dark uprights).
  out.push(`<rect x="${n(x + 4)}" y="${n(y + 6)}" width="7" height="${n(height - 12)}" rx="2" fill="url(#rkRackSide)"/>`);
  out.push(`<rect x="${n(x + width - 11)}" y="${n(y + 6)}" width="7" height="${n(height - 12)}" rx="2" fill="url(#rkRackSide)"/>`);
  // Top cap with cable-entry vents.
  out.push(`<rect x="${n(x + 12)}" y="${n(y + 3)}" width="${n(width - 24)}" height="${n(Math.max(4, bayY - y - 6))}" rx="2" fill="#0d1217"/>`);
  for (let i = 0; i < 12; i++) {
    const vx = x + width / 2 - 66 + i * 11;
    if (bayY - y > 9) out.push(`<rect x="${n(vx)}" y="${n(y + 5)}" width="7" height="${n(Math.max(2, bayY - y - 10))}" rx="1" fill="#05080c"/>`);
  }
  // The bay.
  out.push(`<rect x="${n(bayX)}" y="${n(bayY)}" width="${n(bayW)}" height="${n(bayH)}" rx="2" fill="url(#rkRackBay)" stroke="#05080c" stroke-width="1"/>`);
  // Mounting posts: square cage-nut holes, 3 per U.
  const postW = 14;
  for (const px of [bayX - postW + 4, bayX + bayW - 4]) {
    out.push(`<rect x="${n(px)}" y="${n(bayY - 2)}" width="${postW}" height="${n(bayH + 4)}" rx="1.5" fill="url(#rkRail)" stroke="#05080c" stroke-width="0.8"/>`);
    const u = bayH / Math.max(1, ruHeight);
    for (let i = 0; i < ruHeight; i++) {
      for (const f of [0.18, 0.5, 0.82]) {
        const cy = bayY + u * i + u * f;
        out.push(`<rect x="${n(px + postW / 2 - 2.1)}" y="${n(cy - 2.1)}" width="4.2" height="4.2" rx="0.5" fill="#05080c"/>`);
      }
      out.push(`<path d="M ${n(px + 1.5)} ${n(bayY + u * i)} h ${n(postW - 3)}" stroke="#1a2028" stroke-width="0.6"/>`);
    }
  }
  // Frame screws + levelling feet.
  for (const [cx, cy] of [[x + 15, y + 9], [x + width - 15, y + 9], [x + 15, y + height - 9], [x + width - 15, y + height - 9]] as const) {
    out.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="2.6" fill="url(#rkScrew)" stroke="#04070a" stroke-width="0.6"/>`);
  }
  for (const fx of [x + 16, x + width - 30]) {
    out.push(`<rect x="${n(fx)}" y="${n(y + height - 2)}" width="14" height="5" rx="1.5" fill="#05080c"/>`);
    out.push(`<rect x="${n(fx + 4)}" y="${n(y + height + 2)}" width="6" height="3" rx="1" fill="#4b5563"/>`);
  }
  return out;
}

/**
 * A vertical 0U PDU: a black aluminium extrusion with the input breaker and an amp
 * meter at the top, the feed letter, then a column of C13 outlets (one per port,
 * capped to what fits), each with its three pins.
 */
function pduStripParts(device: Device, p: Rect): string[] {
  const out: string[] = [
    `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="2.5" fill="url(#rkPduBody)" stroke="#04070a" stroke-width="0.9"/>`,
    `<rect x="${n(p.x + 1)}" y="${n(p.y + 1)}" width="1.2" height="${n(p.h - 2)}" rx="0.6" fill="#ffffff" fill-opacity="0.12"/>`,
  ];
  // Breaker rocker + power LED at the top.
  out.push(`<rect x="${n(p.x + p.w / 2 - 3)}" y="${n(p.y + 4)}" width="6" height="8" rx="1.2" fill="#0b1016" stroke="${C.jackBd}" stroke-width="0.6"/>`);
  out.push(`<rect x="${n(p.x + p.w / 2 - 2)}" y="${n(p.y + 5)}" width="4" height="3.4" rx="0.6" fill="#ef4444" fill-opacity="0.85"/>`);
  out.push(`<circle cx="${n(p.x + p.w / 2)}" cy="${n(p.y + 16)}" r="1.6" fill="url(#rkLedG)"/>`);
  // The feed it's on, as the strip's silkscreen letter (only when there's room for it).
  const feed = device.powerFeed === 'A' || device.powerFeed === 'B' ? device.powerFeed : null;
  const lettered = feed != null && p.h >= 60;
  if (lettered) {
    out.push(`<text data-feed="${feed}" x="${n(p.x + p.w / 2)}" y="${n(p.y + 29)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="8" font-weight="800" fill="${C.text}">${feed}</text>`);
  }
  // Outlet column: one C13 per interface, evenly spaced, sized to the strip width.
  const count = Math.max(1, (device.interfaces ?? []).length || 8);
  const top = p.y + (lettered ? 33 : 22);
  const colH = Math.max(6, p.h - (lettered ? 39 : 28));
  const ow = Math.min(p.w - 5, 11);
  // As many outlets as the column holds at 2px each plus a gap; a short strip (a library
  // thumbnail) shows a few, never a negative-height outlet.
  const drawn = Math.min(count, Math.floor(colH / 3.5));
  const pitch = colH / Math.max(1, drawn);
  const oh = Math.min(9, pitch - 1.5);
  const ox = p.x + (p.w - ow) / 2;
  for (let i = 0; i < drawn; i++) {
    const oy = top + i * pitch;
    out.push(`<rect x="${n(ox)}" y="${n(oy)}" width="${n(ow)}" height="${n(oh)}" rx="1.4" fill="${C.cage}" stroke="${C.jackBd}" stroke-width="0.7"/>`);
    if (oh >= 5) {
      // C13 pins: two flat line contacts and the earth above them.
      out.push(`<path d="M ${n(ox + ow * 0.28)} ${n(oy + oh * 0.55)} v ${n(oh * 0.26)} M ${n(ox + ow * 0.72)} ${n(oy + oh * 0.55)} v ${n(oh * 0.26)} M ${n(ox + ow / 2)} ${n(oy + oh * 0.2)} v ${n(oh * 0.22)}" stroke="${C.notch}" stroke-width="1" stroke-linecap="round"/>`);
    }
  }
  return out;
}

/**
 * A vertical 0U cable manager: a dark channel with a finger duct at every U, so cords
 * read as dressed into it beside the gear they leave.
 */
function verticalManagerParts(device: Device, p: Rect): string[] {
  const out: string[] = [
    `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="2.5" fill="#1a1f26" stroke="#04070a" stroke-width="0.9"/>`,
    `<rect x="${n(p.x + 3)}" y="${n(p.y + 2)}" width="${n(p.w - 6)}" height="${n(p.h - 4)}" rx="1.5" fill="#0b0e12"/>`,
  ];
  const fingers = Math.max(1, device.ruSpan ?? 1);
  const pitch = p.h / fingers;
  for (let i = 0; i < fingers; i++) {
    const fy = p.y + i * pitch + pitch / 2 - 2;
    out.push(`<rect x="${n(p.x + 1)}" y="${n(fy)}" width="${n(p.w - 2)}" height="4" rx="2" fill="url(#rkModule)" stroke="${C.cageBd}" stroke-width="0.5"/>`);
  }
  return out;
}

/**
 * "Ghost" art for a device mounted on the OPPOSITE face — drawn on the face you're viewing
 * so a full-depth chassis on the back still reads as occupying its U from the front (you see
 * its back panel, not empty space). Muted, hatched, non-glossy, labeled with the real face.
 * `viewingFace` is the face being rendered; the device actually lives on the other one.
 */
export function deviceGhostParts(device: Device, panel: Rect, viewingFace: 'front' | 'rear'): string[] {
  const realFace = viewingFace === 'front' ? 'rear' : 'front';
  const { x, y, w, h } = panel;
  const out: string[] = [
    // recessed back-panel slab
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="3" fill="${C.ghostFill}" stroke="${C.ghostBd}" stroke-width="1" stroke-dasharray="4 3"/>`,
  ];
  // diagonal hatch so it reads as "behind", not a real faceplate
  const step = 9;
  for (let gx = x - h; gx < x + w; gx += step) {
    const x1 = Math.max(x, gx);
    const y1 = gx < x ? y + (x - gx) : y;
    const x2 = Math.min(x + w, gx + h);
    const y2 = gx + h > x + w ? y + (x + w - gx) : y + h;
    if (x2 > x1) out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${C.ghostHatch}" stroke-width="0.75"/>`);
  }
  // back-of-chassis hints: a couple of fan grilles on the right
  const fanR = Math.min(h * 0.32, 9);
  const cy = y + h / 2;
  for (let i = 0; i < 2; i++) {
    const fx = x + w - 16 - i * (fanR * 2 + 5);
    out.push(`<circle cx="${n(fx)}" cy="${n(cy)}" r="${n(fanR)}" fill="none" stroke="${C.ghostHatch}" stroke-width="0.9"/>`);
    out.push(`<circle cx="${n(fx)}" cy="${n(cy)}" r="${n(fanR * 0.32)}" fill="${C.ghostHatch}"/>`);
  }
  // label: "rear · name" so it's unambiguous which side the gear is really on
  out.push(`<text x="${n(x + 7)}" y="${n(y + h / 2 + 3.5)}" font-family="ui-monospace,Menlo,monospace" font-size="9" fill="${C.ghostText}">${realFace} · ${escapeXml(device.name)}</text>`);
  return out;
}

/**
 * Art for a rack-mounted device seen from the opposite aisle.
 * Full-depth devices get their real rear panel; shallow gear falls back to the muted
 * occupancy ghost because it does not physically span the cabinet depth.
 */
export function deviceOppositeFaceParts(device: Device, panel: Rect, viewingFace: 'front' | 'rear'): string[] {
  if (!isFullDepth(device.type)) return deviceGhostParts(device, panel, viewingFace);
  return deviceFaceParts(device, panel, 'rear');
}

/**
 * Faceplate art for one device in ABSOLUTE coords (panel rect already positioned).
 * Returns SVG element strings; the consumer joins + wraps them. A vendor skin (or an
 * uploaded photo) wins; rail gear draws as a vertical strip; the rear of full-depth
 * gear is its power + cooling side; everything else is the unbranded front.
 */
export function deviceFaceParts(
  device: Device,
  panel: Rect,
  face: 'front' | 'rear' = 'front',
  hideLabel = false,
): string[] {
  // Rail-mounted power (a vertical 0U PDU) is a narrow tall strip — a column of
  // outlets down its length, not any horizontal faceplate. Keyed on MOUNT, not
  // type (a PDU is stored as type 'ups', same as a rack UPS), and checked before
  // vendor skins: an APC strip is still a strip. No name label.
  if (slotOf(device).mount === 'rail') {
    const strip = isCableManager(device) ? verticalManagerParts(device, panel) : pduStripParts(device, panel);
    return [...strip, ...statusOverlay(device, panel)];
  }

  const photoSkin = rackPhotoSkinParts(device, panel, face, hideLabel);
  if (photoSkin.length > 0) return [...photoSkin, ...statusOverlay(device, panel)];

  const theme = defaultTheme(device, faceStyleFor(device));
  const parts =
    face === 'rear' && isFullDepth(device.type)
      ? rearFaceParts(device, panel, theme, hideLabel)
      : frontFaceParts(device, panel, theme, hideLabel);
  return [...parts, ...statusOverlay(device, panel)];
}

/** Per-status colors for the lifecycle marker. 'active' has none (the default live state). */
const STATUS_COLOR: Record<string, string> = {
  planned: '#3b82f6',
  maintenance: '#f59e0b',
  decommissioned: '#ef4444',
};

/**
 * Lifecycle tint drawn ON TOP of any device: a corner status dot, a dashed outline for
 * 'planned', and a faded scrim for 'decommissioned'. 'active'/absent → nothing. Hex-only,
 * so it rasterizes identically in the editor, the canvas, and the export.
 */
function statusOverlay(device: Device, p: Rect): string[] {
  const status = device.status;
  if (!status || status === 'active') return [];
  const color = STATUS_COLOR[status] ?? '#3b82f6';
  const out: string[] = [];
  if (status === 'decommissioned') {
    out.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="#0a0e12" fill-opacity="0.42"/>`);
  }
  if (status === 'planned') {
    out.push(`<rect x="${n(p.x + 0.75)}" y="${n(p.y + 0.75)}" width="${n(p.w - 1.5)}" height="${n(p.h - 1.5)}" rx="3" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 3"/>`);
  }
  // corner status dot (top-left, just inside the ear)
  out.push(`<circle cx="${n(p.x + 6)}" cy="${n(p.y + 6)}" r="3" fill="${color}" stroke="#0a0e12" stroke-width="0.6"/>`);
  return out;
}
