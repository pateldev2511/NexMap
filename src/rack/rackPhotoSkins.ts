/**
 * Model-aware rack "photo skins" for known hardware.
 *
 * These are still deterministic SVG, not bundled manufacturer photos: live canvas,
 * thumbnails, SVG/PNG/PDF export, and local-first saves all stay portable. Exact approved
 * product photos can be supplied per device through `extra.rackPhotoFrontDataUri` /
 * `extra.rackPhotoRearDataUri` / `extra.rackPhotoDataUri` without a schema migration.
 */
import type { Device } from '@/model/types';
import { escapeXml } from '@/io/export/buildSvg';
import { portLayout, PATCH_PORT_OPTS, type Rect } from './rackLayout';
import { panelKindFor, type PanelKind } from './panelKind';
import { devicePortLayout } from './portLayouts';
import { outletGlyph } from './glyphs';
import {
  applianceFaceZones,
  fanCircles,
  labelMaxChars,
  labelRoom,
  patchPanelRows,
  serverFaceZones,
  switchFaceZones,
  upsFaceZones,
} from './faceZones';
import { isRasterPhotoDataUri } from './rackPhotoUpload';

type RackFace = 'front' | 'rear';
type SkinFamily =
  | 'server-dell'
  | 'server-hpe'
  | 'storage-array'
  | 'switch-cisco'
  | 'switch-arista'
  | 'switch-juniper'
  | 'firewall-fortinet'
  | 'firewall-palo'
  | 'load-balancer'
  | 'patch-panduit'
  | 'ups-apc';

const n = (v: number) => v.toFixed(1);

const COLOR = {
  chassis: '#05080c',
  stroke: '#0a0e12',
  metalDark: '#111821',
  metalMid: '#25303c',
  metalLight: '#536170',
  silver: '#b9c3cf',
  silverDark: '#7b8794',
  cavity: '#071018',
  line: '#465466',
  muted: '#9aa8b8',
} as const;

function norm(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function haystack(device: Device): string {
  return norm([device.vendor, device.model, device.name, device.type].filter(Boolean).join(' '));
}

function hasAny(h: string, words: readonly string[]): boolean {
  return words.some((w) => h.includes(w));
}

function modelLabel(device: Device): string {
  return [device.vendor, device.model].filter(Boolean).join(' ') || device.name;
}

function safeText(value: string): string {
  return escapeXml(value).slice(0, 120);
}

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function dataUriForFace(device: Device, face: RackFace): string | null {
  const extra = device.extra;
  if (!extra) return null;
  const keys = face === 'front'
    ? ['rackPhotoFrontDataUri', 'rackPhotoDataUri']
    : ['rackPhotoRearDataUri', 'rackPhotoDataUri'];
  for (const key of keys) {
    // Raster data-URIs only — svg+xml/gif are rejected so untrusted SVG never reaches the
    // export's Image() path (see rackPhotoUpload.ts; matches the upload validator).
    if (isRasterPhotoDataUri(extra[key])) return extra[key] as string;
  }
  return null;
}

/**
 * The panel kind each skin family is artwork FOR.
 *
 * A skin is chosen by vendor/model keywords, which say nothing about what the
 * device IS. Without this gate a device typed `switch` whose model reads
 * "PowerEdge R650" got the SERVER skin — drive bays, fans and all — and a Cisco
 * ISR typed `router` got a switch faceplate with SFP cages. A measured audit found
 * 405 port/furniture collisions, most of them caused by exactly this mismatch.
 *
 * The keyword decides WHICH skin; this decides WHETHER any skin applies at all.
 */
const FAMILY_KIND: Record<SkinFamily, PanelKind> = {
  'server-dell': 'server',
  'server-hpe': 'server',
  'storage-array': 'server',
  'switch-cisco': 'switch',
  'switch-arista': 'switch',
  'switch-juniper': 'switch',
  'firewall-fortinet': 'firewall',
  'firewall-palo': 'firewall',
  'load-balancer': 'appliance',
  'patch-panduit': 'patch',
  'ups-apc': 'ups',
};

/**
 * The keyword-matched family, or null when it does not suit the device's TYPE —
 * in which case the caller falls back to the generic parametric art, which is
 * already correct for every kind.
 */
function familyFor(device: Device): SkinFamily | null {
  const candidate = familyByKeyword(device);
  if (!candidate) return null;
  return FAMILY_KIND[candidate] === panelKindFor(device.type) ? candidate : null;
}

function familyByKeyword(device: Device): SkinFamily | null {
  const h = haystack(device);
  if (hasAny(h, ['panduit', 'patch panel', 'cat6 patch', 'fiber patch'])) return 'patch-panduit';
  if (hasAny(h, ['apc', 'smart ups', 'srt 2200'])) return 'ups-apc';
  if (hasAny(h, ['powervault', 'netapp', 'fas2750', 'synology', 'rs3621']) || device.type === 'storage') return 'storage-array';
  if (hasAny(h, ['poweredge', 'dell r650', 'dell r750'])) return 'server-dell';
  if (hasAny(h, ['proliant', 'dl360', 'dl380', 'hpe server'])) return 'server-hpe';
  if (hasAny(h, ['arista', '7050'])) return 'switch-arista';
  if (hasAny(h, ['juniper', 'ex4300', 'mx204'])) return 'switch-juniper';
  if (hasAny(h, ['fortinet', 'fortigate'])) return 'firewall-fortinet';
  if (hasAny(h, ['palo alto', 'pa 3220', 'pa3220'])) return 'firewall-palo';
  if (hasAny(h, ['big ip', 'f5'])) return 'load-balancer';
  if (hasAny(h, ['cisco', 'catalyst', 'nexus', 'isr', 'asr', 'firepower'])) return 'switch-cisco';
  return null;
}

/** Stable key for tests/UI feature detection. */
export function rackPhotoSkinKey(device: Device): string | null {
  if (dataUriForFace(device, 'front') || dataUriForFace(device, 'rear')) return 'custom-data-uri';
  return familyFor(device);
}

export function hasRackPhotoSkin(device: Device, face: RackFace = 'front'): boolean {
  return Boolean(dataUriForFace(device, face) || familyFor(device));
}

export function rackPhotoSkinParts(
  device: Device,
  panel: Rect,
  face: RackFace = 'front',
  hideLabel = false,
): string[] {
  const parts = rackPhotoSkinPartsRaw(device, panel, face);
  // The device NAME label carries data-facelabel; brand badges / port numbers do
  // not, so hiding the name keeps the realistic faceplate intact.
  return hideLabel ? parts.filter((s) => !s.includes('data-facelabel')) : parts;
}

function rackPhotoSkinPartsRaw(device: Device, panel: Rect, face: RackFace = 'front'): string[] {
  const dataUri = dataUriForFace(device, face);
  if (dataUri) return customPhotoParts(device, panel, dataUri);
  const family = familyFor(device);
  if (!family) return [];
  if (face === 'rear') {
    if (family.startsWith('server') || family === 'storage-array') return serverRearSkin(device, panel);
    if (family === 'ups-apc') return upsRearSkin(device, panel);
    if (family === 'patch-panduit') return patchPanelSkin(device, panel);
    return networkRearSkin(device, panel);
  }
  switch (family) {
    case 'server-dell':
      return serverFrontSkin(device, panel, { brandFill: '#0b1220', accent: '#1d4ed8', bezel: '#101820' });
    case 'server-hpe':
      return serverFrontSkin(device, panel, { brandFill: '#061f1b', accent: '#00b388', bezel: '#17212a' });
    case 'storage-array':
      return storageFrontSkin(device, panel);
    case 'switch-arista':
      return switchFrontSkin(device, panel, { faceplate: '#8391a2', brandFill: '#142033', accent: '#2563eb', uplinkColor: '#172554' });
    case 'switch-juniper':
      return switchFrontSkin(device, panel, { faceplate: '#6f7c8b', brandFill: '#123322', accent: '#16a34a', uplinkColor: '#14312a' });
    case 'firewall-fortinet':
      return applianceFrontSkin(device, panel, { faceplate: '#7f1822', brandFill: '#3b0a0f', accent: '#f97316' });
    case 'firewall-palo':
      return applianceFrontSkin(device, panel, { faceplate: '#e5e7eb', brandFill: '#263241', accent: '#f97316', darkText: true });
    case 'load-balancer':
      return applianceFrontSkin(device, panel, { faceplate: '#242b38', brandFill: '#111827', accent: '#ef4444' });
    case 'patch-panduit':
      return patchPanelSkin(device, panel);
    case 'ups-apc':
      return upsFrontSkin(device, panel);
    case 'switch-cisco':
    default:
      return switchFrontSkin(device, panel, { faceplate: '#657181', brandFill: '#111827', accent: '#22c55e', uplinkColor: '#1f2937' });
  }
}

function base(device: Device, p: Rect, opts: { fill?: string; stroke?: string; labelFill?: string; darkText?: boolean } = {}): string[] {
  const label = modelLabel(device);
  const fontSize = Math.max(8, Math.min(11.5, p.h * 0.22));
  // Capped against the reserved LABEL MARGIN, not the whole panel: the old
  // `(p.w - 18)` let a model name run through the vents and jacks on 1U gear.
  const maxChars = labelMaxChars(labelRoom(panelKindFor(device.type), p), fontSize);
  const textFill = opts.darkText ? '#172033' : (opts.labelFill ?? '#eef5ff');
  return [
    `<rect x="${n(p.x)}" y="${n(p.y + 1.2)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="#020617" fill-opacity="0.34" filter="url(#rkDeviceShadow)"/>`,
    `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="${opts.fill ?? 'url(#rkBrushed)'}" stroke="${opts.stroke ?? COLOR.stroke}" stroke-width="1"/>`,
    `<rect x="${n(p.x + 1.3)}" y="${n(p.y + 1.2)}" width="${n(p.w - 2.6)}" height="${n(Math.min(p.h * 0.33, 13))}" rx="2.4" fill="url(#rkSheen)"/>`,
    `<text data-facelabel="1" x="${n(p.x + 8)}" y="${n(p.y + Math.min(p.h / 2 + 4, 18))}" font-family="ui-monospace,Menlo,monospace" font-size="${n(fontSize)}" font-weight="800" fill="${textFill}">${safeText(fitText(label, maxChars))}</text>`,
    `<circle cx="${n(p.x + p.w - 7)}" cy="${n(p.y + 6)}" r="2.4" fill="url(#rkLedG)"/>`,
  ];
}

/**
 * Vendor badge, drawn BELOW the name.
 *
 * Suppressed on a chassis under 2U: the badge sits at `p.h - 15` while the name
 * baseline is at `p.h / 2 + 4`, so on a 1U panel the two occupy the same 8px and the
 * badge struck through the model name. The name already leads with the vendor there,
 * so the badge is redundant rather than missing information.
 */
function brandBadge(device: Device, p: Rect, fill: string, accent: string, darkText = false): string {
  if (p.h < 44) return '';
  const brand = safeText(device.vendor || device.model?.split(/\s+/)[0] || device.name);
  const w = Math.min(58, Math.max(34, brand.length * 5.4 + 11));
  const x = p.x + 8;
  const y = p.y + Math.max(4, p.h - 15);
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="11" rx="2" fill="${fill}" stroke="${accent}" stroke-width="0.7"/>` +
    `<text x="${n(x + w / 2)}" y="${n(y + 8.1)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="6.8" font-weight="800" fill="${darkText ? '#172033' : '#eef5ff'}">${brand}</text>`
  );
}

function rj45(x: number, y: number, w: number, h: number): string {
  const notchW = Math.max(3, w * 0.34);
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="1.4" fill="${COLOR.cavity}" stroke="#5b6573" stroke-width="0.7"/>` +
    `<rect x="${n(x + (w - notchW) / 2)}" y="${n(y + h - 2)}" width="${n(notchW)}" height="2.3" fill="#020617"/>` +
    `<circle cx="${n(x + 2.2)}" cy="${n(y + 2.2)}" r="1.2" fill="url(#rkLedG)"/>` +
    `<circle cx="${n(x + w - 2.2)}" cy="${n(y + 2.2)}" r="1.2" fill="url(#rkLedA)"/>`
  );
}

function vent(x: number, y: number, w: number, h: number, count: number, color = '#121820'): string[] {
  const out: string[] = [];
  const step = w / Math.max(1, count);
  for (let i = 0; i < count; i++) out.push(`<rect data-fx="vent" x="${n(x + i * step + step * 0.24)}" y="${n(y)}" width="${n(Math.max(1, step * 0.42))}" height="${n(h)}" rx="0.7" fill="${color}"/>`);
  return out;
}

function fan(cx: number, cy: number, r: number): string {
  const spokes = [0, 45, 90, 135].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return `<line x1="${n(cx - r * 0.82 * Math.cos(rad))}" y1="${n(cy - r * 0.82 * Math.sin(rad))}" x2="${n(cx + r * 0.82 * Math.cos(rad))}" y2="${n(cy + r * 0.82 * Math.sin(rad))}" stroke="#66758a" stroke-width="0.8"/>`;
  }).join('');
  return `<circle data-fx="fan" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#080d13" stroke="#566274" stroke-width="0.9"/>${spokes}<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.28)}" fill="#718096"/>`;
}

function sfpCage(x: number, y: number, w: number, h: number, fill = '#18212c'): string {
  return (
    `<rect data-fx="cage" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="1.4" fill="${fill}" stroke="#64748b" stroke-width="0.65"/>` +
    `<rect x="${n(x + 3)}" y="${n(y + h * 0.35)}" width="${n(w - 6)}" height="${n(Math.max(2, h * 0.3))}" fill="#030712"/>`
  );
}

function devicePorts(device: Device): { id: string; name: string }[] {
  return (device.interfaces ?? []).map((i) => ({ id: i.id, name: i.name }));
}

/**
 * Ports for a server/storage skin. Uses the SAME reserved band as the generic art
 * (faceZones.ts) — two copies of this geometry is precisely how jacks ended up
 * drawn on top of vents and fans in the first place.
 */
function serverPortLayout(device: Device, p: Rect) {
  const z = serverFaceZones(p);
  return portLayout(z.ports, devicePorts(device), {
    gap: 3,
    nameZone: 0,
    rightInset: 0,
    maxJack: 12,
  });
}

function customPhotoParts(device: Device, p: Rect, href: string): string[] {
  const fontSize = Math.max(7, Math.min(10, p.h * 0.19));
  const maxChars = Math.max(8, Math.floor((p.w - 18) / (fontSize * 0.58)));
  return [
    `<rect x="${n(p.x)}" y="${n(p.y + 1.2)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="#020617" fill-opacity="0.34" filter="url(#rkDeviceShadow)"/>`,
    `<image href="${escapeXml(href)}" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none"/>`,
    `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="none" stroke="#0a0e12" stroke-width="1"/>`,
    `<rect x="${n(p.x + 1.3)}" y="${n(p.y + 1.2)}" width="${n(p.w - 2.6)}" height="${n(Math.min(p.h * 0.3, 12))}" rx="2.4" fill="#ffffff" fill-opacity="0.14"/>`,
    `<text x="${n(p.x + 8)}" y="${n(p.y + Math.min(p.h - 7, 16))}" font-family="ui-monospace,Menlo,monospace" font-size="${n(fontSize)}" font-weight="800" fill="#eef5ff">${safeText(fitText(modelLabel(device), maxChars))}</text>`,
  ];
}

function serverFrontSkin(device: Device, p: Rect, opts: { brandFill: string; accent: string; bezel: string }): string[] {
  const out = base(device, p, { fill: 'url(#rkMetal)' });
  // All furniture derives from serverFaceZones so it cannot enter the port band.
  const z = serverFaceZones(p);
  const driveCols = z.tall ? 8 : 6;
  const driveRows = z.tall ? 2 : 1;
  const driveGap = 3;
  const bayH = Math.max(8, (z.drives.h - (driveRows - 1) * driveGap) / driveRows);
  const bayW = (z.drives.w - (driveCols - 1) * driveGap) / driveCols;
  out.push(`<rect x="${n(z.drives.x - 4)}" y="${n(z.drives.y)}" width="${n(z.drives.w + 8)}" height="${n(z.drives.h)}" rx="3" fill="${opts.bezel}" stroke="#334155" stroke-width="0.8"/>`);
  for (let r = 0; r < driveRows; r++) {
    for (let c = 0; c < driveCols; c++) {
      const x = z.drives.x + c * (bayW + driveGap);
      const y = z.drives.y + 2 + r * (bayH + driveGap);
      out.push(`<rect data-fx="drive" x="${n(x)}" y="${n(y)}" width="${n(bayW)}" height="${n(bayH)}" rx="1.8" fill="#111923" stroke="#465466" stroke-width="0.65"/>`);
      out.push(`<rect x="${n(x + 2)}" y="${n(y + 2)}" width="${n(Math.max(2, bayW * 0.17))}" height="${n(Math.max(2, bayH - 4))}" rx="1" fill="#2f3b49"/>`);
      out.push(`<circle cx="${n(x + bayW - 3.4)}" cy="${n(y + bayH - 3.4)}" r="1.25" fill="url(#rkLedG)"/>`);
    }
  }
  for (const f of fanCircles(z.fans, z.tall ? 3 : 2)) out.push(fan(f.cx, f.cy, f.r));
  if (z.vents) out.push(...vent(z.vents.x, z.vents.y, z.vents.w, z.vents.h, 14));
  for (const j of serverPortLayout(device, p)) out.push(rj45(j.x, j.y, j.w, j.h));
  out.push(`<rect x="${n(p.x + 8)}" y="${n(p.y + p.h - 12)}" width="34" height="8" rx="1.6" fill="url(#rkLCD)" stroke="${opts.accent}" stroke-width="0.65"/>`);
  out.push(`<circle cx="${n(p.x + 52)}" cy="${n(p.y + p.h - 8)}" r="3.2" fill="#0f172a" stroke="${opts.accent}" stroke-width="0.75"/>`);
  out.push(brandBadge(device, p, opts.brandFill, opts.accent));
  return out;
}

function storageFrontSkin(device: Device, p: Rect): string[] {
  const out = base(device, p, { fill: '#18202b' });
  const cols = p.h >= 76 ? 12 : 10;
  const rows = p.h >= 76 ? 3 : 2;
  // A storage array is mostly bays, so they claim everything right of the reserved
  // port band — but never the band itself.
  const zs = serverFaceZones(p);
  const areaX = zs.fans.x;
  const areaW = zs.drives.x + zs.drives.w - zs.fans.x;
  const gap = 2.5;
  const bayW = (areaW - (cols - 1) * gap) / cols;
  const bayH = Math.max(10, (p.h - 16 - (rows - 1) * gap) / rows);
  out.push(`<rect x="${n(areaX - 5)}" y="${n(p.y + 6)}" width="${n(areaW + 10)}" height="${n(p.h - 12)}" rx="3" fill="#0d131b" stroke="#334155" stroke-width="0.8"/>`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = areaX + c * (bayW + gap);
      const y = p.y + 8 + r * (bayH + gap);
      out.push(`<rect data-fx="drive" x="${n(x)}" y="${n(y)}" width="${n(bayW)}" height="${n(bayH)}" rx="1.5" fill="#1f2937" stroke="#4b5563" stroke-width="0.55"/>`);
      out.push(`<path d="M ${n(x + 2)} ${n(y + bayH - 3)} h ${n(Math.max(2, bayW - 4))}" stroke="#64748b" stroke-width="0.7"/>`);
      out.push(`<circle cx="${n(x + bayW - 3)}" cy="${n(y + 3)}" r="1.1" fill="url(#rkLedG)"/>`);
    }
  }
  for (const j of serverPortLayout(device, p)) out.push(rj45(j.x, j.y, j.w, j.h));
  out.push(brandBadge(device, p, '#101827', '#38bdf8'));
  return out;
}

function switchFrontSkin(device: Device, p: Rect, opts: { faceplate: string; brandFill: string; accent: string; uplinkColor: string }): string[] {
  const out = base(device, p, { fill: opts.faceplate, stroke: '#1f2937' });
  // Same reserved zones as the generic art (faceZones.ts), so the two paths cannot
  // drift and no jack can land under a vent slat or an SFP cage.
  const z = switchFaceZones(p);
  const ports = portLayout(z.ports, devicePorts(device), {
    groupEvery: 6,
    groupGap: 6,
    nameZone: 0,
    rightInset: 0,
  });
  out.push(...vent(z.vents.x, z.vents.y, z.vents.w, z.vents.h, 8, '#263241'));
  for (const j of ports) out.push(rj45(j.x, j.y, j.w, j.h));
  const cages = z.cages!;
  for (let i = 0; i < 2; i++) {
    out.push(sfpCage(cages.x, cages.y + cages.h / 2 - 10 + i * 11, cages.w, 9, opts.uplinkColor));
  }
  out.push(`<path d="M ${n(p.x + 7)} ${n(p.y + p.h - 3.2)} h ${n(Math.min(86, p.w * 0.22))}" stroke="${opts.accent}" stroke-width="2.2"/>`);
  out.push(brandBadge(device, p, opts.brandFill, opts.accent));
  return out;
}

function applianceFrontSkin(device: Device, p: Rect, opts: { faceplate: string; brandFill: string; accent: string; darkText?: boolean }): string[] {
  const out = base(device, p, { fill: opts.faceplate, darkText: opts.darkText });
  // The old layout drew vents at `p.w - 80` while ports ran to `p.w - 10`, so the
  // right-hand jacks sat on the slats. Both now derive from the reserved zones.
  const z = applianceFaceZones(p);
  const ports = portLayout(z.ports, devicePorts(device), {
    rows: 1,
    nameZone: 0,
    rightInset: 0,
    maxJack: 13,
  });
  for (const j of ports) out.push(rj45(j.x, j.y, j.w, j.h));
  out.push(...vent(z.vents.x, z.vents.y, z.vents.w, z.vents.h, 7, opts.darkText ? '#94a3b8' : '#111827'));
  out.push(`<rect x="${n(p.x + 8)}" y="${n(p.y + p.h - 7)}" width="24" height="3" rx="1" fill="${opts.accent}"/>`);
  out.push(`<rect x="${n(p.x + 36)}" y="${n(p.y + p.h - 7)}" width="24" height="3" rx="1" fill="${opts.darkText ? '#2563eb' : '#38bdf8'}"/>`);
  out.push(brandBadge(device, p, opts.brandFill, opts.accent, opts.darkText));
  return out;
}

function patchPanelSkin(device: Device, p: Rect): string[] {
  const out = base(device, p, { fill: 'url(#rkPatch)', darkText: true });
  // ONE row banked in 6s (W2a) — and the SAME opts devicePortLayout uses, so the
  // drawn ports sit exactly where the cable hit markers do. A 24-port panel is
  // 1×24, never 2×12.
  const ports = portLayout(p, devicePorts(device), {
    ...PATCH_PORT_OPTS,
    rows: patchPanelRows(devicePorts(device).length),
  });
  out.push(`<rect x="${n(p.x + 5)}" y="${n(p.y + 5)}" width="${n(p.w - 10)}" height="${n(p.h - 10)}" rx="2" fill="#dbe3ec" fill-opacity="0.34" stroke="#64748b" stroke-width="0.55"/>`);
  ports.forEach((j, i) => {
    out.push(`<rect x="${n(j.x)}" y="${n(j.y)}" width="${n(j.w)}" height="${n(j.h)}" rx="1" fill="#111827" stroke="#6b7280" stroke-width="0.65"/>`);
    out.push(`<rect x="${n(j.x + j.w / 2 - j.w * 0.17)}" y="${n(j.y + j.h - 2)}" width="${n(j.w * 0.34)}" height="2" fill="#030712"/>`);
    // Top row numbered above, bottom row below — as real two-row panels are marked,
    // and so row 2's numbers don't print on row 1's jacks.
    if (j.w >= 12) {
      const rows = patchPanelRows(ports.length);
      const isBottom = rows > 1 && i % rows === rows - 1;
      const ty = isBottom ? j.y + j.h + 5 : j.y - 1;
      out.push(`<text x="${n(j.x + j.w / 2)}" y="${n(ty)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="5" fill="#334155">${i + 1}</text>`);
    }
  });
  out.push(brandBadge(device, p, '#f8fafc', '#64748b', true));
  return out;
}

function upsFrontSkin(device: Device, p: Rect): string[] {
  const out = base(device, p, { fill: '#171d25' });
  // The vendor chip sits BELOW the model name, not over it. It used to be a
  // full-height panel drawn from p.y + 7, which covered the name `base()` had just
  // drawn at p.y + 18 — an APC UPS showed a red badge and an unreadable model.
  const badgeW = Math.min(72, p.w * 0.18);
  const chipH = 10;
  const chipY = Math.min(p.y + p.h - chipH - 5, p.y + p.h / 2 + 8);
  out.push(`<rect x="${n(p.x + 9)}" y="${n(chipY - 3)}" width="${n(badgeW)}" height="${n(chipH + 6)}" rx="2.5" fill="#111827" stroke="#475569" stroke-width="0.8"/>`);
  out.push(`<rect x="${n(p.x + 15)}" y="${n(chipY)}" width="${n(Math.max(26, badgeW - 12))}" height="${n(chipH)}" rx="1.8" fill="#7f1d1d" stroke="#ef4444" stroke-width="0.6"/>`);
  out.push(`<text x="${n(p.x + 15 + Math.max(26, badgeW - 12) / 2)}" y="${n(chipY + 7.6)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="6.5" font-weight="900" fill="#fee2e2">${safeText(device.vendor || 'UPS')}</text>`);
  // This skin previously drew a full-width vent block and NO outlets, so an APC UPS
  // read as a louvre panel and had nothing to plug into. Vents now stop where the
  // reserved outlet band begins, and the outlets are drawn from the same layout
  // hit-testing uses.
  const zu = upsFaceZones(p);
  // Vents occupy the battery zone — starting them at a fixed offset from the badge
  // let them clip the tail of the model name.
  const ventX = zu.battery.x;
  const ventW = Math.max(18, zu.outlets.x - 10 - ventX);
  out.push(...vent(ventX, p.y + 8, ventW, Math.max(12, p.h - 16), 20, '#0b1118'));
  for (const o of devicePortLayout(device, p)) out.push(outletGlyph(o.x, o.y, o.w, o.h));
  return out;
}

function serverRearSkin(device: Device, p: Rect): string[] {
  const out = base(device, p, { fill: '#1b2430' });
  const fanR = Math.min(p.h * 0.33, p.h >= 54 ? 13 : 10);
  const fanCount = p.h >= 54 ? 4 : 2;
  for (let i = 0; i < fanCount; i++) out.push(fan(p.x + 62 + i * (fanR * 2 + 7), p.y + p.h / 2, fanR));
  const ioX = p.x + 12;
  const ioY = p.y + Math.max(5, p.h * 0.18);
  out.push(`<rect x="${n(ioX)}" y="${n(ioY)}" width="36" height="${n(Math.max(15, p.h * 0.38))}" rx="2" fill="#08111a" stroke="#4b5563" stroke-width="0.75"/>`);
  out.push(rj45(ioX + 5, ioY + 4, 11, 8));
  out.push(`<rect x="${n(ioX + 20)}" y="${n(ioY + 4)}" width="10" height="8" rx="1.2" fill="#020617" stroke="#64748b" stroke-width="0.6"/>`);
  const psuW = Math.min(54, p.w * 0.13);
  const psuH = Math.min(p.h - 8, p.h >= 54 ? 34 : 24);
  const psuY = p.y + (p.h - psuH) / 2;
  for (let i = 0; i < 2; i++) {
    const x = p.x + p.w - 8 - (i + 1) * psuW - i * 6;
    out.push(`<rect x="${n(x)}" y="${n(psuY)}" width="${n(psuW)}" height="${n(psuH)}" rx="2" fill="#101821" stroke="#64748b" stroke-width="0.75"/>`);
    out.push(`<rect x="${n(x + psuW / 2 - 7)}" y="${n(psuY + psuH / 2 - 5)}" width="14" height="10" rx="1" fill="#030712" stroke="#64748b" stroke-width="0.55"/>`);
    out.push(`<circle cx="${n(x + 6)}" cy="${n(psuY + 5)}" r="1.5" fill="url(#rkLedG)"/>`);
    out.push(...vent(x + 5, psuY + psuH - 8, psuW - 10, 4, 6));
  }
  return out;
}

function networkRearSkin(device: Device, p: Rect): string[] {
  const out = base(device, p, { fill: '#232d39' });
  const psuW = Math.min(58, p.w * 0.14);
  out.push(`<rect x="${n(p.x + p.w - psuW - 9)}" y="${n(p.y + 6)}" width="${n(psuW)}" height="${n(p.h - 12)}" rx="2" fill="#101821" stroke="#64748b" stroke-width="0.8"/>`);
  out.push(`<rect x="${n(p.x + p.w - psuW / 2 - 8)}" y="${n(p.y + p.h / 2 - 5)}" width="16" height="10" rx="1" fill="#030712" stroke="#64748b" stroke-width="0.55"/>`);
  out.push(...vent(p.x + 70, p.y + Math.max(5, p.h * 0.22), Math.max(70, p.w * 0.34), Math.max(8, p.h * 0.5), 18));
  out.push(fan(p.x + 43, p.y + p.h / 2, Math.min(9, p.h * 0.28)));
  return out;
}

function upsRearSkin(device: Device, p: Rect): string[] {
  const out = base(device, p, { fill: '#161d25' });
  const cols = 6;
  const rows = p.h >= 54 ? 2 : 1;
  const outletW = Math.min(18, (p.w - 110) / cols - 3);
  const startX = p.x + 82;
  const startY = p.y + (p.h - rows * 14 - (rows - 1) * 4) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * (outletW + 5);
      const y = startY + r * 18;
      out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(outletW)}" height="14" rx="2" fill="#0b1118" stroke="#64748b" stroke-width="0.65"/>`);
      out.push(`<path d="M ${n(x + outletW * 0.35)} ${n(y + 4)} v 6 M ${n(x + outletW * 0.65)} ${n(y + 4)} v 6" stroke="#94a3b8" stroke-width="0.75"/>`);
    }
  }
  out.push(...vent(p.x + p.w - 72, p.y + 8, 52, Math.max(10, p.h - 16), 9));
  return out;
}
