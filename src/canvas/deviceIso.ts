/**
 * Isometric 3D device icons (vendor-neutral, FossFLOW/AWS-architecture feel).
 *
 * Each device is modeled as a real volumetric object in a 2:1 isometric
 * projection: solid faces with top-light / left-mid / right-dark shading,
 * built from a few primitives (box, cylinder, sphere) plus thin detail strokes
 * (ports, LEDs, antennas). This replaces the old "stacked outline" fake-3D —
 * a router now reads as a router chassis with antennas, a switch as a rack box
 * with ports, a server as a tower with bays, etc.
 *
 * Output is trusted inner-SVG markup on a centered art canvas; callers scale it
 * via {@link deviceIsoGroup} (export) or the DeviceIso React component (canvas).
 * Per-device color comes from the shared gradient palette so the family stays
 * color-coded.
 */
import type { DeviceType } from '@/model/types';
import { deviceGradient, mixHex } from './deviceVisuals';

// 2:1 isometric projection (art units). x = right-depth, y = left-depth, z = up.
const UX = 1;
const UY = 0.5;
const UZ = 1;
const rnd = (n: number) => Math.round(n * 100) / 100;
type P2 = [number, number];
function pt(gx: number, gy: number, z: number): P2 {
  return [rnd((gx - gy) * UX), rnd((gx + gy) * UY - z * UZ)];
}
const join = (pts: P2[]) => pts.map((p) => `${p[0]},${p[1]}`).join(' ');

interface Shades {
  top: string;
  left: string;
  right: string;
  edge: string;
  /** Near-white rim along lit top edges (crisp specular silhouette). */
  rim: string;
  /** Soft sheen pooled in the back-light corner of the top face. */
  topHi: string;
}
function shades(c: string): Shades {
  return {
    top: mixHex(c, '#ffffff', 0.4),
    left: mixHex(c, '#ffffff', 0.11),
    right: mixHex(c, '#000000', 0.34),
    edge: mixHex(c, '#000000', 0.52),
    rim: mixHex(c, '#ffffff', 0.72),
    topHi: mixHex(c, '#ffffff', 0.58),
  };
}

function poly(pts: P2[], fill: string, edge?: string, sw = 0.7): string {
  const e = edge ? ` stroke="${edge}" stroke-width="${sw}" stroke-linejoin="round"` : '';
  return `<polygon points="${join(pts)}" fill="${fill}"${e}/>`;
}
function circle(c: P2, r: number, fill: string, edge?: string, sw = 0): string {
  const e = edge ? ` stroke="${edge}" stroke-width="${sw}"` : '';
  return `<circle cx="${c[0]}" cy="${c[1]}" r="${rnd(r)}" fill="${fill}"${e}/>`;
}
function ellipse(c: P2, rx: number, ry: number, fill: string, edge?: string, sw = 0): string {
  const e = edge ? ` stroke="${edge}" stroke-width="${sw}"` : '';
  return `<ellipse cx="${c[0]}" cy="${c[1]}" rx="${rnd(rx)}" ry="${rnd(ry)}" fill="${fill}"${e}/>`;
}
function line(a: P2, b: P2, stroke: string, sw: number): string {
  return `<path d="M${a[0]},${a[1]} L${b[0]},${b[1]}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" fill="none"/>`;
}

/** A solid isometric box. Footprint gx∈[x0,x0+W], gy∈[y0,y0+D], height H. */
function box(
  x0: number,
  y0: number,
  W: number,
  D: number,
  H: number,
  c: string,
  sw = 0.7,
): string {
  const s = shades(c);
  const A = pt(x0, y0, H);
  const B = pt(x0 + W, y0, H);
  const C = pt(x0 + W, y0 + D, H);
  const Dt = pt(x0, y0 + D, H);
  const Bb = pt(x0 + W, y0, 0);
  const Cb = pt(x0 + W, y0 + D, 0);
  const Db = pt(x0, y0 + D, 0);
  const mid = (p: P2, q: P2): P2 => [rnd((p[0] + q[0]) / 2), rnd((p[1] + q[1]) / 2)];
  const ctr: P2 = [rnd((A[0] + C[0]) / 2), rnd((A[1] + C[1]) / 2)];
  return (
    poly([B, C, Cb, Bb], s.right, s.edge, sw) + // right (gx = x0+W)
    poly([Dt, C, Cb, Db], s.left, s.edge, sw) + // left (gy = y0+D)
    poly([A, B, C, Dt], s.top, s.edge, sw) + // top
    // Soft sheen in the back (A) corner of the top face.
    `<polygon points="${join([A, mid(A, B), ctr, mid(A, Dt)])}" fill="${s.topHi}" opacity="0.4"/>` +
    // Crisp rim light along the two lit top edges.
    line(A, B, s.rim, 0.7) +
    line(A, Dt, s.rim, 0.7)
  );
}

/** A small square detail on the RIGHT face (gx = xR), centered at (gy,z). */
function rightPad(xR: number, gy: number, z: number, s: number, fill: string): string {
  return poly(
    [pt(xR, gy - s, z + s), pt(xR, gy + s, z + s), pt(xR, gy + s, z - s), pt(xR, gy - s, z - s)],
    fill,
  );
}
/** A horizontal slot line across the RIGHT face at height z. */
function rightSlot(xR: number, gy0: number, gy1: number, z: number, stroke: string, sw: number): string {
  return line(pt(xR, gy0, z), pt(xR, gy1, z), stroke, sw);
}

/** An isometric vertical cylinder centered at (gxc,gyc), radius R, base zb, height H. */
function cyl(
  gxc: number,
  gyc: number,
  R: number,
  zb: number,
  H: number,
  c: string,
  rings = 0,
): string {
  const s = shades(c);
  const top = pt(gxc, gyc, zb + H);
  const bot = pt(gxc, gyc, zb);
  const rx = R * Math.SQRT2 * UX;
  const ry = R * Math.SQRT2 * UY;
  const body =
    `<path d="M${top[0] - rx},${top[1]} L${bot[0] - rx},${bot[1]} ` +
    `A${rnd(rx)},${rnd(ry)} 0 0 0 ${bot[0] + rx},${bot[1]} ` +
    `L${top[0] + rx},${top[1]} A${rnd(rx)},${rnd(ry)} 0 0 1 ${top[0] - rx},${top[1]} Z" ` +
    `fill="${s.left}" stroke="${s.edge}" stroke-width="0.6"/>`;
  let ringMarkup = '';
  for (let i = 1; i <= rings; i++) {
    const z = zb + (H * i) / (rings + 1);
    const rc = pt(gxc, gyc, z);
    ringMarkup += `<path d="M${rc[0] - rx},${rc[1]} A${rnd(rx)},${rnd(ry)} 0 0 0 ${rc[0] + rx},${rc[1]}" fill="none" stroke="${s.edge}" stroke-width="0.5" opacity="0.7"/>`;
  }
  const topFace = ellipse(top, rx, ry, s.top, s.edge, 0.6);
  // Soft specular highlight on the top, offset toward the light (back-left).
  const hi = `<ellipse cx="${rnd(top[0] - rx * 0.3)}" cy="${rnd(top[1] - ry * 0.28)}" rx="${rnd(rx * 0.5)}" ry="${rnd(ry * 0.5)}" fill="${s.topHi}" opacity="0.5"/>`;
  // Vertical sheen streak down the lit side of the body.
  const streak = `<path d="M${rnd(top[0] - rx * 0.62)},${rnd(top[1] + ry * 0.4)} L${rnd(bot[0] - rx * 0.62)},${rnd(bot[1])}" stroke="${s.rim}" stroke-width="${rnd(rx * 0.18)}" stroke-linecap="round" fill="none" opacity="0.35"/>`;
  return body + streak + ringMarkup + topFace + hi;
}

/** Antenna: a thin rod rising from (gx,gy) on the top face, tilted slightly back. */
function antenna(gx: number, gy: number, baseZ: number, len: number, c: string): string {
  const base = pt(gx, gy, baseZ);
  const tip = pt(gx - 0.4, gy - 0.4, baseZ + len);
  return (
    line(base, tip, c, 1.3) + circle(tip, 1.1, mixHex(c, '#ffffff', 0.2))
  );
}

// Common neutral tones for hardware detail.
const DETAIL = '#e2e8f0';
const LED = '#fef08a';

function buildIso(type: DeviceType): string {
  const g = deviceGradient(type);
  const c = g.via; // body base color
  const dark = mixHex(c, '#000000', 0.45);

  switch (type) {
    case 'router': {
      // Low wide chassis + two antennas + status LEDs on top.
      const W = 15,
        D = 10,
        H = 4;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      p += antenna(W / 2 - 3, -D / 2 + 1.5, H, 9, dark);
      p += antenna(W / 2 - 6, -D / 2 + 1.5, H, 11, dark);
      // LED strip on top-front
      for (let i = 0; i < 4; i++)
        p += circle(pt(-W / 2 + 2.5 + i * 1.8, D / 2 - 1.5, H), 0.55, i === 0 ? '#4ade80' : LED);
      // vent slots on right face
      for (let i = 0; i < 3; i++)
        p += rightSlot(W / 2, -D / 2 + 2, D / 2 - 2, H * (0.3 + i * 0.22), dark, 0.5);
      return p;
    }
    case 'switch':
    case 'patch-panel': {
      // Flat 1U rack box with a row of ports on the front-right face.
      const W = 16,
        D = 9,
        H = 3;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      const ports = type === 'switch' ? 6 : 8;
      for (let i = 0; i < ports; i++) {
        const gy = -D / 2 + 1.6 + (i * (D - 3.2)) / (ports - 1);
        p += rightPad(W / 2, gy, H * 0.42, 0.7, DETAIL);
        // Per-port link LED above each jack (alternating green/amber).
        if (type === 'switch')
          p += circle(pt(W / 2, gy, H * 0.78), 0.32, i % 2 ? '#fbbf24' : '#4ade80');
      }
      p += circle(pt(-W / 2 + 1.6, -D / 2 + 1.4, H), 0.5, '#4ade80'); // top LED
      return p;
    }
    case 'server':
    case 'rack': {
      // Tall tower with stacked bays + LEDs.
      const W = 9,
        D = 9,
        H = 16;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      const bays = 5;
      for (let i = 0; i < bays; i++) {
        const z = H - 1.6 - i * (H / (bays + 0.5));
        p += rightSlot(W / 2, -D / 2 + 1.4, D / 2 - 1.4, z, dark, 0.7);
        // Drive-bay handle (small light pad) on the left of each bay.
        p += rightPad(W / 2, -D / 2 + 2.2, z, 0.45, DETAIL);
        p += circle(pt(W / 2, D / 2 - 1.2, z), 0.45, i % 2 ? LED : '#4ade80');
      }
      return p;
    }
    case 'firewall':
    case 'security-group': {
      // Brick "wall" block — box with a staggered brick pattern on both faces.
      const W = 14,
        D = 9,
        H = 9;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      const mortar = mixHex(c, '#ffffff', 0.28);
      // horizontal courses on right face
      for (let r = 1; r <= 3; r++) {
        const z = (H * r) / 4;
        p += rightSlot(W / 2, -D / 2, D / 2, z, mortar, 0.5);
      }
      // staggered vertical joints on right face
      for (let r = 0; r < 4; r++) {
        const z0 = (H * r) / 4;
        const z1 = (H * (r + 1)) / 4;
        const offset = r % 2 ? 0 : D / 4;
        p += line(pt(W / 2, -D / 4 + offset, z0), pt(W / 2, -D / 4 + offset, z1), mortar, 0.5);
        p += line(pt(W / 2, D / 4 + offset - D / 2, z0), pt(W / 2, D / 4 + offset, z1), mortar, 0.5);
      }
      if (type === 'security-group') {
        // small lock emblem on top
        p += circle(pt(0, 0, H), 1.4, mixHex(c, '#ffffff', 0.55));
      }
      return p;
    }
    case 'cloud':
    case 'cloud-subnet':
    case 'vpc': {
      // A puffy 3-D cloud (front-facing blob with top highlight + base shadow).
      const top = mixHex(c, '#ffffff', 0.42);
      const base = mixHex(c, '#ffffff', 0.04);
      const d =
        'M-11,4 a4.5,4.5 0 0 1 1.2,-8.6 a6,6 0 0 1 11.4,-2.2 a5,5 0 0 1 8.7,3.4 a4.2,4.2 0 0 1 -1.1,8.2 Z';
      let p = ellipse([1, 6], 11, 2.4, '#020617'); // soft ground shadow
      p = p.replace('fill="#020617"', 'fill="#020617" opacity="0.12"');
      p += `<path d="${d}" fill="${base}" stroke="${mixHex(c, '#000', 0.28)}" stroke-width="0.7" stroke-linejoin="round"/>`;
      p += `<path d="M-9,-3.6 a6,6 0 0 1 11.4,-2.2 a5,5 0 0 1 7,1.8 a14,5 0 0 1 -25.4,0.4 Z" fill="${top}" opacity="0.9"/>`;
      if (type === 'vpc' || type === 'cloud-subnet') {
        // dashed region marker beneath
        p += `<path d="M-10,8.5 h20" stroke="${mixHex(c, '#000', 0.25)}" stroke-width="0.7" stroke-dasharray="2 1.6" fill="none"/>`;
      }
      return p;
    }
    case 'storage':
    case 'managed-db':
    case 'object-storage': {
      // Stacked disk drum (database cylinder).
      let p = cyl(0, 0, 6, 0, 13, c, 2);
      if (type === 'managed-db') p += circle(pt(0, 0, 13), 1.3, mixHex(c, '#ffffff', 0.55));
      return p;
    }
    case 'access-point':
    case 'wireless-controller': {
      // Low puck/dome + Wi-Fi arcs radiating above.
      let p = cyl(0, 0, 6.5, 0, 2.8, c, 0);
      const arcC = mixHex(c, '#000000', 0.2);
      const apex = pt(0, 0, 2.8);
      for (let i = 1; i <= 3; i++) {
        const rr = 2.6 * i;
        p += `<path d="M${apex[0] - rr},${apex[1] - rr * 0.5 - 2} a${rr},${rr * 0.5} 0 0 1 ${rr * 2},0" fill="none" stroke="${arcC}" stroke-width="${1.2 - i * 0.15}" stroke-linecap="round" opacity="${1 - i * 0.18}"/>`;
      }
      p += circle([apex[0], apex[1] - 1.5], 0.9, arcC);
      return p;
    }
    case 'end-user':
    case 'printer': {
      // Monitor: a thin screen box on a small stand (front-right face = screen).
      const W = 14,
        D = 3.5,
        H = 9;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      // screen inset on right face
      p += rightPad(W / 2, 0, H * 0.5, 2.4, mixHex(c, '#020617', 0.55));
      // stand
      p += box(-2, -1, 4, 2, -3.2, mixHex(c, '#000', 0.15));
      if (type === 'printer') p += rightSlot(W / 2, -W / 4, W / 4, H * 0.85, DETAIL, 0.8);
      return p;
    }
    case 'load-balancer':
    case 'route-table':
    case 'nat-gateway':
    case 'internet-gateway': {
      // Routing box with a top emblem (arrows / table) for differentiation.
      const W = 13,
        D = 10,
        H = 6;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      const em = mixHex(c, '#ffffff', 0.5);
      if (type === 'route-table') {
        p += line(pt(-W / 2 + 1.5, 0, H), pt(W / 2 - 1.5, 0, H), em, 0.7);
        p += line(pt(0, -D / 2 + 1.5, H), pt(0, D / 2 - 1.5, H), em, 0.7);
      } else {
        // split / direction arrows on the top
        p += line(pt(-3, 0, H), pt(3, 0, H), em, 0.9);
        p += line(pt(1.5, -1.5, H), pt(3, 0, H), em, 0.9);
        p += line(pt(1.5, 1.5, H), pt(3, 0, H), em, 0.9);
      }
      for (let i = 0; i < 3; i++) p += circle(pt(-W / 2 + 2 + i * 1.6, D / 2 - 1.3, H), 0.5, LED);
      return p;
    }
    case 'vm':
    case 'container': {
      // Cube with a nested inset (VM) or corrugation (container) on the right face.
      const W = 11,
        D = 11,
        H = 11;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      if (type === 'vm') {
        // play triangle on right face
        const a = pt(W / 2, -1.6, H * 0.62);
        const b = pt(W / 2, 1.6, H * 0.5);
        const cc = pt(W / 2, -1.6, H * 0.38);
        p += poly([a, b, cc], DETAIL);
      } else {
        for (let i = 0; i < 4; i++) {
          const gy = -D / 2 + 1.4 + (i * (D - 2.8)) / 3;
          p += line(pt(W / 2, gy, 1), pt(W / 2, gy, H - 1), mixHex(c, '#000', 0.18), 0.6);
        }
      }
      return p;
    }
    case 'camera': {
      // Lens cylinder on a small mount.
      let p = box(-1.5, -1.5, 3, 3, 3, mixHex(c, '#000', 0.1));
      p += cyl(0, 0, 4.5, 3, 6, c, 0);
      p += circle(pt(0, 0, 9), 2.1, mixHex(c, '#020617', 0.5));
      p += circle(pt(-0.6, -0.6, 9), 0.8, '#bae6fd');
      return p;
    }
    case 'isp': {
      // Globe (sphere) on a base.
      const cc = pt(0, 0, 8);
      let p = cyl(0, 0, 3.5, 0, 1.5, mixHex(c, '#000', 0.1), 0);
      p += `<circle cx="${cc[0]}" cy="${cc[1]}" r="6.5" fill="${mixHex(c, '#ffffff', 0.12)}" stroke="${mixHex(c, '#000', 0.3)}" stroke-width="0.7"/>`;
      p += `<ellipse cx="${cc[0]}" cy="${cc[1]}" rx="6.5" ry="2.4" fill="none" stroke="${mixHex(c, '#ffffff', 0.4)}" stroke-width="0.6"/>`;
      p += `<ellipse cx="${cc[0]}" cy="${cc[1]}" rx="2.6" ry="6.5" fill="none" stroke="${mixHex(c, '#ffffff', 0.4)}" stroke-width="0.6"/>`;
      p += `<line x1="${cc[0] - 6.5}" y1="${cc[1]}" x2="${cc[0] + 6.5}" y2="${cc[1]}" stroke="${mixHex(c, '#ffffff', 0.4)}" stroke-width="0.6"/>`;
      p += `<circle cx="${cc[0] - 2}" cy="${cc[1] - 2}" r="2.2" fill="#ffffff" opacity="0.25"/>`;
      return p;
    }
    case 'k8s': {
      // Kubernetes helm: extruded heptagon + spokes.
      const R = 7;
      const cc = pt(0, 0, 7);
      const pts: P2[] = [];
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7;
        pts.push([rnd(cc[0] + R * Math.cos(a)), rnd(cc[1] + R * Math.sin(a))]);
      }
      const backPts = pts.map((p) => [p[0], p[1] + 3] as P2);
      let s = poly(backPts, mixHex(c, '#000', 0.32)); // extruded back
      // side strip
      s += poly([pts[3]!, pts[4]!, backPts[4]!, backPts[3]!], mixHex(c, '#000', 0.24));
      s += poly([pts[4]!, pts[5]!, backPts[5]!, backPts[4]!], mixHex(c, '#000', 0.24));
      s += poly(pts, mixHex(c, '#ffffff', 0.12), mixHex(c, '#000', 0.3), 0.7); // front face
      const em = mixHex(c, '#ffffff', 0.6);
      s += `<circle cx="${cc[0]}" cy="${cc[1]}" r="2.4" fill="none" stroke="${em}" stroke-width="0.8"/>`;
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7;
        s += line(cc, [rnd(cc[0] + R * 0.78 * Math.cos(a)), rnd(cc[1] + R * 0.78 * Math.sin(a))], em, 0.5);
      }
      return s;
    }
    case 'ups':
    case 'vpn-gateway': {
      // Battery/secure box with a bolt or lock emblem on the right face.
      const W = 11,
        D = 9,
        H = 11;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      const em = mixHex(c, '#ffffff', 0.6);
      if (type === 'ups') {
        // lightning bolt on right face
        p += `<path d="M${pt(W / 2, 1, H * 0.75).join(',')} L${pt(W / 2, -1.2, H * 0.5).join(',')} L${pt(W / 2, 0.2, H * 0.5).join(',')} L${pt(W / 2, -1.2, H * 0.25).join(',')}" fill="none" stroke="${em}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"/>`;
      } else {
        // padlock shackle + body
        const lc = pt(W / 2, 0, H * 0.45);
        p += rightPad(W / 2, 0, H * 0.42, 1.8, em);
        p += `<path d="M${lc[0] - 1.4},${lc[1] - 2.6} a1.4,2 0 0 1 2.8,0" fill="none" stroke="${em}" stroke-width="0.8"/>`;
      }
      return p;
    }
    case 'iot': {
      // Chip cube with pins.
      const W = 8,
        D = 8,
        H = 7;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      p += rightPad(W / 2, 0, H * 0.5, 1.8, mixHex(c, '#000', 0.3));
      const pin = mixHex(c, '#000', 0.2);
      for (let i = -1; i <= 1; i++) {
        p += line(pt(W / 2 + 0.2, i * 2, 0), pt(W / 2 + 1.6, i * 2, -1), pin, 0.7);
      }
      return p;
    }
    default: {
      // Generic node: a clean cube with a top dot.
      const W = 11,
        D = 11,
        H = 9;
      let p = box(-W / 2, -D / 2, W, D, H, c);
      p += circle(pt(0, 0, H), 1.5, mixHex(c, '#ffffff', 0.5));
      return p;
    }
  }
}

/** Inner SVG markup for the isometric device, centered roughly on (0,0). */
export function deviceIso(type: DeviceType): string {
  return buildIso(type);
}

/**
 * `<g>` markup placing the isometric icon at (cx,cy) scaled to `size`. The art
 * spans ~36 units; we scale so `size` is the nominal footprint and nudge up so
 * the volume is visually centered.
 */
export function deviceIsoGroup(
  type: DeviceType,
  cx: number,
  cy: number,
  size: number,
): string {
  const s = (size / 22) * 1.0;
  return `<g transform="translate(${cx} ${cy + size * 0.06}) scale(${rnd(s)})">${deviceIso(type)}</g>`;
}
