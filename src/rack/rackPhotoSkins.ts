/**
 * Model-aware rack "photo skins" for known hardware.
 *
 * A skin is a brand THEME over the one realistic renderer (rackFaceArt): the plate
 * finish, accent and vendor badge change, the geometry does not — so a Cisco switch and
 * an unbranded one share the same port layout, cable hit points, and level of detail.
 * These are still deterministic SVG, not bundled manufacturer photos: live canvas,
 * thumbnails, SVG/PNG/PDF export, and local-first saves all stay portable. Exact approved
 * product photos can be supplied per device through `extra.rackPhotoFrontDataUri` /
 * `extra.rackPhotoRearDataUri` / `extra.rackPhotoDataUri` without a schema migration.
 */
import type { Device } from '@/model/types';
import { escapeXml } from '@/io/export/buildSvg';
import type { Rect } from './rackLayout';
import { frontFaceParts, rearFaceParts, type FaceTheme } from './rackFaceArt';
import { isRasterPhotoDataUri } from './rackPhotoUpload';

const n = (v: number) => v.toFixed(1);

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
  // Slice the raw text, then escape: cutting escaped text can split an entity.
  return escapeXml(value.slice(0, 120));
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

function familyFor(device: Device): SkinFamily | null {
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
  const parts = rackPhotoSkinPartsRaw(device, panel, face, hideLabel);
  // The device NAME label carries data-facelabel; brand badges / port numbers do
  // not, so hiding the name keeps the realistic faceplate intact.
  return hideLabel ? parts.filter((s) => !s.includes('data-facelabel')) : parts;
}

function rackPhotoSkinPartsRaw(device: Device, panel: Rect, face: RackFace, hide: boolean): string[] {
  const dataUri = dataUriForFace(device, face);
  if (dataUri) return customPhotoParts(device, panel, dataUri);
  const family = familyFor(device);
  if (!family) return [];
  const theme = themeFor(device, family);
  const fullDepth = family !== 'patch-panduit';
  if (face === 'rear' && fullDepth) return rearFaceParts(device, panel, theme, hide);
  return frontFaceParts(device, panel, theme, hide, true);
}

/** The brand look for a family: plate finish, accent, and the vendor badge. */
function themeFor(device: Device, family: SkinFamily): FaceTheme {
  // Only a named maker earns a badge; a family matched on type alone stays unbadged.
  const brand = device.vendor || device.model?.split(/\s+/)[0];
  const dark = (accent: string, fill: string, extra: Partial<FaceTheme> = {}): FaceTheme => ({
    plate: 'url(#rkMetal)',
    edge: '#06090d',
    ear: 'url(#rkEar)',
    text: '#eef5ff',
    textMut: '#9fb0c2',
    accent,
    ...(brand ? { badge: { text: brand, fill, ink: '#eef5ff' } } : {}),
    ...extra,
  });
  switch (family) {
    case 'server-dell':
      return dark('#60a5fa', '#0b1220', { bezel: 'honeycomb' });
    case 'server-hpe':
      return dark('#00b388', '#061f1b', { bezel: 'slats' });
    case 'storage-array':
      return dark('#38bdf8', '#101827');
    case 'switch-arista':
      return { ...dark('#2563eb', '#142033'), plate: 'url(#rkSilver)', ear: 'url(#rkSilver)', light: true };
    case 'switch-juniper':
      return dark('#84b135', '#123322');
    case 'firewall-fortinet':
      return { ...dark('#ee3124', '#3b0a0f'), plate: 'url(#rkOxblood)' };
    case 'firewall-palo':
      return { ...dark('#fa582d', '#263241'), plate: 'url(#rkWhite)', ear: 'url(#rkWhite)', light: true };
    case 'load-balancer':
      return dark('#e4002b', '#111827');
    case 'patch-panduit':
      return { ...dark('#64748b', '#f8fafc'), plate: 'url(#rkPatch)', ...(brand ? { badge: { text: brand, fill: '#f8fafc', ink: '#172033' } } : {}) };
    case 'ups-apc':
      return dark('#ef4444', '#7f1d1d', brand ? { badge: { text: brand, fill: '#7f1d1d', ink: '#fee2e2' } } : {});
    case 'switch-cisco':
    default:
      return dark('#049fd9', '#111827');
  }
}

function customPhotoParts(device: Device, p: Rect, href: string): string[] {
  const fontSize = Math.max(7, Math.min(10, p.h * 0.19));
  const maxChars = Math.max(8, Math.floor((p.w - 18) / (fontSize * 0.58)));
  return [
    `<rect x="${n(p.x)}" y="${n(p.y + 1.2)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="#020617" fill-opacity="0.34" filter="url(#rkDeviceShadow)"/>`,
    `<image href="${escapeXml(href)}" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none"/>`,
    `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="3" fill="none" stroke="#0a0e12" stroke-width="1"/>`,
    `<rect x="${n(p.x + 1.3)}" y="${n(p.y + 1.2)}" width="${n(p.w - 2.6)}" height="${n(Math.min(p.h * 0.3, 12))}" rx="2.4" fill="#ffffff" fill-opacity="0.14"/>`,
    `<text data-facelabel="1" x="${n(p.x + 8)}" y="${n(p.y + Math.min(p.h - 7, 16))}" font-family="ui-monospace,Menlo,monospace" font-size="${n(fontSize)}" font-weight="800" fill="#eef5ff">${safeText(fitText(modelLabel(device), maxChars))}</text>`,
  ];
}
