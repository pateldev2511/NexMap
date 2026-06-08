/**
 * Flat 2D device artwork — a detailed, multi-colored flat illustration per device
 * type that resembles the real hardware. No background tile. Bodies use a 3-tone
 * scheme (lit top band / base / shadowed bottom band) for flat depth; LEDs, ports,
 * screens and stroked detail lines add realism.
 *
 * Authored in a 0..24 box, centered ~ (12,12); scaled by {@link deviceIconFlatGroup}.
 * Markup is a trusted compile-time constant (no user input).
 */
import type { DeviceType } from '@/model/types';

// --- shape helpers -------------------------------------------------------------
const r = (x: number, y: number, w: number, h: number, rad: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad}" ry="${rad}" fill="${fill}"/>`;
const c = (cx: number, cy: number, rad: number, fill: string) =>
  `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}"/>`;
const p = (d: string, fill: string) => `<path d="${d}" fill="${fill}"/>`;
/** Stroked path (for visible detail lines — meridians, arrows, vents, grids). */
const sp = (d: string, stroke: string, w = 1, dash?: string) =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${
    dash ? ` stroke-dasharray="${dash}"` : ''
  }/>`;
/** A row of n ports/jacks. */
const ports = (x0: number, y: number, n: number, gap: number, w: number, h: number, fill: string) =>
  Array.from({ length: n }, (_, i) => r(x0 + i * gap, y, w, h, 0.3, fill)).join('');

const GREEN = '#4ade80';
const AMBER = '#fbbf24';
const RED = '#f87171';
const WHITE = '#ffffff';

const ART: Record<DeviceType, string> = {
  router:
    // thin antennas with ball tips
    r(6.6, 3, 0.95, 7.5, 0.45, '#1e3a8a') +
    c(7.05, 3, 1.05, '#60a5fa') +
    r(16.4, 3, 0.95, 7.5, 0.45, '#1e3a8a') +
    c(16.85, 3, 1.05, '#60a5fa') +
    // low wide chassis (lit top / shadowed bottom)
    r(2, 10, 20, 9, 2.4, '#2563eb') +
    r(2, 10, 20, 3.1, 2.4, '#3b82f6') +
    r(2, 16.4, 20, 2.6, 2.4, '#1d4ed8') +
    r(11.5, 13.4, 8, 2, 1, '#bfdbfe') + // signal bar
    c(5.6, 14.4, 1, GREEN) +
    c(8.2, 14.4, 1, AMBER),
  switch:
    r(2, 9, 20, 8, 1.8, '#0d9488') +
    r(2, 9, 20, 2.5, 1.8, '#14b8a6') +
    r(2, 14.6, 20, 2.4, 1.8, '#0f766e') +
    ports(4, 11.9, 6, 2.7, 1.9, 2.2, '#0f3f3a') +
    Array.from({ length: 6 }, (_, i) => c(4.95 + i * 2.7, 11, 0.36, i % 2 ? AMBER : GREEN)).join(''),
  firewall:
    p('M12 2.4l8.2 3v6.4c0 5.1-3.5 8.6-8.2 10-4.7-1.4-8.2-4.9-8.2-10V5.4z', '#dc2626') +
    p('M12 2.4l8.2 3v6.4c0 5.1-3.5 8.6-8.2 10V2.4z', '#b91c1c') +
    sp('M4 8.6h16M4 13h16', '#fca5a5', 0.7) + // brick courses
    // flame emblem
    p('M12 7.4c1.7 1.5 2.5 3 2.5 4.8 0 1.8-1.2 3.1-2.5 3.1s-2.5-1.1-2.5-2.7c0-.9.4-1.7 1-2.4-.1 1 .5 1.7 1 1.7.7 0 1-.6.7-1.5-.2-1 .1-2.3.8-3z', AMBER),
  'access-point':
    sp('M4.5 9.5a10.5 10.5 0 0 1 15 0', '#c4b5fd', 1.4) +
    sp('M7.3 12.2a6.6 6.6 0 0 1 9.4 0', '#a78bfa', 1.4) +
    // dome body
    p('M4.5 19a7.5 7.5 0 0 1 15 0z', '#7c3aed') +
    p('M6.5 16.4a5.5 5.5 0 0 1 8 -2.4 5.5 5.5 0 0 0 -8 2.4z', '#8b5cf6') + // sheen
    r(4, 18.4, 16, 2.4, 1.2, '#6d28d9') +
    c(12, 16.6, 1, WHITE),
  'wireless-controller':
    sp('M6.8 9a7.5 7.5 0 0 1 10.4 0', '#a78bfa', 1.3) +
    sp('M9.2 11.6a3.9 3.9 0 0 1 5.6 0', '#c4b5fd', 1.3) +
    r(3.5, 13.5, 17, 6.5, 1.6, '#6d28d9') +
    r(3.5, 13.5, 17, 2.2, 1.6, '#7c3aed') +
    r(3.5, 17.6, 17, 2.4, 1.6, '#5b21b6') +
    c(6.5, 16.4, 0.9, GREEN) +
    c(9.2, 16.4, 0.9, AMBER),
  server:
    r(5, 2.5, 14, 19, 2, '#059669') +
    r(5, 2.5, 14, 3, 2, '#10b981') +
    r(5, 18, 14, 3.5, 2, '#047857') +
    Array.from({ length: 3 }, (_, i) => {
      const y = 5 + i * 4.2;
      return (
        r(6.4, y, 11.2, 3.2, 0.7, '#067a55') +
        r(7.2, y + 0.9, 2.4, 1.4, 0.3, '#a7f3d0') + // drive handle
        c(15.6, y + 1.6, 0.65, i === 1 ? AMBER : GREEN)
      );
    }).join(''),
  storage:
    p('M5 7c0-1.9 3.1-3.2 7-3.2s7 1.3 7 3.2v10c0 1.9-3.1 3.2-7 3.2s-7-1.3-7-3.2z', '#0f766e') +
    p('M5 7c0 1.9 3.1 3.2 7 3.2s7-1.3 7-3.2v-0 c0 1.9-3.1 3.2-7 3.2s-7-1.3-7-3.2z', '#14b8a6') +
    sp('M5 11.8c0 1.9 3.1 3.2 7 3.2s7-1.3 7-3.2', '#0d9488', 0.8) +
    sp('M5 7c0 1.9 3.1 3.2 7 3.2s7-1.3 7-3.2', '#5eead4', 0.8) +
    c(8.3, 6.6, 0.7, '#5eead4'),
  'load-balancer':
    r(2.5, 9, 6.5, 6, 1.4, '#d97706') +
    r(2.5, 9, 6.5, 2.2, 1.4, '#f59e0b') +
    sp('M9 12h3.5M12.5 12V5.2h4M12.5 12h4M12.5 12v6.8h4', '#fcd34d', 1.1) +
    c(18.5, 5.2, 2.5, '#f59e0b') +
    c(18.5, 12, 2.5, '#fbbf24') +
    c(18.5, 18.8, 2.5, '#f59e0b') +
    c(18.5, 5.2, 0.9, WHITE) +
    c(18.5, 12, 0.9, WHITE) +
    c(18.5, 18.8, 0.9, WHITE),
  'end-user':
    r(2.5, 3.5, 19, 12.5, 1.8, '#1e293b') +
    r(3.9, 4.9, 16.2, 9.1, 1, '#38bdf8') +
    p('M3.9 4.9h16.2v4.4 l-16.2 2.6z', '#7dd3fc') + // screen reflection
    c(19, 14.6, 0.45, GREEN) + // power LED
    r(9.3, 16, 5.4, 3, 0.6, '#334155') + // neck
    r(6.8, 19, 10.4, 1.8, 0.9, '#475569'), // base
  printer:
    r(7.5, 1.6, 9, 3, 0.4, '#f1f5f9') + // paper in tray
    r(6, 4, 12, 2.6, 0.8, '#a8a29e') + // tray lip
    r(3.5, 8, 17, 9, 1.6, '#78716c') +
    r(3.5, 8, 17, 2.6, 1.6, '#a8a29e') +
    r(3.5, 14.4, 17, 2.6, 1.6, '#57534e') +
    r(5, 9.4, 4.6, 1.9, 0.4, '#292524') + // control panel
    c(11.1, 10.35, 0.5, GREEN) +
    r(6.5, 15.2, 11, 4.4, 0.6, '#f8fafc') + // output sheet
    sp('M7.8 16.6h8.4M7.8 18.2h6.6', '#cbd5e1', 0.7),
  iot:
    r(7.5, 7.5, 9, 9, 1.6, '#65a30d') +
    r(7.5, 7.5, 9, 2.6, 1.6, '#84cc16') +
    r(9.8, 9.8, 4.4, 4.4, 0.8, '#bef264') +
    sp('M10 7.5V4.6M14 7.5V4.6M10 19.4v-2.9M14 19.4v-2.9M7.5 10H4.6M7.5 14H4.6M19.4 10h-2.9M19.4 14h-2.9', '#3f6212', 1) +
    c(15, 9, 0.5, GREEN),
  isp:
    c(12, 12, 9, '#0ea5e9') +
    p('M12 3a9 9 0 0 1 0 18 9 9 0 0 1 0-18z', '#0284c7') +
    sp('M3 12h18', '#e0f2fe', 0.9) +
    sp('M12 3c2.6 2.4 3.9 5.5 3.9 9s-1.3 6.6-3.9 9c-2.6-2.4-3.9-5.5-3.9-9s1.3-6.6 3.9-9z', '#bae6fd', 0.9) +
    sp('M5.4 7.4h13.2M5.4 16.6h13.2', '#bae6fd', 0.8) +
    c(8.6, 8.4, 1.8, '#7dd3fc'),
  cloud:
    p('M7.4 18.6h9.6a4.3 4.3 0 0 0 .4-8.6 5.5 5.5 0 0 0-10.5-1.6A3.9 3.9 0 0 0 7.4 18.6z', '#0ea5e9') +
    p('M7.4 18.6h9.6a4.3 4.3 0 0 0 3-7.4 5.5 5.5 0 0 0-2.6 1.2 4.3 4.3 0 0 1-1 6.2z', '#0284c7') +
    p('M6.5 9.6a5.5 5.5 0 0 1 9.9-1 4.3 4.3 0 0 1 1.3 .8 5.7 5.7 0 0 0-11.2 .2z', '#7dd3fc'),
  vm:
    r(2.5, 4, 19, 13.5, 1.8, '#16a34a') +
    r(2.5, 4, 19, 2.8, 1.8, '#22c55e') +
    c(4.6, 5.4, 0.55, '#bbf7d0') +
    c(6.2, 5.4, 0.55, '#bbf7d0') +
    r(5.5, 8.4, 13, 6.6, 1, '#052e16') + // inner window
    sp('M7.5 11h9M7.5 13h6.4', '#34d399', 0.9) +
    p('M14.6 9.6l3 1.9-3 1.9z', '#bbf7d0') + // play
    r(6.5, 18.6, 11, 1.8, 0.9, '#15803d'), // base
  container:
    p('M12 2.8l8.4 4.4v9.6L12 21.2l-8.4-4.4V7.2z', '#0891b2') +
    p('M12 12l8.4-4.8V16.8L12 21.2z', '#0e7490') +
    p('M12 2.8l8.4 4.4L12 12 3.6 7.2z', '#22d3ee') +
    sp('M12 12v9.2M12 12l8.4-4.8M12 12L3.6 7.2', '#155e75', 0.8) +
    sp('M6.2 8.6v9M9.1 10.2v9M14.9 10.2v9M17.8 8.6v9', '#0e7490', 0.7),
  rack:
    r(4.5, 2.5, 15, 19, 1.6, '#475569') +
    r(4.5, 2.5, 15, 2, 1.6, '#64748b') +
    Array.from({ length: 4 }, (_, i) => {
      const y = 5 + i * 4;
      return r(6, y, 12, 3.2, 0.5, i === 2 ? '#334155' : '#5b6b80') + c(8, y + 1.6, 0.6, i % 2 ? AMBER : GREEN);
    }).join(''),
  'patch-panel':
    r(2.5, 7.5, 19, 9, 1.6, '#52525b') +
    r(2.5, 7.5, 19, 2, 1.6, '#71717a') +
    r(3.6, 9.9, 16.8, 1.1, 0.3, '#e4e4e7') + // label strip
    ports(4, 11.6, 6, 2.9, 2.1, 1.7, '#27272a') +
    ports(4, 13.7, 6, 2.9, 2.1, 1.7, '#27272a') +
    c(3.4, 12, 0.45, '#a1a1aa') +
    c(20.6, 12, 0.45, '#a1a1aa'),
  ups:
    r(5, 3, 14, 18, 1.8, '#d97706') +
    r(5, 3, 14, 3, 1.8, '#f59e0b') +
    r(5, 18, 14, 3, 1.8, '#b45309') +
    p('M13 7.5l-3.6 5.5h3.1l-2 5 6.2-7h-3.2z', '#fde68a') + // bolt
    c(8, 5.5, 0.7, GREEN),
  camera:
    r(7, 18, 10, 2.8, 1.3, '#6b21a8') + // mount
    p('M4.5 18a7.5 7.5 0 0 1 15 0z', '#581c87') + // dome
    p('M6.6 15.6a5.4 5.4 0 0 1 7.4 -2.6 5.4 5.4 0 0 0 -7.4 2.6z', '#a855f7') + // sheen
    c(12.2, 14.6, 2.5, '#1a1033') + // lens
    c(11.3, 13.7, 0.95, '#c4b5fd') + // glint
    c(16.7, 15.4, 0.7, RED), // rec LED
  vpc:
    r(2.5, 4, 19, 16, 2.4, '#0c4a6e') +
    sp('M3.6 5.1h17.8v13.8h-17.8z', '#7dd3fc', 1, '2.4 1.8') + // dashed region
    r(5.5, 9, 5, 3.4, 0.7, '#0ea5e9') +
    r(13.5, 9, 5, 3.4, 0.7, '#0ea5e9') +
    r(9.5, 14, 5, 3.4, 0.7, '#38bdf8') +
    sp('M8 12.4l3 1.6M16 12.4l-3 1.6', '#bae6fd', 0.9),
  'cloud-subnet':
    r(2.5, 5, 19, 14, 2.2, '#0369a1') +
    sp('M12 5.6v12.8', '#bae6fd', 0.9, '2 1.6') +
    r(4.6, 8, 4.6, 2.8, 0.5, '#0ea5e9') +
    r(4.6, 12.5, 4.6, 2.8, 0.5, '#38bdf8') +
    r(14.8, 8, 4.6, 2.8, 0.5, '#38bdf8') +
    r(14.8, 12.5, 4.6, 2.8, 0.5, '#0ea5e9'),
  'internet-gateway':
    c(9, 12, 6.6, '#0284c7') +
    sp('M2.4 12h13.2', '#e0f2fe', 0.9) +
    sp('M9 5.4c1.7 1.8 2.5 4.1 2.5 6.6s-.8 4.8-2.5 6.6M9 5.4C7.3 7.2 6.5 9.5 6.5 12s.8 4.8 2.5 6.6', '#bae6fd', 0.9) +
    r(14.8, 9.2, 6.2, 5.6, 1.2, '#f59e0b') +
    sp('M16 12h3.6M18 10.2l1.8 1.8-1.8 1.8', '#fff7ed', 1.2),
  'nat-gateway':
    r(7.5, 5.5, 9, 13, 1.8, '#0369a1') +
    r(7.5, 5.5, 9, 2.6, 1.8, '#0ea5e9') +
    sp('M2.6 9.5h9.4M10 7.6l2 1.9-2 1.9', '#bae6fd', 1.2) +
    sp('M21.4 14.5h-9.4M14 12.6l-2 1.9 2 1.9', '#7dd3fc', 1.2),
  'route-table':
    r(3.5, 3.5, 17, 17, 1.8, '#6366f1') +
    r(3.5, 3.5, 17, 4, 1.8, '#818cf8') +
    sp('M3.5 11h17M3.5 15.5h17M9.5 7.5v13', '#c7d2fe', 1) +
    c(6.5, 5.5, 0.8, '#e0e7ff'),
  'security-group':
    p('M12 2.4l8.2 3v6.4c0 5.1-3.5 8.6-8.2 10-4.7-1.4-8.2-4.9-8.2-10V5.4z', '#db2777') +
    p('M12 2.4l8.2 3v6.4c0 5.1-3.5 8.6-8.2 10V2.4z', '#be185d') +
    c(12, 11.4, 3, '#fbcfe8') +
    c(12, 11.4, 1.3, '#9d174d') +
    sp('M12 8.4v-1.6M12 16v-1.6M8.6 11.4H7M17 11.4h-1.6', '#fce7f3', 1.1),
  'vpn-gateway':
    r(5.5, 11, 13, 9, 1.6, '#6d28d9') +
    r(5.5, 11, 13, 2.4, 1.6, '#8b5cf6') +
    r(5.5, 17.4, 13, 2.6, 1.6, '#5b21b6') +
    sp('M8.6 11V8.4a3.4 3.4 0 0 1 6.8 0V11', '#c4b5fd', 1.4) +
    c(12, 15.4, 1.7, '#ddd6fe') +
    r(11.1, 15.4, 1.8, 3.2, 0.6, '#ddd6fe'),
  k8s:
    p('M12 2.6l8 3.8v7.6l-8 3.8-8-3.8V6.4z', '#326ce5') +
    p('M12 12l8-3.8v6 l-8 3.8z', '#2456c0') +
    p('M12 2.6l8 3.8L12 12 4 6.4z', '#4f8def') +
    c(12, 10.4, 2.5, '#dbeafe') +
    sp('M12 4.6v3.3M17 7.4l-2.6 1.6M17 13l-2.6-1.6M12 16v-3.3M7 13l2.6-1.6M7 7.4l2.6 1.6', '#bfdbfe', 0.9),
  'managed-db':
    p('M5 7c0-1.9 3.1-3.2 7-3.2s7 1.3 7 3.2v10c0 1.9-3.1 3.2-7 3.2s-7-1.3-7-3.2z', '#0891b2') +
    p('M5 7c0 1.9 3.1 3.2 7 3.2s7-1.3 7-3.2', '#22d3ee') +
    sp('M5 11.8c0 1.9 3.1 3.2 7 3.2s7-1.3 7-3.2', '#0e7490', 0.8) +
    c(16.8, 16.8, 4, GREEN) +
    sp('M14.9 16.8l1.4 1.4 2.5-2.7', '#064e3b', 1.3),
  'object-storage':
    p('M5 7.5h14l-1.4 11.6a1 1 0 0 1-1 .9H7.4a1 1 0 0 1-1-.9z', '#0d9488') +
    p('M12 7.5h7l-1.4 11.6a1 1 0 0 1-1 .9H12z', '#0f766e') +
    p('M5 7.5l1-3.3a1 1 0 0 1 1-.8h10a1 1 0 0 1 1 .8l1 3.3z', '#14b8a6') +
    sp('M9 11h6M9.5 14.6h5', '#99f6e4', 1),
  generic:
    p('M12 2.8l8 4.6v9.2L12 21.2 4 16.6V7.4z', '#64748b') +
    p('M12 12l8-4.6v9.2L12 21.2z', '#475569') +
    p('M12 2.8l8 4.6L12 12 4 7.4z', '#94a3b8') +
    c(12, 11.6, 2.4, '#cbd5e1') +
    c(12, 11.6, 1.1, '#f1f5f9'),
};

/** Detailed flat illustration markup (0..24 box) for a device type. */
export function deviceFlatArt(type: DeviceType): string {
  return ART[type] ?? ART.generic;
}
