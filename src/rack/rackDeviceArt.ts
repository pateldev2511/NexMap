/**
 * Realistic rack device art (schema v3, "Studio Realism" — design-shotgun direction A).
 *
 * THE shared device renderer. One source of truth for how every device looks, consumed by
 * the live editor (RackCanvas), the multi-rack canvas (RackRow), and the export
 * (buildRackSvg). It emits LITERAL-HEX SVG element strings (real gear is black/grey
 * regardless of app theme) so the same output renders identically in the DOM and when
 * rasterized — gradients DO rasterize (only CSS var() doesn't), so the gloss/metal/LED glow
 * survive PNG/PDF export.
 *
 * Geometry comes from rackLayout (`portLayout` for jacks) so drawn jacks line up exactly
 * with cable endpoints (`portCenter`). Pure + deterministic. Every consumer includes
 * RACK_ART_DEFS once at its SVG root; the gradient ids are shared (not per-device), so there
 * are no id collisions.
 */
import type { Device } from '@/model/types';
import { escapeXml } from '@/io/export/buildSvg';
import { portLayout, PATCH_PORT_OPTS, type Rect, type PortRect } from './rackLayout';
import { panelKindFor } from './panelKind';
import { isFullDepth } from './rackModel';
import { rackPhotoSkinParts } from './rackPhotoSkins';

/** Shared gradient defs. Include ONCE per SVG document (root). */
export const RACK_ART_DEFS = [
  '<defs>',
  '<filter id="rkSoftShadow" x="-20%" y="-20%" width="140%" height="145%">',
  '<feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#0f172a" flood-opacity="0.22"/></filter>',
  '<filter id="rkDeviceShadow" x="-8%" y="-35%" width="116%" height="170%">',
  '<feDropShadow dx="0" dy="1.4" stdDeviation="1.2" flood-color="#020617" flood-opacity="0.52"/></filter>',
  '<filter id="rkCableShadow" x="-18%" y="-60%" width="136%" height="220%">',
  '<feDropShadow dx="0" dy="2.2" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.34"/></filter>',
  '<linearGradient id="rkRackFrame" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#202832"/><stop offset="0.18" stop-color="#111821"/>',
  '<stop offset="0.72" stop-color="#0c1118"/><stop offset="1" stop-color="#252d37"/></linearGradient>',
  '<linearGradient id="rkRackBay" x1="0" y1="0" x2="1" y2="0">',
  '<stop offset="0" stop-color="#0b1017"/><stop offset="0.08" stop-color="#1c2430"/>',
  '<stop offset="0.5" stop-color="#111821"/><stop offset="0.92" stop-color="#1c2430"/><stop offset="1" stop-color="#0b1017"/></linearGradient>',
  '<linearGradient id="rkRail" x1="0" y1="0" x2="1" y2="0">',
  '<stop offset="0" stop-color="#05080c"/><stop offset="0.35" stop-color="#2c3540"/>',
  '<stop offset="0.55" stop-color="#121820"/><stop offset="1" stop-color="#05080c"/></linearGradient>',
  '<linearGradient id="rkMetal" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#4a5360"/><stop offset="0.1" stop-color="#262f3a"/>',
  '<stop offset="0.48" stop-color="#151d27"/><stop offset="0.52" stop-color="#2f3946"/><stop offset="1" stop-color="#111821"/></linearGradient>',
  '<linearGradient id="rkBrushed" x1="0" y1="0" x2="1" y2="0">',
  '<stop offset="0" stop-color="#111821"/><stop offset="0.18" stop-color="#3b4653"/>',
  '<stop offset="0.5" stop-color="#202936"/><stop offset="0.82" stop-color="#465260"/><stop offset="1" stop-color="#141b24"/></linearGradient>',
  '<linearGradient id="rkSheen" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="0.28" stop-color="#ffffff" stop-opacity="0"/></linearGradient>',
  '<linearGradient id="rkPatch" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#d8e0ea"/><stop offset="0.14" stop-color="#84909d"/>',
  '<stop offset="0.52" stop-color="#aeb8c4"/><stop offset="1" stop-color="#66717f"/></linearGradient>',
  '<linearGradient id="rkLCD" x1="0" y1="0" x2="1" y2="1">',
  '<stop offset="0" stop-color="#0f766e"/><stop offset="0.5" stop-color="#042f2e"/><stop offset="1" stop-color="#14b8a6"/></linearGradient>',
  '<radialGradient id="rkLedG" cx="0.5" cy="0.4" r="0.6">',
  '<stop offset="0" stop-color="#b6ffce"/><stop offset="0.4" stop-color="#34d399"/><stop offset="1" stop-color="#0f7a4d"/></radialGradient>',
  '<radialGradient id="rkLedA" cx="0.5" cy="0.4" r="0.6">',
  '<stop offset="0" stop-color="#ffe9a8"/><stop offset="0.5" stop-color="#f59e0b"/><stop offset="1" stop-color="#a25c04"/></radialGradient>',
  '</defs>',
].join('');

const C = {
  chassisBd: '#0a0e12',
  text: '#e7edf4',
  textMut: '#9fb0c2',
  badge: '#111827',
  badgeBd: '#334155',
  jack: '#0a1119',
  jackBd: '#566372',
  notch: '#05080c',
  cage: '#161c24',
  cageBd: '#3a4654',
  drive: '#1a212a',
  driveBd: '#3a4654',
  driveRail: '#2c3744',
  patchText: '#3a4654',
  vent: '#11161d',
  // opposite-face "ghost" (back of a chassis seen from the other side)
  ghostFill: '#161b22',
  ghostBd: '#39424f',
  ghostHatch: '#2c343f',
  ghostText: '#6b7787',
  rackBolt: '#647282',
  rackBoltCore: '#111827',
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

/** Photo-style rack cabinet shell shared by live SVG and export. */
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
  out.push(`<rect x="${n(x + 10)}" y="${n(y + height - 9)}" width="${n(width - 20)}" height="11" rx="5.5" fill="#020617" fill-opacity="0.16"/>`);
  out.push(`<rect x="${n(x + 1)}" y="${n(y + 1)}" width="${n(width - 2)}" height="${n(height - 2)}" rx="12" fill="url(#rkRackFrame)" stroke="${active ? '#2563eb' : '#243142'}" stroke-width="${active ? '2.4' : '1.6'}" filter="url(#rkSoftShadow)"/>`);
  out.push(`<rect x="${n(x + 8)}" y="${n(y + 9)}" width="${n(width - 16)}" height="${n(height - 18)}" rx="8" fill="#05080c" opacity="0.72"/>`);
  out.push(`<rect x="${n(bayX)}" y="${n(bayY)}" width="${n(bayW)}" height="${n(bayH)}" rx="4" fill="url(#rkRackBay)" stroke="#283442" stroke-width="1"/>`);

  const railW = 16;
  for (const railX of [bayX - railW + 2, bayX + bayW - 2]) {
    out.push(`<rect x="${n(railX)}" y="${n(bayY - 3)}" width="${railW}" height="${n(bayH + 6)}" rx="4" fill="url(#rkRail)" stroke="#05080c" stroke-width="0.9"/>`);
    const holeStep = Math.max(12, bayH / Math.max(1, ruHeight));
    for (let i = 0; i < ruHeight; i++) {
      const cy = bayY + holeStep * i + holeStep / 2;
      if (cy < bayY + 5 || cy > bayY + bayH - 5) continue;
      out.push(`<circle cx="${n(railX + railW / 2)}" cy="${n(cy)}" r="1.65" fill="${C.rackBoltCore}" stroke="${C.rackBolt}" stroke-width="0.55"/>`);
    }
  }

  const screwPoints: Array<[number, number]> = [
    [x + 11, y + 11],
    [x + width - 11, y + 11],
    [x + 11, y + height - 11],
    [x + width - 11, y + height - 11],
  ];
  for (const [cx, cy] of screwPoints) {
    out.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="4.1" fill="#111827" stroke="#3b4654" stroke-width="1"/>`);
    out.push(`<path d="M ${n(cx - 2)} ${n(cy)} h 4" stroke="#657286" stroke-width="0.7"/>`);
  }

  // Small feet like the reference cabinets, only visible at the bottom.
  out.push(`<rect x="${n(x + 18)}" y="${n(y + height - 2)}" width="12" height="6" rx="1.5" fill="#05080c"/>`);
  out.push(`<rect x="${n(x + width - 30)}" y="${n(y + height - 2)}" width="12" height="6" rx="1.5" fill="#05080c"/>`);
  return out;
}

/** Shared visible port layout so drawn ports and cable endpoints stay aligned. */
export function devicePortLayout(device: Device, panel: Rect): PortRect[] {
  const ports = (device.interfaces ?? []).map((i) => ({ id: i.id, name: i.name }));
  const kind = panelKindFor(device.type);
  if (ports.length === 0) return [];
  if (kind === 'server') {
    const reservedRight = Math.min(panel.w * 0.42, 260);
    return portLayout(panel, ports, {
      gap: 3,
      nameZone: Math.min(88, panel.w * 0.18),
      rightInset: reservedRight,
      maxJack: 12,
    });
  }
  if (kind === 'psu' || kind === 'cable-mgr' || kind === 'blank') return [];
  if (kind === 'patch') {
    // Real 1U patch panels run ALL keystones in ONE row, banked in 6s. Shared
    // opts with the photo skin so drawn ports and hit markers always align.
    return portLayout(panel, ports, PATCH_PORT_OPTS);
  }
  if (kind === 'switch') {
    // Switches DO stack 24/48 ports in two staggered rows (odd top / even
    // bottom via the column-major fill), separated into banks of 6.
    return portLayout(panel, ports, { groupEvery: 6, groupGap: 6 });
  }
  return portLayout(panel, ports);
}

function labelParts(device: Device, p: Rect): string[] {
  const vendorModel = [device.vendor, device.model].filter(Boolean).join(' ');
  const primary = vendorModel || device.name;
  const secondary = vendorModel ? device.name : '';
  const max = Math.max(10, Math.min(12, p.h * 0.23));
  const out = [
    `<text x="${n(p.x + 8)}" y="${n(p.y + Math.min(p.h / 2 + 4, 18))}" font-family="ui-monospace,Menlo,monospace" font-size="${n(max)}" font-weight="800" fill="${C.text}">${escapeXml(primary)}</text>`,
  ];
  if (secondary && p.h >= 44) {
    out.push(`<text x="${n(p.x + 8)}" y="${n(p.y + Math.min(p.h - 9, 34))}" font-family="ui-monospace,Menlo,monospace" font-size="8.5" fill="${C.textMut}">${escapeXml(secondary)}</text>`);
  }
  return out;
}

function ventSlats(x: number, y: number, w: number, h: number, count: number): string[] {
  const out: string[] = [];
  const gap = w / count;
  for (let i = 0; i < count; i++) {
    out.push(`<rect x="${n(x + i * gap + gap * 0.28)}" y="${n(y)}" width="${n(Math.max(1.2, gap * 0.36))}" height="${n(h)}" rx="0.8" fill="${C.vent}"/>`);
  }
  return out;
}

function fan(cx: number, cy: number, r: number): string {
  const blades = [0, 45, 90, 135].map((a) => {
    const rad = (a * Math.PI) / 180;
    return `<line x1="${n(cx - r * 0.82 * Math.cos(rad))}" y1="${n(cy - r * 0.82 * Math.sin(rad))}" x2="${n(cx + r * 0.82 * Math.cos(rad))}" y2="${n(cy + r * 0.82 * Math.sin(rad))}" stroke="#475569" stroke-width="0.8"/>`;
  }).join('');
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#0a0f16" stroke="#475569" stroke-width="1"/>${blades}<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.28)}" fill="#64748b"/>`;
}

/** A realistic RJ45 jack at (x,y,w,h): dark cavity + bottom-center clip notch + link/act LEDs. */
function rj45(x: number, y: number, w: number, h: number): string {
  const notchW = Math.max(3, w * 0.34);
  const notchX = x + (w - notchW) / 2;
  const led = Math.max(1.1, Math.min(1.9, w * 0.1));
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="1.5" fill="${C.jack}" stroke="${C.jackBd}" stroke-width="0.75"/>` +
    `<rect x="${n(notchX)}" y="${n(y + h - 2)}" width="${n(notchW)}" height="2.4" fill="${C.notch}"/>` +
    `<circle cx="${n(x + led + 0.8)}" cy="${n(y + led + 0.8)}" r="${n(led)}" fill="url(#rkLedG)"/>` +
    `<circle cx="${n(x + w - led - 0.8)}" cy="${n(y + led + 0.8)}" r="${n(led)}" fill="url(#rkLedA)"/>`
  );
}

/** Chassis + glossy sheen + brand label + status LED, shared by all kinds. */
function chassis(device: Device, p: Rect, opts: { faceplate?: string; led?: string } = {}): string {
  const fill = opts.faceplate ?? 'url(#rkMetal)';
  const led = opts.led ?? 'url(#rkLedG)';
  return (
    `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="#020617" fill-opacity="0.36" transform="translate(0 1.2)"/>` +
    `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="${fill}" stroke="${C.chassisBd}" stroke-width="1" filter="url(#rkDeviceShadow)"/>` +
    `<rect x="${n(p.x + 1.3)}" y="${n(p.y + 1.2)}" width="${n(p.w - 2.6)}" height="${n(Math.min(p.h * 0.34, 13))}" rx="2.5" fill="url(#rkSheen)"/>` +
    `<rect x="${n(p.x + 0.8)}" y="${n(p.y + p.h - 2.2)}" width="${n(p.w - 1.6)}" height="1.2" fill="#64748b" fill-opacity="0.28"/>` +
    labelParts(device, p).join('') +
    `<circle cx="${n(p.x + p.w - 6)}" cy="${n(p.y + 6)}" r="2.5" fill="${led}"/>`
  );
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
  // back-of-chassis hints: a couple of fan grilles + a PSU block on the right
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
 * Front-panel art for one device in ABSOLUTE coords (panel rect already positioned).
 * Returns SVG element strings; the consumer joins + wraps them.
 */
export function deviceFaceParts(device: Device, panel: Rect, face: 'front' | 'rear' = 'front'): string[] {
  const photoSkin = rackPhotoSkinParts(device, panel, face);
  if (photoSkin.length > 0) return [...photoSkin, ...statusOverlay(device, panel)];

  // The rear of a full-depth chassis is power + cooling, not a mirror of the front jacks.
  if (face === 'rear' && isFullDepth(device.type)) {
    return [...rearFaceParts(device, panel), ...statusOverlay(device, panel)];
  }
  const kind = panelKindFor(device.type);
  const out: string[] = [];

  if (kind === 'switch' || kind === 'firewall') {
    out.push(chassis(device, panel));
    out.push(...ventSlats(panel.x + 62, panel.y + Math.max(4, panel.h * 0.22), 24, Math.max(8, panel.h * 0.5), 6));
    for (const j of devicePortLayout(device, panel)) out.push(rj45(j.x, j.y, j.w, j.h));
    // SFP+ uplink cages on the right edge
    const cageW = Math.min(44, panel.w * 0.09);
    const cageX = panel.x + panel.w - cageW - 6;
    for (let i = 0; i < 2; i++) {
      const cy = panel.y + panel.h / 2 - 9 + i * 11;
      out.push(`<rect x="${n(cageX)}" y="${n(cy)}" width="${cageW}" height="9" rx="1.5" fill="${C.cage}" stroke="${C.cageBd}" stroke-width="0.75"/>`);
      out.push(`<rect x="${n(cageX + 3)}" y="${n(cy + 2)}" width="${cageW - 6}" height="5" fill="${C.notch}"/>`);
    }
    if (kind === 'firewall') {
      // a couple of zone ticks under the name
      out.push(`<rect x="${n(panel.x + 8)}" y="${n(panel.y + panel.h - 7)}" width="26" height="3" rx="1" fill="#dc2626"/>`);
      out.push(`<rect x="${n(panel.x + 38)}" y="${n(panel.y + panel.h - 7)}" width="26" height="3" rx="1" fill="#2563eb"/>`);
    }
  } else if (kind === 'patch') {
    out.push(chassis(device, panel, { faceplate: 'url(#rkPatch)', led: '#3a4654' }));
    const jacks = devicePortLayout(device, panel);
    jacks.forEach((j, i) => {
      out.push(`<rect x="${n(j.x)}" y="${n(j.y)}" width="${n(j.w)}" height="${n(j.h)}" rx="1" fill="#1b222b" stroke="#5b6573" stroke-width="0.7"/>`);
      out.push(`<rect x="${n(j.x + j.w / 2 - j.w * 0.17)}" y="${n(j.y + j.h - 2)}" width="${n(j.w * 0.34)}" height="2" fill="${C.notch}"/>`);
      // number every port that has room
      if (j.w >= 12) out.push(`<text x="${n(j.x + j.w / 2)}" y="${n(j.y - 1)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="5" fill="${C.patchText}">${i + 1}</text>`);
    });
  } else if (kind === 'server') {
    out.push(chassis(device, panel));
    const tall = panel.h >= 52;
    const driveCols = tall ? 8 : 6;
    const driveRows = tall ? 2 : 1;
    const driveAreaW = Math.min(panel.w * 0.36, tall ? 220 : 112);
    const driveAreaX = panel.x + panel.w - driveAreaW - 11;
    const driveGap = 3;
    const bw = (driveAreaW - (driveCols - 1) * driveGap) / driveCols;
    const bh = Math.max(12, (panel.h - 14 - (driveRows - 1) * driveGap) / driveRows);
    for (let row = 0; row < driveRows; row++) {
      for (let col = 0; col < driveCols; col++) {
        const bx = driveAreaX + col * (bw + driveGap);
        const by = panel.y + 7 + row * (bh + driveGap);
        out.push(`<rect x="${n(bx)}" y="${n(by)}" width="${n(bw)}" height="${n(bh)}" rx="2" fill="${C.drive}" stroke="${C.driveBd}" stroke-width="0.75"/>`);
        out.push(`<rect x="${n(bx + 2.2)}" y="${n(by + 3)}" width="${n(Math.max(2, bw * 0.15))}" height="${n(bh - 6)}" rx="1" fill="${C.driveRail}"/>`);
        out.push(`<circle cx="${n(bx + bw - 3.5)}" cy="${n(by + bh - 3.5)}" r="1.35" fill="url(#rkLedG)"/>`);
      }
    }
    const fanR = Math.min(tall ? 15 : 8, panel.h * 0.28);
    const fanY = panel.y + panel.h / 2;
    const fanStart = driveAreaX - (tall ? 78 : 58);
    for (let i = 0; i < (tall ? 2 : 1); i++) out.push(fan(fanStart + i * (fanR * 2 + 8), fanY, fanR));
    out.push(...ventSlats(panel.x + 78, panel.y + panel.h - 12, Math.max(22, driveAreaX - panel.x - 170), 7, 12));
    for (const j of devicePortLayout(device, panel)) out.push(rj45(j.x, j.y, j.w, j.h));
    // status LCD + recessed power button near the label, similar to enterprise servers.
    out.push(`<rect x="${n(panel.x + 8)}" y="${n(panel.y + panel.h - 11)}" width="34" height="8" rx="1.5" fill="url(#rkLCD)" stroke="#2dd4bf" stroke-width="0.6"/>`);
    out.push(`<circle cx="${n(panel.x + 54)}" cy="${n(panel.y + panel.h - 7)}" r="3.4" fill="${C.cage}" stroke="${C.jackBd}" stroke-width="0.75"/>`);
  } else if (kind === 'psu') {
    out.push(chassis(device, panel));
    // outlets + vents (UPS/PSU)
    const cy = panel.y + panel.h / 2;
    for (let i = 0; i < 3; i++) {
      const cx = panel.x + panel.w - 18 - i * 18;
      out.push(`<rect x="${n(cx - 6)}" y="${n(cy - 6)}" width="12" height="12" rx="2" fill="${C.cage}" stroke="${C.jackBd}" stroke-width="0.75"/>`);
      out.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="2.2" fill="${C.notch}"/>`);
    }
    for (let i = 0; i < 6; i++) out.push(`<rect x="${n(panel.x + 70 + i * 5)}" y="${n(cy - 7)}" width="2" height="14" rx="1" fill="${C.vent}"/>`);
  } else if (kind === 'cable-mgr') {
    out.push(chassis(device, panel, { faceplate: '#20262e', led: '#20262e' }));
    // finger ducts
    for (let i = 0; i < 10; i++) {
      const fx = panel.x + 14 + i * ((panel.w - 28) / 10);
      out.push(`<rect x="${n(fx)}" y="${n(panel.y + 4)}" width="6" height="${n(panel.h - 8)}" rx="3" fill="#161c24" stroke="${C.cageBd}" stroke-width="0.5"/>`);
    }
  } else {
    // blank / blade / unknown — flat faceplate + two cage screws
    out.push(chassis(device, panel, { led: '#3a4654' }));
    for (const sx of [panel.x + 10, panel.x + panel.w - 10]) {
      out.push(`<circle cx="${n(sx)}" cy="${n(panel.y + panel.h / 2)}" r="2.6" fill="#3a4654" stroke="${C.chassisBd}" stroke-width="0.6"/>`);
      out.push(`<path d="M ${n(sx - 1.6)} ${n(panel.y + panel.h / 2)} h 3.2" stroke="${C.notch}" stroke-width="0.7"/>`);
    }
  }
  out.push(...statusOverlay(device, panel));
  return out;
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
  // corner status dot (top-left, opposite the chassis status LED)
  out.push(`<circle cx="${n(p.x + 6)}" cy="${n(p.y + 6)}" r="3" fill="${color}" stroke="#0a0e12" stroke-width="0.6"/>`);
  return out;
}

/**
 * Rear faceplate for a full-depth chassis (schema v3): two redundant PSU modules with
 * C14 inlets on the right, fan grilles in the middle, and the escaped name — what you'd
 * actually see from the back of the rack. Hex-only, shared by editor/canvas/export.
 */
function rearFaceParts(device: Device, p: Rect): string[] {
  const out = [chassis(device, p, { led: 'url(#rkLedG)' })];

  // redundant hot-swap PSU modules on the right, each with a power inlet + status LED
  const psuW = Math.min(52, p.w * 0.12);
  const gap = 6;
  const psuH = Math.min(p.h - 8, p.h >= 54 ? 34 : 26);
  const psuY = p.y + (p.h - psuH) / 2;
  for (let i = 0; i < 2; i++) {
    const px = p.x + p.w - 8 - (i + 1) * psuW - i * gap;
    out.push(`<rect x="${n(px)}" y="${n(psuY)}" width="${n(psuW)}" height="${n(psuH)}" rx="2" fill="${C.vent}" stroke="${C.cageBd}" stroke-width="0.8"/>`);
    out.push(`<rect x="${n(px + psuW / 2 - 7)}" y="${n(psuY + psuH / 2 - 5)}" width="14" height="10" rx="1" fill="${C.notch}" stroke="${C.jackBd}" stroke-width="0.6"/>`);
    out.push(`<path d="M ${n(px + psuW / 2 - 3.6)} ${n(psuY + psuH / 2 - 1)} h 7.2 M ${n(px + psuW / 2)} ${n(psuY + psuH / 2 - 4)} v 8" stroke="#475569" stroke-width="0.7"/>`);
    out.push(`<circle cx="${n(px + 6)}" cy="${n(psuY + 5)}" r="1.6" fill="url(#rkLedG)"/>`);
    out.push(...ventSlats(px + 5, psuY + psuH - 8, psuW - 10, 4, 6));
  }

  // fan grilles and I/O bay (center/left), as seen from a real rear rack face.
  const fanR = Math.min(p.h * 0.34, p.h >= 54 ? 14 : 11);
  const cy = p.y + p.h / 2;
  const fanCount = p.h >= 54 ? 4 : 2;
  for (let i = 0; i < fanCount; i++) out.push(fan(p.x + 58 + i * (fanR * 2 + 7), cy, fanR));
  const ioX = p.x + 12;
  const ioY = p.y + Math.max(5, p.h * 0.18);
  out.push(`<rect x="${n(ioX)}" y="${n(ioY)}" width="34" height="${n(Math.max(14, p.h * 0.36))}" rx="2" fill="#0a1119" stroke="${C.cageBd}" stroke-width="0.8"/>`);
  out.push(`<rect x="${n(ioX + 5)}" y="${n(ioY + 4)}" width="11" height="8" rx="1.2" fill="${C.jack}" stroke="${C.jackBd}" stroke-width="0.6"/>`);
  out.push(`<rect x="${n(ioX + 19)}" y="${n(ioY + 4)}" width="10" height="8" rx="1.2" fill="${C.notch}" stroke="${C.jackBd}" stroke-width="0.6"/>`);
  out.push(`<path d="M ${n(ioX + 6)} ${n(ioY + Math.max(14, p.h * 0.36) - 5)} h 23" stroke="#64748b" stroke-width="1"/>`);
  return out;
}
