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
  generic: { glyph: '•', accent: '#6b7280' },
};

export function deviceVisual(type: DeviceType): DeviceVisual {
  return VISUALS[type] ?? VISUALS.generic;
}

/** Below this zoom, hide secondary detail; below the second, icons only (LOD). */
export const LOD_LABEL_HIDE = 0.5;
export const LOD_GLYPH_ONLY = 0.25;
