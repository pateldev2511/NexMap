/**
 * Consistent device visual language (design review DA-DES-4.3).
 *
 * NexMap uses its own vendor-neutral icon language: compact 24x24 line icons
 * over device-family accent colors. The tiny `glyph` fallback is only used at
 * extreme zoom levels where a full icon would collapse into noise.
 */
import type { DeviceType } from '@/model/types';
import { deviceFlatArt } from './deviceFlatArt';

export interface DeviceVisual {
  glyph: string;
  accent: string;
}

export interface DeviceGradient {
  from: string;
  via: string;
  to: string;
  glow: string;
}

const VISUALS: Record<DeviceType, DeviceVisual> = {
  router: { glyph: 'R', accent: '#2563eb' },
  switch: { glyph: 'SW', accent: '#0891b2' },
  firewall: { glyph: 'FW', accent: '#dc2626' },
  'access-point': { glyph: 'AP', accent: '#7c3aed' },
  'wireless-controller': { glyph: 'WLC', accent: '#6d28d9' },
  server: { glyph: 'SRV', accent: '#059669' },
  storage: { glyph: 'STG', accent: '#0d9488' },
  'load-balancer': { glyph: 'LB', accent: '#ca8a04' },
  'end-user': { glyph: 'PC', accent: '#64748b' },
  printer: { glyph: 'PRN', accent: '#78716c' },
  iot: { glyph: 'IoT', accent: '#65a30d' },
  isp: { glyph: 'ISP', accent: '#0369a1' },
  cloud: { glyph: 'CLD', accent: '#3b82f6' },
  vm: { glyph: 'VM', accent: '#16a34a' },
  container: { glyph: 'CT', accent: '#0ea5e9' },
  rack: { glyph: 'RK', accent: '#475569' },
  'patch-panel': { glyph: 'PP', accent: '#52525b' },
  ups: { glyph: 'UPS', accent: '#d97706' },
  camera: { glyph: 'CAM', accent: '#9333ea' },
  vpc: { glyph: 'VPC', accent: '#0ea5e9' },
  'cloud-subnet': { glyph: 'SUB', accent: '#38bdf8' },
  'internet-gateway': { glyph: 'IGW', accent: '#0284c7' },
  'nat-gateway': { glyph: 'NAT', accent: '#0369a1' },
  'route-table': { glyph: 'RT', accent: '#6366f1' },
  'security-group': { glyph: 'SG', accent: '#db2777' },
  'vpn-gateway': { glyph: 'VPN', accent: '#7c3aed' },
  k8s: { glyph: 'K8S', accent: '#326ce5' },
  'managed-db': { glyph: 'DB', accent: '#0891b2' },
  'object-storage': { glyph: 'OBJ', accent: '#0d9488' },
  generic: { glyph: 'ND', accent: '#6b7280' },
};

export function deviceVisual(type: DeviceType): DeviceVisual {
  return VISUALS[type] ?? VISUALS.generic;
}

const GRADIENTS: Record<DeviceType, DeviceGradient> = {
  router: { from: '#38bdf8', via: '#2563eb', to: '#a78bfa', glow: '#60a5fa' },
  switch: { from: '#67e8f9', via: '#0891b2', to: '#34d399', glow: '#22d3ee' },
  firewall: { from: '#fb7185', via: '#dc2626', to: '#f59e0b', glow: '#f43f5e' },
  'access-point': { from: '#c084fc', via: '#7c3aed', to: '#22d3ee', glow: '#a78bfa' },
  'wireless-controller': {
    from: '#ddd6fe',
    via: '#6d28d9',
    to: '#38bdf8',
    glow: '#a78bfa',
  },
  server: { from: '#86efac', via: '#059669', to: '#22d3ee', glow: '#34d399' },
  storage: { from: '#5eead4', via: '#0d9488', to: '#60a5fa', glow: '#2dd4bf' },
  'load-balancer': { from: '#fde68a', via: '#ca8a04', to: '#fb7185', glow: '#facc15' },
  'end-user': { from: '#cbd5e1', via: '#64748b', to: '#38bdf8', glow: '#94a3b8' },
  printer: { from: '#d6d3d1', via: '#78716c', to: '#60a5fa', glow: '#a8a29e' },
  iot: { from: '#d9f99d', via: '#65a30d', to: '#22c55e', glow: '#a3e635' },
  isp: { from: '#7dd3fc', via: '#0369a1', to: '#818cf8', glow: '#38bdf8' },
  cloud: { from: '#93c5fd', via: '#3b82f6', to: '#c084fc', glow: '#60a5fa' },
  vm: { from: '#86efac', via: '#16a34a', to: '#22d3ee', glow: '#4ade80' },
  container: { from: '#7dd3fc', via: '#0ea5e9', to: '#a78bfa', glow: '#38bdf8' },
  rack: { from: '#cbd5e1', via: '#475569', to: '#22d3ee', glow: '#94a3b8' },
  'patch-panel': { from: '#d4d4d8', via: '#52525b', to: '#38bdf8', glow: '#a1a1aa' },
  ups: { from: '#fde68a', via: '#d97706', to: '#fb7185', glow: '#fbbf24' },
  camera: { from: '#e9d5ff', via: '#9333ea', to: '#f472b6', glow: '#c084fc' },
  vpc: { from: '#67e8f9', via: '#0ea5e9', to: '#818cf8', glow: '#38bdf8' },
  'cloud-subnet': { from: '#bae6fd', via: '#38bdf8', to: '#34d399', glow: '#7dd3fc' },
  'internet-gateway': {
    from: '#7dd3fc',
    via: '#0284c7',
    to: '#facc15',
    glow: '#38bdf8',
  },
  'nat-gateway': { from: '#38bdf8', via: '#0369a1', to: '#34d399', glow: '#0ea5e9' },
  'route-table': { from: '#a5b4fc', via: '#6366f1', to: '#22d3ee', glow: '#818cf8' },
  'security-group': {
    from: '#f9a8d4',
    via: '#db2777',
    to: '#f97316',
    glow: '#f472b6',
  },
  'vpn-gateway': { from: '#c4b5fd', via: '#7c3aed', to: '#22d3ee', glow: '#a78bfa' },
  k8s: { from: '#93c5fd', via: '#326ce5', to: '#22d3ee', glow: '#60a5fa' },
  'managed-db': { from: '#67e8f9', via: '#0891b2', to: '#a78bfa', glow: '#22d3ee' },
  'object-storage': { from: '#5eead4', via: '#0d9488', to: '#facc15', glow: '#2dd4bf' },
  generic: { from: '#cbd5e1', via: '#6b7280', to: '#38bdf8', glow: '#94a3b8' },
};

export function deviceGradient(type: DeviceType): DeviceGradient {
  return GRADIENTS[type] ?? GRADIENTS.generic;
}

/**
 * Pictographic icon per device type. Each entry is trusted inner SVG markup on
 * a 0-24 grid, painted by the caller with solid colors or gradients. The family is
 * vendor-neutral: rounded strokes, small port dots, and infrastructure-specific
 * silhouettes instead of product logos.
 */
const DEVICE_ICONS: Record<DeviceType, string> = {
  router:
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 4v4.8M12 15.2V20M4 12h4.8M15.2 12H20"/><path d="M6.2 6.2l3.4 3.4M14.4 14.4l3.4 3.4M17.8 6.2l-3.4 3.4M9.6 14.4l-3.4 3.4"/>',
  switch:
    '<rect x="3" y="6" width="18" height="10" rx="2"/><path d="M7 16v3M12 16v3M17 16v3"/><rect x="6" y="9" width="2" height="2" rx=".4" fill="#fff" stroke="none"/><rect x="11" y="9" width="2" height="2" rx=".4" fill="#fff" stroke="none"/><rect x="16" y="9" width="2" height="2" rx=".4" fill="#fff" stroke="none"/>',
  firewall:
    '<path d="M12 3.5l7 2.7v5.5c0 4.6-3 7.4-7 8.8-4-1.4-7-4.2-7-8.8V6.2z"/><path d="M6 10h12M6.5 14h11M9 6.8V10M15 10v4M10 14v4"/>',
  'access-point':
    '<path d="M4.5 10a10.5 10.5 0 0 1 15 0"/><path d="M7.8 13.2a6.2 6.2 0 0 1 8.4 0"/><path d="M10.4 16a2.4 2.4 0 0 1 3.2 0"/><circle cx="12" cy="18.5" r="1.2" fill="#fff" stroke="none"/>',
  'wireless-controller':
    '<rect x="4" y="13" width="16" height="6" rx="1.5"/><path d="M7 10a7 7 0 0 1 10 0"/><path d="M9.5 7.2a10 10 0 0 1 5 0"/><circle cx="8" cy="16" r="1" fill="#fff" stroke="none"/><circle cx="12" cy="16" r="1" fill="#fff" stroke="none"/><circle cx="16" cy="16" r="1" fill="#fff" stroke="none"/>',
  server:
    '<rect x="4" y="4" width="16" height="5.5" rx="1.2"/><rect x="4" y="10.8" width="16" height="5.5" rx="1.2"/><rect x="4" y="17.5" width="16" height="2.5" rx="1.2"/><circle cx="7.5" cy="6.8" r=".8" fill="#fff" stroke="none"/><circle cx="7.5" cy="13.5" r=".8" fill="#fff" stroke="none"/><path d="M11 6.8h5M11 13.5h5"/>',
  storage:
    '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v11.5c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 11.8c0 1.7 3.1 3 7 3s7-1.3 7-3"/><path d="M5 16.5c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  'load-balancer':
    '<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7.2 12H11M11 12V6h6M11 12h6M11 12v6h6"/><path d="M14.5 4.5 17 6l-2.5 1.5M14.5 10.5 17 12l-2.5 1.5M14.5 16.5 17 18l-2.5 1.5"/>',
  'end-user':
    '<rect x="3.5" y="5" width="17" height="11" rx="1.5"/><path d="M8.5 20h7M12 16v4"/><path d="M7 8h10"/>',
  printer:
    '<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="7.5" rx="1.5"/><rect x="7" y="14" width="10" height="6"/><path d="M8.5 17h7"/><circle cx="17" cy="11.5" r=".9" fill="#fff" stroke="none"/>',
  iot: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="10" y="10" width="4" height="4" rx=".8"/><path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3"/>',
  isp: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.1 2.1 3.2 4.8 3.2 8s-1.1 5.9-3.2 8M12 4c-2.1 2.1-3.2 4.8-3.2 8s1.1 5.9 3.2 8"/><path d="M6.5 7.5h11M6.5 16.5h11"/>',
  cloud:
    '<path d="M7 18h10a4 4 0 0 0 .3-8 5.2 5.2 0 0 0-9.9-1.5A3.6 3.6 0 0 0 7 18z"/><circle cx="10" cy="14" r="1" fill="#fff" stroke="none"/><circle cx="14" cy="14" r="1" fill="#fff" stroke="none"/><path d="M11 14h2"/>',
  vm: '<rect x="4" y="6" width="13" height="13" rx="2"/><path d="M7 3h13v13"/><path d="M10 10l4 2.5-4 2.5z" fill="#fff" stroke="none"/>',
  container:
    '<path d="M12 3.5 18 7v7l-6 3.5L6 14V7z"/><path d="M6 7l6 3.5L18 7M12 10.5v7"/><path d="M4 15.5 12 20l8-4.5"/>',
  rack: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 3v18M16 3v18M5 8h14M5 13h14M5 18h14"/><circle cx="10.5" cy="5.5" r=".7" fill="#fff" stroke="none"/><circle cx="10.5" cy="10.5" r=".7" fill="#fff" stroke="none"/><circle cx="10.5" cy="15.5" r=".7" fill="#fff" stroke="none"/>',
  'patch-panel':
    '<rect x="3" y="7.5" width="18" height="9" rx="1.5"/><path d="M3 12h18"/><rect x="6" y="10" width="2" height="2" rx=".4" fill="#fff" stroke="none"/><rect x="11" y="10" width="2" height="2" rx=".4" fill="#fff" stroke="none"/><rect x="16" y="10" width="2" height="2" rx=".4" fill="#fff" stroke="none"/><rect x="8.5" y="13" width="2" height="2" rx=".4" fill="#fff" stroke="none"/><rect x="13.5" y="13" width="2" height="2" rx=".4" fill="#fff" stroke="none"/>',
  ups: '<rect x="4" y="7" width="15" height="10" rx="1.5"/><path d="M19 10v4"/><path d="M12.5 8.8 9.7 13h3.4l-2 4.2"/><path d="M6.5 19.5h10"/>',
  camera:
    '<path d="M4 9.5h4l1.3-2h5.4l1.3 2h4v8h-16z"/><circle cx="12" cy="13.5" r="3"/><circle cx="12" cy="13.5" r="1" fill="#fff" stroke="none"/>',
  vpc: '<rect x="3" y="5" width="18" height="14" rx="2.5" stroke-dasharray="3 2"/><path d="M8 12h8M12 8v8"/><circle cx="8" cy="12" r="1" fill="#fff" stroke="none"/><circle cx="12" cy="8" r="1" fill="#fff" stroke="none"/><circle cx="16" cy="12" r="1" fill="#fff" stroke="none"/><circle cx="12" cy="16" r="1" fill="#fff" stroke="none"/>',
  'cloud-subnet':
    '<rect x="3" y="5" width="18" height="14" rx="2.5" stroke-dasharray="2 2"/><path d="M3 12h18M12 5v14"/><rect x="6.5" y="8" width="3" height="2.5" rx=".5" fill="#fff" stroke="none"/><rect x="14.5" y="14" width="3" height="2.5" rx=".5" fill="#fff" stroke="none"/>',
  'internet-gateway':
    '<circle cx="9.5" cy="12" r="6"/><path d="M3.5 12h8M10 6c1.5 1.6 2.3 3.6 2.3 6s-.8 4.4-2.3 6M14 12h6M17.8 9.8 20 12l-2.2 2.2"/>',
  'nat-gateway':
    '<rect x="8" y="7" width="8" height="10" rx="1.5"/><path d="M4 9h10M11.5 6.5 14 9l-2.5 2.5"/><path d="M20 15H10M12.5 12.5 10 15l2.5 2.5"/>',
  'route-table':
    '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14h16M10 5v14"/><path d="M12.5 16.5h3.5v-4M14.5 10.8 16 12.5l-1.5 1.7"/>',
  'security-group':
    '<path d="M12 3.5l7 2.7v5.5c0 4.6-3 7.4-7 8.8-4-1.4-7-4.2-7-8.8V6.2z"/><circle cx="12" cy="12" r="2.3"/><path d="M12 9.7V7.5M12 16.5v-2.2M9.7 12H7.5M16.5 12h-2.2"/>',
  'vpn-gateway':
    '<rect x="6" y="11" width="12" height="8" rx="1.5"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/><path d="M4 15h2M18 15h2M12 19v2"/>',
  k8s: '<path d="M12 3.5 19 7.5v8l-7 4-7-4v-8z"/><circle cx="12" cy="11.5" r="2.5"/><path d="M12 3.5v5.5M18.9 7.5l-4.7 2.7M18.9 15.5l-4.7-2.7M12 19.5V14M5.1 15.5l4.7-2.7M5.1 7.5l4.7 2.7"/>',
  'managed-db':
    '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v11.5c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/><path d="M9.4 17.5l1.7 1.6 3.6-3.7"/>',
  'object-storage':
    '<path d="M5 7h14l-1.5 12h-11z"/><path d="M5 7l1-3h12l1 3"/><path d="M8 11h8M8.5 15h7"/>',
  generic:
    '<path d="M12 4 19 8v8l-7 4-7-4V8z"/><circle cx="12" cy="12" r="2.5"/><path d="M12 4v5.5M19 8l-4.8 2.8M19 16l-4.8-2.8M12 20v-5.5M5 16l4.8-2.8M5 8l4.8 2.8"/>',
};

export function deviceIcon(type: DeviceType, fillColor = '#fff'): string {
  return (DEVICE_ICONS[type] ?? DEVICE_ICONS.generic).replaceAll('#fff', fillColor);
}

/** SVG `<g>` markup that renders the icon centered at (cx,cy) at `size`. */
export function deviceIconGroup(
  type: DeviceType,
  cx: number,
  cy: number,
  size: number,
  color = '#fff',
  strokeWidth = 2,
  fillColor = color,
): string {
  const s = size / 24;
  return (
    `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})" ` +
    `stroke="${color}" stroke-width="${strokeWidth}" ` +
    `fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `${deviceIcon(type, fillColor)}</g>`
  );
}

export function mixHex(base: string, target: string, targetWeight: number): string {
  const parse = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const n = Number.parseInt(m[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const a = parse(base);
  const b = parse(target);
  if (!a || !b) return base;
  const keep = 1 - targetWeight;
  const c = {
    r: Math.round(a.r * keep + b.r * targetWeight),
    g: Math.round(a.g * keep + b.g * targetWeight),
    b: Math.round(a.b * keep + b.b * targetWeight),
  };
  return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function iconGradientId(type: DeviceType, cx: number, cy: number, size: number): string {
  return `nex-icon-${type}-${Math.round(cx * 10)}-${Math.round(cy * 10)}-${Math.round(size * 10)}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '-',
  );
}

/** SVG markup for the freestanding, layered 3D device icon used by exports. */
export function deviceIcon3DGroup(
  type: DeviceType,
  cx: number,
  cy: number,
  size: number,
  accent: string,
): string {
  const grad = deviceGradient(type);
  const id = iconGradientId(type, cx, cy, size);
  const mainId = `${id}-main`;
  const depthId = `${id}-depth`;
  const rimId = `${id}-rim`;
  const glowId = `${id}-glow`;
  const depthA = mixHex(grad.via, '#020617', 0.24);
  const depthB = mixHex(grad.to, '#020617', 0.46);
  return [
    `<defs>`,
    `<linearGradient id="${mainId}" x1="${cx - size * 0.58}" y1="${cy - size * 0.56}" x2="${cx + size * 0.58}" y2="${cy + size * 0.56}" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0%" stop-color="${grad.from}"/><stop offset="48%" stop-color="${grad.via}"/><stop offset="100%" stop-color="${grad.to}"/>`,
    `</linearGradient>`,
    `<linearGradient id="${depthId}" x1="${cx - size * 0.35}" y1="${cy - size * 0.2}" x2="${cx + size * 0.46}" y2="${cy + size * 0.58}" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0%" stop-color="${depthA}"/><stop offset="100%" stop-color="${depthB}"/>`,
    `</linearGradient>`,
    `<linearGradient id="${rimId}" x1="${cx - size * 0.48}" y1="${cy - size * 0.5}" x2="${cx + size * 0.25}" y2="${cy + size * 0.28}" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0%" stop-color="#fff" stop-opacity="0.9"/><stop offset="42%" stop-color="${grad.from}" stop-opacity="0.72"/><stop offset="100%" stop-color="${grad.to}" stop-opacity="0.16"/>`,
    `</linearGradient>`,
    `<radialGradient id="${glowId}" cx="${cx}" cy="${cy + size * 0.06}" r="${size * 0.72}" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0%" stop-color="${grad.glow}" stop-opacity="0.28"/><stop offset="72%" stop-color="${accent}" stop-opacity="0.08"/><stop offset="100%" stop-color="${grad.glow}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `</defs>`,
    `<ellipse cx="${cx}" cy="${cy + size * 0.1}" rx="${size * 0.66}" ry="${size * 0.54}" fill="url(#${glowId})" opacity="0.86"/>`,
    `<ellipse cx="${cx + size * 0.06}" cy="${cy + size * 0.42}" rx="${size * 0.52}" ry="${size * 0.16}" fill="#020617" opacity="0.14"/>`,
    deviceIconGroup(
      type,
      cx + size * 0.08,
      cy + size * 0.1,
      size,
      `url(#${depthId})`,
      4.1,
    ),
    deviceIconGroup(
      type,
      cx + size * 0.03,
      cy + size * 0.045,
      size,
      `url(#${depthId})`,
      3.2,
    ),
    deviceIconGroup(type, cx, cy, size, `url(#${mainId})`, 2.35),
    deviceIconGroup(
      type,
      cx - size * 0.025,
      cy - size * 0.035,
      size,
      `url(#${rimId})`,
      0.9,
    ),
  ].join('');
}

/**
 * Flat 2D device icon: a detailed, multi-colored flat illustration that resembles
 * the real hardware (see {@link deviceFlatArt}), with NO background tile. The art is
 * authored in a 0..24 box, so we just translate+scale it to (cx,cy,size).
 *
 * Used only in flat projection; iso keeps the 3D {@link deviceIcon3DGroup}/deviceIso.
 */
export function deviceIconFlatGroup(
  type: DeviceType,
  cx: number,
  cy: number,
  size: number,
): string {
  const s = size / 24;
  const x = cx - size / 2;
  const y = cy - size / 2;
  return `<g data-flat-icon="1" transform="translate(${x} ${y}) scale(${s})">${deviceFlatArt(type)}</g>`;
}

/** Below this zoom, hide secondary detail; below the second, icons only (LOD). */
export const LOD_LABEL_HIDE = 0.5;
export const LOD_GLYPH_ONLY = 0.25;
