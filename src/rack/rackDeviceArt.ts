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
import { portLayout, type Rect } from './rackLayout';
import { panelKindFor } from './panelKind';

/** Shared gradient defs. Include ONCE per SVG document (root). */
export const RACK_ART_DEFS = [
  '<defs>',
  '<linearGradient id="rkMetal" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#3a4250"/><stop offset="0.5" stop-color="#262d38"/>',
  '<stop offset="0.52" stop-color="#2e3744"/><stop offset="1" stop-color="#1b2129"/></linearGradient>',
  '<linearGradient id="rkSheen" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="0.28" stop-color="#ffffff" stop-opacity="0"/></linearGradient>',
  '<linearGradient id="rkPatch" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#cdd6e0"/><stop offset="0.5" stop-color="#aab4c0"/><stop offset="1" stop-color="#8e98a4"/></linearGradient>',
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
} as const;

const n = (v: number) => v.toFixed(1);

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
    `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="${fill}" stroke="${C.chassisBd}" stroke-width="1"/>` +
    `<rect x="${n(p.x + 1)}" y="${n(p.y + 1)}" width="${n(p.w - 2)}" height="${n(Math.min(p.h * 0.42, 16))}" rx="2.5" fill="url(#rkSheen)"/>` +
    `<text x="${n(p.x + 8)}" y="${n(p.y + p.h / 2 + 4)}" font-family="ui-monospace,Menlo,monospace" font-size="10" font-weight="700" fill="${C.text}">${escapeXml(device.name)}</text>` +
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
 * Front-panel art for one device in ABSOLUTE coords (panel rect already positioned).
 * Returns SVG element strings; the consumer joins + wraps them.
 */
export function deviceFaceParts(device: Device, panel: Rect): string[] {
  const kind = panelKindFor(device.type);
  const ports = (device.interfaces ?? []).map((i) => ({ id: i.id, name: i.name }));
  const out: string[] = [];

  if (kind === 'switch' || kind === 'firewall') {
    out.push(chassis(device, panel));
    for (const j of portLayout(panel, ports)) out.push(rj45(j.x, j.y, j.w, j.h));
    // SFP+ uplink cages on the right edge
    const cageW = 40;
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
    const jacks = portLayout(panel, ports);
    jacks.forEach((j, i) => {
      out.push(`<rect x="${n(j.x)}" y="${n(j.y)}" width="${n(j.w)}" height="${n(j.h)}" rx="1" fill="#1b222b" stroke="#5b6573" stroke-width="0.7"/>`);
      out.push(`<rect x="${n(j.x + j.w / 2 - j.w * 0.17)}" y="${n(j.y + j.h - 2)}" width="${n(j.w * 0.34)}" height="2" fill="${C.notch}"/>`);
      // number every port that has room
      if (j.w >= 12) out.push(`<text x="${n(j.x + j.w / 2)}" y="${n(j.y - 1)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="5" fill="${C.patchText}">${i + 1}</text>`);
    });
  } else if (kind === 'server') {
    out.push(chassis(device, panel));
    // drive-bay array on the right with handle rail + activity LED
    const bays = 6;
    const bw = 13;
    const gap = 3;
    const totalW = bays * bw + (bays - 1) * gap;
    const startX = panel.x + panel.w - 12 - totalW;
    for (let i = 0; i < bays; i++) {
      const bx = startX + i * (bw + gap);
      const by = panel.y + 5;
      const bh = panel.h - 10;
      out.push(`<rect x="${n(bx)}" y="${n(by)}" width="${bw}" height="${n(bh)}" rx="2" fill="${C.drive}" stroke="${C.driveBd}" stroke-width="0.75"/>`);
      out.push(`<rect x="${n(bx + 2.5)}" y="${n(by + 4)}" width="2.5" height="${n(bh - 8)}" rx="1.2" fill="${C.driveRail}"/>`);
      out.push(`<circle cx="${n(bx + bw - 3.5)}" cy="${n(by + bh - 4)}" r="1.4" fill="url(#rkLedG)"/>`);
    }
    // status LCD + power button near the name
    out.push(`<rect x="${n(panel.x + 8)}" y="${n(panel.y + panel.h - 11)}" width="34" height="8" rx="1.5" fill="#0a1119" stroke="#34d399" stroke-width="0.6"/>`);
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
  return out;
}
