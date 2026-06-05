/**
 * Consistent device visual language (design review DA-DES-4.3).
 *
 * MVP uses one coherent set: a short glyph + an accent color per device family,
 * not mixed vendor logos. Real line/duotone icons land in M8 polish; this keeps
 * the canvas legible and consistent until then.
 */
import type { DeviceType } from '@/model/types';

export interface DeviceVisual {
  glyph: string;
  accent: string;
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
  cloud: { glyph: '☁', accent: '#3b82f6' },
  vm: { glyph: 'VM', accent: '#16a34a' },
  container: { glyph: 'CT', accent: '#0ea5e9' },
  rack: { glyph: '▤', accent: '#475569' },
  'patch-panel': { glyph: 'PP', accent: '#52525b' },
  ups: { glyph: 'UPS', accent: '#d97706' },
  camera: { glyph: '◉', accent: '#9333ea' },
  vpc: { glyph: 'VPC', accent: '#0ea5e9' },
  'cloud-subnet': { glyph: 'SUB', accent: '#38bdf8' },
  'internet-gateway': { glyph: 'IGW', accent: '#0284c7' },
  'nat-gateway': { glyph: 'NAT', accent: '#0369a1' },
  'route-table': { glyph: 'RT', accent: '#6366f1' },
  'security-group': { glyph: 'SG', accent: '#db2777' },
  'vpn-gateway': { glyph: 'VPN', accent: '#7c3aed' },
  k8s: { glyph: 'K8s', accent: '#326ce5' },
  'managed-db': { glyph: 'DB', accent: '#0891b2' },
  'object-storage': { glyph: 'OBJ', accent: '#0d9488' },
  generic: { glyph: '•', accent: '#6b7280' },
};

export function deviceVisual(type: DeviceType): DeviceVisual {
  return VISUALS[type] ?? VISUALS.generic;
}

/**
 * Pictographic icon per device type (Phase 9.7) — a consistent, line-art set so
 * every node reads as an icon, not a letter badge, in both flat and iso. Each is
 * inner SVG markup on a 0–24 grid, rendered white over the accent. Drawn with a
 * single coherent stroke language (no mixed vendor logos) per design review.
 */
const DEVICE_ICONS: Record<DeviceType, string> = {
  router:
    '<path d="M5 9h12"/><path d="M14 6l3 3-3 3"/><path d="M19 15H7"/><path d="M10 12l-3 3 3 3"/>',
  switch:
    '<rect x="3" y="6" width="18" height="7" rx="1.5"/><path d="M7 13v5M12 13v5M17 13v5"/>',
  firewall:
    '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 9.7v4.6M9 14.3V19"/>',
  'access-point':
    '<path d="M5 11a10 10 0 0 1 14 0"/><path d="M8 14a6 6 0 0 1 8 0"/><circle cx="12" cy="17" r="1.3" fill="#fff" stroke="none"/>',
  'wireless-controller':
    '<rect x="4" y="13" width="16" height="6" rx="1"/><path d="M7 10a7 7 0 0 1 10 0"/><circle cx="12" cy="16" r="1" fill="#fff" stroke="none"/>',
  server:
    '<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/><circle cx="8" cy="7" r="1" fill="#fff" stroke="none"/><circle cx="8" cy="17" r="1" fill="#fff" stroke="none"/>',
  storage:
    '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12a7 3 0 0 0 14 0V6"/><path d="M5 12a7 3 0 0 0 14 0"/>',
  'load-balancer':
    '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 12h3M12 12V7h5M12 12h5M12 12v5h5"/>',
  'end-user':
    '<rect x="3" y="5" width="18" height="11" rx="1"/><path d="M9 20h6M12 16v4"/>',
  printer:
    '<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="7" rx="1"/><rect x="7" y="14" width="10" height="5"/><circle cx="17" cy="11" r="1" fill="#fff" stroke="none"/>',
  iot: '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3"/>',
  isp: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a12 8 0 0 1 0 16M12 4a12 8 0 0 0 0 16"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1.3A3.5 3.5 0 0 0 7 18z"/>',
  vm: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 9l5 3-5 3z" fill="#fff" stroke="none"/>',
  container:
    '<rect x="4" y="10" width="6" height="6"/><rect x="11" y="10" width="6" height="6"/><rect x="7.5" y="4" width="6" height="6"/>',
  rack: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M5 8h14M5 13h14M5 18h14"/>',
  'patch-panel':
    '<rect x="3" y="8" width="18" height="8" rx="1"/><circle cx="7" cy="12" r="1.2" fill="#fff" stroke="none"/><circle cx="11" cy="12" r="1.2" fill="#fff" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="#fff" stroke="none"/>',
  ups: '<rect x="4" y="7" width="15" height="10" rx="1"/><path d="M19 10v4"/><path d="M12 9l-2.5 4h3L10 17"/>',
  camera:
    '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.2" fill="#fff" stroke="none"/>',
  vpc: '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2"/><rect x="8" y="10" width="8" height="5" rx="1"/>',
  'cloud-subnet':
    '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="2 2"/><path d="M3 12h18"/>',
  'internet-gateway':
    '<circle cx="9" cy="12" r="6"/><path d="M3 12h8M12 6a10 8 0 0 1 0 12"/><path d="M14 12h6l-2-2M20 12l-2 2"/>',
  'nat-gateway':
    '<path d="M4 9h11l-3-3M4 9l3 3"/><path d="M20 15H9l3 3M20 15l-3-3"/>',
  'route-table':
    '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M4 14h16M12 5v14"/>',
  'security-group':
    '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  'vpn-gateway':
    '<rect x="6" y="11" width="12" height="8" rx="1"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/>',
  k8s: '<path d="M12 3l7 4v8l-7 4-7-4V7z"/><circle cx="12" cy="11" r="2.5"/>',
  'managed-db':
    '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12a7 3 0 0 0 14 0V6"/><path d="M5 12a7 3 0 0 0 14 0"/>',
  'object-storage': '<path d="M5 7h14l-1.5 12h-11z"/><path d="M5 7l1-3h12l1 3"/>',
  generic: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
};

export function deviceIcon(type: DeviceType): string {
  return DEVICE_ICONS[type] ?? DEVICE_ICONS.generic;
}

/** SVG `<g>` markup that renders the icon white, centered at (cx,cy) at `size`. */
export function deviceIconGroup(
  type: DeviceType,
  cx: number,
  cy: number,
  size: number,
): string {
  const s = size / 24;
  return (
    `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})" ` +
    `stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" ` +
    `stroke-linejoin="round">${deviceIcon(type)}</g>`
  );
}

/** Below this zoom, hide secondary detail; below the second, icons only (LOD). */
export const LOD_LABEL_HIDE = 0.5;
export const LOD_GLYPH_ONLY = 0.25;
