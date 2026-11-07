/**
 * The 2D canvas skin: a product render of each device, drawn the way the real
 * hardware looks on a desk, in a rack or in a ceiling — anodized and brushed
 * metal, glass screens, RJ45 cavities with link lights, drive caddies, vents,
 * rubber antennas. Logical cloud objects are rendered as physical stand-ins
 * (a frosted-glass region, a chrome padlock, a steel bucket) in the same light.
 *
 * One light, top-left; every surface is a gradient lit from there, with a
 * hairline specular edge where a face turns toward it and a shadowed edge where
 * it turns away. The family accent survives as a detail (a bezel stripe, an
 * LED ring, a badge) so a diagram stays colour-coded without toy-coloured gear.
 *
 * Authored on the shared 0..24 grid (see iconSystem.ts) and scaled by
 * {@link deviceIconFlatGroup}. Gradients are defined ONCE per document, not per
 * node: an icon's markup only references ids namespaced by type
 * (`nxa-<type>-<n>`), and each SVG root that draws icons includes
 * {@link FLAT_ART_DEFS} (the canvas, the library) or {@link deviceFlatDefs} for
 * the types it uses (an export). On a 1,000-node diagram that is ~14,000 fewer
 * elements than per-icon defs. No transforms, no patterns — the geometry stays
 * measurable by iconBounds. Markup is a trusted compile-time constant.
 */
import type { DeviceType } from '@/model/types';

type Stop = readonly [offset: number, color: string, opacity?: number];

/** Status-light colours, shared with the rest of the canvas. */
const GREEN = '#4ade80';
const AMBER = '#fbbf24';
const RED = '#f87171';
const BLUE = '#60a5fa';

/** Materials: top → bottom stops of the lit gradient each surface uses. */
const M = {
  black: ['#56606c', '#333a44', '#1c2128'],
  charcoal: ['#5d6672', '#3a414b', '#22272e'],
  silver: ['#f4f6f8', '#c9d0d8', '#9aa4af'],
  white: ['#ffffff', '#eef1f4', '#cfd6de'],
  steel: ['#dfe5ea', '#a9b4bf', '#6f7b87'],
} as const;

const f = (v: number) => +v.toFixed(2);

/**
 * Builds one icon: collects gradient defs (ids namespaced by type) and shapes,
 * then emits `<defs>…</defs>` + body. Methods return `this` or a paint url.
 */
class Kit {
  private defs: string[] = [];
  private body: string[] = [];
  private n = 0;
  constructor(private readonly type: string) {}

  private id() {
    return `nxa-${this.type}-${this.n++}`;
  }
  private stops(s: readonly Stop[]) {
    return s
      .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`)
      .join('');
  }
  /** Linear gradient in grid units (userSpaceOnUse). */
  lin(x1: number, y1: number, x2: number, y2: number, s: readonly Stop[]): string {
    const id = this.id();
    this.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${this.stops(s)}</linearGradient>`,
    );
    return `url(#${id})`;
  }
  /** Radial gradient in grid units; (fx,fy) is the hot spot. */
  rad(cx: number, cy: number, r: number, s: readonly Stop[], fx = cx, fy = cy): string {
    const id = this.id();
    this.defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fx="${f(fx)}" fy="${f(fy)}">${this.stops(s)}</radialGradient>`,
    );
    return `url(#${id})`;
  }
  /** Vertical material gradient over [y, y+h]. */
  mat(y: number, h: number, m: readonly string[]): string {
    return this.lin(0, y, 0, y + h, [
      [0, m[0]!],
      [0.45, m[1]!],
      [1, m[2]!],
    ]);
  }
  /** Horizontal cylinder shading over [x, x+w] (lit left of centre). */
  cyl(x: number, w: number, dark: string, lit: string): string {
    return this.lin(x, 0, x + w, 0, [
      [0, dark],
      [0.3, lit],
      [0.55, lit],
      [1, dark],
    ]);
  }

  rect(x: number, y: number, w: number, h: number, rx: number, fill: string, extra = ''): this {
    this.body.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${rx ? ` rx="${f(rx)}"` : ''} fill="${fill}"${extra}/>`,
    );
    return this;
  }
  circ(cx: number, cy: number, r: number, fill: string, extra = ''): this {
    this.body.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"${extra}/>`);
    return this;
  }
  ell(cx: number, cy: number, rx: number, ry: number, fill: string, extra = ''): this {
    this.body.push(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}"${extra}/>`);
    return this;
  }
  path(d: string, fill: string, extra = ''): this {
    this.body.push(`<path d="${d}" fill="${fill}"${extra}/>`);
    return this;
  }
  /** A stroked detail line (detail pen range: FLAT_DETAIL_STROKE). */
  line(d: string, stroke: string, w: number, extra = ''): this {
    this.body.push(
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`,
    );
    return this;
  }
  /** Hairline specular edge along the top of a lit face. */
  spec(x: number, y: number, w: number, a = 0.55): this {
    return this.rect(x, y, w, 0.3, 0.15, '#ffffff', ` opacity="${a}"`);
  }
  /**
   * A live status LED: a baked bloom under a classed core that pulses (CSS
   * animates only the core's opacity, staggered by a negative delay so a bank
   * blinks out of phase). `warn` blinks faster; reduced motion freezes it lit.
   */
  led(cx: number, cy: number, r: number, color: string, delayMs = 0, warn = false): this {
    this.circ(cx, cy, r * 2.2, color, ' opacity="0.22"');
    this.body.push(
      `<circle class="nxLed${warn ? ' nxLedWarn' : ''}" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${color}" style="animation-delay:${delayMs}ms"/>`,
    );
    return this;
  }
  /** A powered display: a breathing tint plus a scanline (inline base opacity keeps exports still). */
  screen(x: number, y: number, w: number, h: number, rx: number, tint = '#dbf4ff'): this {
    this.rect(x, y, w, h, rx, tint, ' class="nxScreen" opacity="0.14"');
    this.rect(x, y, w, 0.8, 0.4, '#ffffff', ` class="nxScan" opacity="0" style="--scanH:${f(Math.max(h - 1, 0))}"`);
    return this;
  }
  /** Glass reflection: a soft diagonal sheen across a screen's upper half. */
  glare(x: number, y: number, w: number, h: number): this {
    const g = this.lin(x, y, x + w * 0.6, y + h, [
      [0, '#ffffff', 0.32],
      [0.5, '#ffffff', 0.06],
      [1, '#ffffff', 0],
    ]);
    return this.path(`M${f(x)} ${f(y)}h${f(w * 0.72)}l${f(-w * 0.34)} ${f(h)}H${f(x)}z`, g);
  }
  /** An RJ45 jack: silver shield, dark cavity with the latch notch, optional link light. */
  rj45(x: number, y: number, w: number, h: number, link?: string, delay = 0): this {
    this.rect(x, y, w, h, 0.15, '#aeb7c1');
    this.rect(x + 0.14, y + 0.14, w - 0.28, h - 0.28, 0.1, '#07090c');
    this.rect(x + w * 0.32, y + h - 0.42, w * 0.36, 0.28, 0, '#2a3038');
    if (link) this.circ(x + w * 0.24, y + 0.32, 0.17, link, ` class="nxLed" style="animation-delay:${delay}ms"`);
    return this;
  }
  /** An SFP cage: a steel frame around a dark slot. */
  sfp(x: number, y: number, w: number, h: number): this {
    this.rect(x, y, w, h, 0.12, '#c3cad2');
    return this.rect(x + 0.16, y + h * 0.3, w - 0.32, h * 0.44, 0.08, '#05070a');
  }
  /** A rack ear with its mounting screw. */
  ear(x: number, y: number, w: number, h: number): this {
    this.rect(x, y, w, h, 0.3, this.mat(y, h, M.charcoal));
    this.circ(x + w / 2, y + h / 2, Math.min(w, h) * 0.24, '#11151a');
    return this.circ(x + w / 2 - 0.08, y + h / 2 - 0.08, Math.min(w, h) * 0.1, '#7d8792');
  }
  /** Vent slots: n short dark bars across [x, x+w]. */
  vents(x: number, y: number, w: number, h: number, n: number, color = '#0d1014'): this {
    const step = w / n;
    for (let i = 0; i < n; i++) this.rect(x + i * step + step * 0.22, y, step * 0.5, h, step * 0.2, color);
    return this;
  }
  /** Perforated mesh: rows of dots drawn as dashed strokes (no <pattern>, so it stays measurable). */
  mesh(x: number, y: number, w: number, h: number, pitch: number, color = '#0b0e12'): this {
    const rows = Math.max(1, Math.floor(h / pitch));
    for (let r = 0; r < rows; r++) {
      const yy = y + pitch / 2 + r * pitch;
      const off = r % 2 ? pitch / 2 : 0;
      this.line(`M${f(x + off + 0.2)} ${f(yy)}H${f(x + w - 0.2)}`, color, 0.42, ` stroke-dasharray="0.01 ${f(pitch)}"`);
    }
    return this;
  }
  /** Soft contact shadow on the surface the device stands on. */
  shadow(cx: number, cy: number, rx: number, ry: number, a = 0.35): this {
    const g = this.rad(cx, cy, rx, [
      [0, '#020617', a],
      [1, '#020617', 0],
    ]);
    return this.ell(cx, cy, rx, ry, g);
  }

  /** The gradient definitions (no wrapper) and the shapes that use them. */
  build(): Art {
    return { defs: this.defs.join(''), body: this.body.join('') };
  }
}

interface Art {
  defs: string;
  body: string;
}

const art = (type: DeviceType, draw: (k: Kit) => void): Art => {
  const k = new Kit(type);
  draw(k);
  return k.build();
};

/** Wi-Fi arcs (stroked, fading outward) centred on (cx, cy). */
function wifi(k: Kit, cx: number, cy: number, radii: readonly number[], color: string) {
  radii.forEach((r, i) => {
    const a = (Math.PI * 38) / 180;
    const dx = r * Math.sin(a);
    const dy = r * Math.cos(a);
    k.line(
      `M${f(cx - dx)} ${f(cy - dy)}A${r} ${r} 0 0 1 ${f(cx + dx)} ${f(cy - dy)}`,
      color,
      1.15,
      ` opacity="${f(1 - i * 0.22)}"`,
    );
  });
}

/** A desktop appliance seen slightly from above: a lit lid, a front face, rubber feet. */
function appliance(
  k: Kit,
  x: number,
  top: number,
  w: number,
  lidH: number,
  faceH: number,
  face: readonly string[] = M.black,
) {
  const inset = Math.min(1.2, w * 0.06);
  k.path(
    `M${f(x + inset)} ${f(top)}H${f(x + w - inset)}L${f(x + w)} ${f(top + lidH)}H${x}Z`,
    k.lin(0, top, 0, top + lidH, [
      [0, '#8a939e'],
      [1, '#4a525c'],
    ]),
  );
  k.spec(x + inset, top, w - inset * 2, 0.5);
  const fy = top + lidH;
  k.rect(x, fy, w, faceH, 0.5, k.mat(fy, faceH, face));
  k.spec(x + 0.3, fy + 0.1, w - 0.6, 0.35);
  k.rect(x + 0.3, fy + faceH - 0.35, w - 0.6, 0.3, 0.1, '#000000', ' opacity="0.35"');
}

/** Rubber feet under an appliance. */
function feet(k: Kit, x: number, w: number, y: number, h = 0.6) {
  k.rect(x + 1.2, y, 2.2, h, 0.25, '#0b0d10');
  k.rect(x + w - 3.4, y, 2.2, h, 0.25, '#0b0d10');
}

/** A shield outline (firewall / security group), scaled into [x0..x1] × [y0..y1]. */
function shieldPath(x0: number, y0: number, x1: number, y1: number): string {
  const cx = (x0 + x1) / 2;
  const w = x1 - x0;
  const h = y1 - y0;
  return (
    `M${f(cx)} ${f(y0)}` +
    `L${f(x1)} ${f(y0 + h * 0.15)}` +
    `V${f(y0 + h * 0.46)}` +
    `C${f(x1)} ${f(y0 + h * 0.74)} ${f(cx + w * 0.26)} ${f(y0 + h * 0.92)} ${f(cx)} ${f(y1)}` +
    `C${f(cx - w * 0.26)} ${f(y0 + h * 0.92)} ${f(x0)} ${f(y0 + h * 0.74)} ${f(x0)} ${f(y0 + h * 0.46)}` +
    `V${f(y0 + h * 0.15)}Z`
  );
}

/** A metallic cylinder (storage, databases): top ellipse, banded body, lit edge. */
function drum(k: Kit, x: number, top: number, w: number, h: number, ry: number, dark: string, lit: string, bands: number) {
  const cx = x + w / 2;
  const rx = w / 2;
  const by = top + h; // y of the bottom ellipse's centre
  k.path(
    `M${f(x)} ${f(top)}V${f(by)}A${f(rx)} ${f(ry)} 0 0 0 ${f(x + w)} ${f(by)}V${f(top)}Z`,
    k.cyl(x, w, dark, lit),
  );
  for (let i = 1; i <= bands; i++) {
    const y = top + (h * i) / (bands + 1);
    k.line(`M${f(x + 0.15)} ${f(y)}A${f(rx)} ${f(ry)} 0 0 0 ${f(x + w - 0.15)} ${f(y)}`, '#000000', 0.5, ' opacity="0.35"');
    k.line(`M${f(x + 0.15)} ${f(y + 0.4)}A${f(rx)} ${f(ry)} 0 0 0 ${f(x + w - 0.15)} ${f(y + 0.4)}`, '#ffffff', 0.3, ' opacity="0.3"');
  }
  k.ell(
    cx,
    top,
    rx,
    ry,
    k.rad(cx - rx * 0.3, top - ry * 0.3, rx * 1.2, [
      [0, '#ffffff'],
      [0.6, lit],
      [1, dark],
    ]),
  );
  k.ell(cx, top, rx * 0.62, ry * 0.58, '#000000', ' opacity="0.08"');
  k.ell(cx, top, rx * 0.2, ry * 0.18, '#ffffff', ' opacity="0.55"');
}

const ART: Record<DeviceType, Art> = {
  router: art('router', (k) => {
    // Two rubber antennas on hinge knuckles, behind the chassis.
    for (const ax of [5.3, 17.4]) {
      k.rect(ax, 2, 1.3, 8.6, 0.65, k.cyl(ax, 1.3, '#0d1014', '#4a525d'));
      k.rect(ax - 0.15, 8.8, 1.6, 1.4, 0.35, '#2b3139');
    }
    appliance(k, 2, 9.6, 20, 1.6, 7.6);
    k.rect(2.8, 16.3, 4.6, 0.45, 0.2, '#2563eb');
    k.led(3.8, 13.4, 0.42, GREEN, -300).led(5.2, 13.4, 0.42, BLUE, -900).led(6.6, 13.4, 0.42, AMBER, -620, true);
    for (let i = 0; i < 4; i++) k.rj45(10.8 + i * 2.55, 12.5, 2.1, 1.9, i < 3 ? GREEN : undefined, -i * 230);
    k.rect(10.8, 15.1, 9.75, 0.3, 0.1, '#ffffff', ' opacity="0.12"');
    feet(k, 2, 20, 18.4);
  }),

  switch: art('switch', (k) => {
    // 1U, 24 ports in two staggered rows banked in sixes, two SFP uplinks, rack ears.
    k.path('M3.2 9H20.8L22 10.2H2Z', k.lin(0, 9, 0, 10.2, [[0, '#8a939e'], [1, '#4f5761']]));
    k.rect(2, 10.2, 20, 6.4, 0.35, k.mat(10.2, 6.4, M.black));
    k.spec(2.4, 10.25, 19.2, 0.4);
    k.ear(2, 10.2, 0.95, 6.4).ear(21.05, 10.2, 0.95, 6.4);
    k.led(3.75, 11.7, 0.32, GREEN, -200).led(3.75, 13.1, 0.32, AMBER, -760, true);
    k.rect(3.1, 14.6, 1.4, 0.9, 0.15, '#1f252c').rect(3.3, 14.8, 1, 0.5, 0.1, '#0b0e12');
    for (let col = 0; col < 12; col++) {
      const x = 5.3 + col * 1.1 + (col >= 6 ? 0.55 : 0);
      for (let row = 0; row < 2; row++) {
        const lit = (col * 2 + row) % 5 !== 3;
        k.rj45(x, 11.05 + row * 1.85, 0.98, 1.55, lit ? GREEN : undefined, -(col * 2 + row) * 90);
      }
    }
    k.sfp(19.1, 11.1, 1.75, 1.45).sfp(19.1, 12.9, 1.75, 1.45);
    k.rect(5.3, 15.25, 13.3, 0.32, 0.1, '#0891b2', ' opacity="0.85"');
    k.rect(2.4, 16.6, 19.2, 0.4, 0.15, '#0b0d10');
  }),

  firewall: art('firewall', (k) => {
    // A brushed-red shield with a brick course, standing behind the appliance it guards.
    k.path(shieldPath(5.2, 2.5, 18.8, 17.5), k.mat(2.5, 15, ['#fca5a5', '#dc2626', '#7f1d1d']));
    k.path(shieldPath(6.4, 3.8, 17.6, 16.2), k.lin(6, 3.8, 18, 16, [[0, '#ef4444'], [1, '#991b1b']]));
    const brick = '#fecaca';
    k.line('M6.5 7.2H17.5M6.5 10.2H17.5M6.5 13.2H17.5', brick, 0.5, ' opacity="0.7"');
    k.line('M9.4 4.6V7.2M14.6 4.6V7.2M12 7.2V10.2M8 7.2V10.2M16 7.2V10.2M9.4 10.2V13.2M14.6 10.2V13.2', brick, 0.5, ' opacity="0.7"');
    k.path(shieldPath(5.2, 2.5, 18.8, 17.5), 'none', ' stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.4"');
    appliance(k, 3.5, 14.4, 17, 1.3, 5.7);
    k.rect(4.3, 18.6, 3.6, 0.42, 0.2, '#ef4444');
    k.led(4.8, 17.1, 0.36, GREEN, -400).led(6.1, 17.1, 0.36, RED, -150, true);
    for (let i = 0; i < 5; i++) k.rj45(9.2 + i * 2.15, 16.3, 1.75, 1.6, i % 2 ? undefined : GREEN, -i * 260);
    feet(k, 3.5, 17, 21.4);
  }),

  'access-point': art('access-point', (k) => {
    wifi(k, 12, 13.6, [3.4, 5.6, 7.8], '#8b5cf6');
    // Ceiling puck in white plastic: rim band, domed top, LED ring.
    k.path('M4 17.1V18.2A8 2.8 0 0 0 20 18.2V17.1Z', k.lin(0, 17, 0, 21, [[0, '#dfe4ea'], [1, '#9aa4af']]));
    k.ell(12, 17.1, 8, 2.9, k.rad(9.5, 15.5, 9, [[0, '#ffffff'], [0.7, '#eef1f4'], [1, '#c3cbd4']]));
    k.ell(12, 17.1, 2.1, 0.75, 'none', ' stroke="#a78bfa" stroke-width="0.6"');
    k.ell(12, 17.1, 2.1, 0.75, 'none', ' class="nxLed" stroke="#c4b5fd" stroke-width="0.4" style="animation-delay:-500ms"');
    k.spec(7.5, 14.6, 9, 0.6);
  }),

  'wireless-controller': art('wireless-controller', (k) => {
    wifi(k, 12, 11.6, [2.6, 4.6], '#8b5cf6');
    appliance(k, 3.5, 12.6, 17, 1.2, 6.6);
    k.rect(4.3, 18.4, 3.6, 0.42, 0.2, '#7c3aed');
    k.led(4.8, 15.4, 0.36, GREEN, -260).led(6.1, 15.4, 0.36, AMBER, -640, true);
    for (let i = 0; i < 4; i++) k.rj45(10 + i * 2.5, 14.6, 2, 1.8, i < 2 ? GREEN : undefined, -i * 300);
    feet(k, 3.5, 17, 19.4);
  }),

  server: art('server', (k) => {
    // Tower server: front bezel, a sliver of the side for depth, hot-swap caddies, mesh intake.
    k.path('M17.4 3.3L19 2.5V20.6L17.4 21Z', k.lin(17.4, 0, 19, 0, [[0, '#2a3039'], [1, '#14181d']]));
    k.rect(5, 2.5, 12.6, 18.5, 0.7, k.mat(2.5, 18.5, M.black));
    k.spec(5.4, 2.6, 11.8, 0.45);
    k.rect(6.1, 3.7, 10.4, 2.2, 0.3, '#14181e');
    k.rect(6.6, 4.25, 4.6, 1.1, 0.2, '#0e3a2c');
    k.screen(6.6, 4.25, 4.6, 1.1, 0.2, '#6ee7b7');
    k.circ(15.2, 4.8, 0.62, '#2b3139').circ(15.2, 4.8, 0.36, '#34d399', ' class="nxLed" style="animation-delay:-200ms"');
    for (let i = 0; i < 4; i++) {
      const y = 6.6 + i * 2.05;
      k.rect(6.1, y, 10.4, 1.75, 0.25, k.lin(0, y, 0, y + 1.75, [[0, '#5b6470'], [1, '#2e343c']]));
      k.rect(6.5, y + 0.4, 6.4, 0.95, 0.15, '#1a1f25');
      k.rect(13.3, y + 0.35, 2.3, 1.05, 0.2, '#9aa4af');
      k.led(15.95, y + 0.88, 0.24, i === 2 ? AMBER : GREEN, -i * 340, i === 2);
    }
    k.rect(6.1, 15, 10.4, 5, 0.3, '#1d2228');
    k.mesh(6.1, 15, 10.4, 5, 0.8, '#05070a');
    k.rect(6.1, 19.6, 3.4, 0.4, 0.15, '#059669');
    k.rect(5.6, 21, 2.4, 0.5, 0.2, '#0b0d10').rect(14.4, 21, 2.4, 0.5, 0.2, '#0b0d10');
  }),

  storage: art('storage', (k) => {
    drum(k, 4.5, 6.2, 15, 11.4, 2.25, '#134e4a', '#5eead4', 2);
    k.led(16.6, 10.7, 0.32, GREEN, -150).led(16.6, 14.5, 0.32, GREEN, -620).led(15.3, 18.1, 0.32, AMBER, -380, true);
  }),

  'load-balancer': art('load-balancer', (k) => {
    // Three backends fed from one hub on the appliance: amber light-trails fanning out.
    const ends: Array<[number, number]> = [[4.5, 4.6], [11.75, 4.6], [19, 4.6]];
    for (const [ex, ey] of ends) {
      k.line(`M11.75 13.4C11.75 9.6 ${ex} 9.8 ${ex} ${ey + 1.4}`, '#f59e0b', 1.1, ' opacity="0.9"');
      k.circ(ex, ey, 2.1, k.rad(ex - 0.6, ey - 0.7, 2.6, [[0, '#fff7d6'], [0.55, '#fbbf24'], [1, '#b45309']]));
      k.circ(ex, ey, 0.75, '#fffbeb', ' opacity="0.85"');
    }
    appliance(k, 2.5, 13.3, 18.5, 1.3, 7.4);
    k.circ(11.75, 13.9, 0.95, '#fbbf24').circ(11.75, 13.9, 0.45, '#fffbeb');
    k.rect(3.3, 19.7, 4, 0.42, 0.2, '#ca8a04');
    k.led(3.8, 16.8, 0.36, GREEN, -330).led(5.1, 16.8, 0.36, AMBER, -820, true);
    for (let i = 0; i < 4; i++) k.rj45(9.4 + i * 2.6, 16, 2.1, 1.8, i % 3 ? GREEN : undefined, -i * 220);
  }),

  'end-user': art('end-user', (k) => {
    // Monitor: thin black bezel, glossy panel with a desktop, aluminium stand.
    k.path('M10.6 16.4H13.4L14 19.7H10Z', k.lin(10, 0, 14, 0, [[0, '#8a949f'], [0.5, '#e5e9ee'], [1, '#7b8590']]));
    k.ell(12, 20.2, 5.4, 0.8, k.lin(0, 19.4, 0, 21, [[0, '#e5e9ee'], [1, '#8a949f']]));
    k.rect(2.5, 3.5, 19, 13.1, 0.8, k.mat(3.5, 13.1, ['#3a414b', '#1b1f25', '#0c0e11']));
    k.rect(3.2, 4.2, 17.6, 10.9, 0.3, k.lin(3.2, 4.2, 20.8, 15.1, [[0, '#1e3a8a'], [0.55, '#2563eb'], [1, '#7c3aed']]));
    k.screen(3.2, 4.2, 17.6, 10.9, 0.3);
    k.rect(4.4, 5.6, 8.4, 5.4, 0.35, '#f8fafc', ' opacity="0.9"');
    k.rect(4.4, 5.6, 8.4, 1, 0.35, '#cbd5e1');
    k.rect(5.2, 7.4, 4.8, 0.5, 0.2, '#93c5fd').rect(5.2, 8.5, 6.2, 0.5, 0.2, '#cbd5e1').rect(5.2, 9.6, 3.6, 0.5, 0.2, '#cbd5e1');
    k.rect(13.8, 8.2, 5.6, 4.6, 0.35, '#0f172a', ' opacity="0.85"');
    k.rect(14.4, 9.2, 3, 0.4, 0.15, '#4ade80').rect(14.4, 10.3, 4.2, 0.4, 0.15, '#64748b');
    k.rect(3.2, 14.4, 17.6, 0.7, 0, '#0f172a', ' opacity="0.6"');
    k.glare(3.2, 4.2, 17.6, 10.9);
    k.circ(12, 15.85, 0.28, '#4ade80', ' class="nxLed" style="animation-delay:-180ms"');
  }),

  printer: art('printer', (k) => {
    // Office laser printer: sheet feeding out the top, light-grey body, panel, paper drawer.
    k.rect(7.4, 2, 9.2, 4.4, 0.2, k.lin(0, 2, 0, 6.4, [[0, '#ffffff'], [1, '#e2e8f0']]));
    k.line('M8.6 3.2H15.4M8.6 4.3H13.8', '#94a3b8', 0.45);
    k.path('M5 5.6H19L20.5 8.2H3.5Z', k.lin(0, 5.6, 0, 8.2, [[0, '#f1f5f9'], [1, '#c4ccd5']]));
    k.rect(6.4, 6.5, 11.2, 0.75, 0.3, '#475569');
    k.rect(3.5, 8.2, 17, 10.7, 0.7, k.mat(8.2, 10.7, M.white));
    k.spec(3.9, 8.3, 16.2, 0.8);
    k.rect(4.6, 9.4, 6, 2.3, 0.3, '#1f2937');
    k.rect(5.1, 9.85, 3.4, 1.4, 0.15, '#0c4a6e');
    k.screen(5.1, 9.85, 3.4, 1.4, 0.15, '#bae6fd');
    k.circ(9.6, 10.55, 0.42, '#94a3b8');
    k.led(12, 10.55, 0.3, GREEN, -420);
    k.line('M3.9 15.4H20.1', '#94a3b8', 0.4);
    k.rect(9.5, 16.6, 5, 0.7, 0.35, '#94a3b8');
    k.rect(3.9, 18.4, 16.2, 0.45, 0.2, '#64748b', ' opacity="0.5"');
    k.rect(4.6, 18.9, 2.4, 0.6, 0.25, '#334155').rect(17, 18.9, 2.4, 0.6, 0.25, '#334155');
  }),

  iot: art('iot', (k) => {
    // A microcontroller board: green PCB, gold pads and traces, a shielded radio, a module chip.
    k.rect(4, 4, 16, 16, 1, k.lin(4, 4, 20, 20, [[0, '#2f855a'], [0.5, '#166534'], [1, '#0f3d22']]));
    k.rect(4.25, 4.25, 15.5, 15.5, 0.85, 'none', ' stroke="#4ade80" stroke-opacity="0.35" stroke-width="0.3"');
    for (const [cx, cy] of [[5.6, 5.6], [18.4, 5.6], [5.6, 18.4], [18.4, 18.4]] as const) {
      k.circ(cx, cy, 0.85, '#d4a017').circ(cx, cy, 0.42, '#0f3d22');
    }
    k.line('M7 9.4H9.6V12M7 14.6H9.6M17 12.2H14.4M12 18.6V14.4', '#e9c46a', 0.4, ' opacity="0.9"');
    k.line('M8.2 5.2V7.4H10V5.2H11.8V7.4H13.6V5.2H15.4V7.4', '#e9c46a', 0.45);
    k.rect(9.4, 9.4, 5.2, 5.2, 0.35, k.mat(9.4, 5.2, M.steel));
    k.spec(9.6, 9.5, 4.8, 0.7);
    k.rect(10.3, 10.6, 3.4, 2.8, 0.2, '#9aa4af', ' opacity="0.5"');
    for (let i = 0; i < 5; i++) {
      k.rect(5, 9.3 + i * 1.2, 1.1, 0.55, 0.1, '#e9c46a');
      k.rect(17.9, 9.3 + i * 1.2, 1.1, 0.55, 0.1, '#e9c46a');
    }
    k.led(15.6, 16.6, 0.42, GREEN, -540);
    k.led(13.8, 16.6, 0.36, BLUE, -1100);
  }),

  isp: art('isp', (k) => {
    // The planet: sunlit ocean, land masses, a specular glint and the atmosphere rim.
    k.circ(12, 12, 9.5, k.rad(12, 12, 9.5, [[0, '#7dd3fc'], [0.62, '#0284c7'], [1, '#0c2d48']], 8.8, 8.4));
    const land = k.rad(9, 8, 12, [[0, '#86efac'], [0.6, '#16a34a'], [1, '#14532d']]);
    k.path('M6.2 7.4C7.6 5.6 10.6 5 12 6.4 12.6 7.6 11 8.2 10.8 9.6 10.6 11.4 12.4 12 11.6 13.6 10.8 15 8.6 14.4 7.8 12.8 7.2 11.4 5.6 11.2 5.2 9.8 5 8.8 5.6 8 6.2 7.4Z', land);
    k.path('M13.6 9.6C15 8.6 17.6 8.8 18.6 10.2 19.6 11.6 19 13.6 17.6 14.6 16.4 15.4 16.6 17.2 15.2 18 13.8 18.8 13 17.2 13.4 15.8 13.8 14.4 12.8 13.2 13 11.8 13.1 10.8 13.2 10 13.6 9.6Z', land);
    k.path('M8.8 16.8C9.8 16.2 11.2 16.6 11.4 17.6 11.6 18.6 10.4 19.4 9.4 19 8.6 18.6 8.2 17.4 8.8 16.8Z', land, ' opacity="0.85"');
    k.circ(12, 12, 9.5, k.rad(15.5, 15.5, 12, [[0, '#020617', 0], [0.55, '#020617', 0], [1, '#020617', 0.55]]));
    k.ell(8.4, 7.2, 3, 1.7, k.rad(8.4, 7.2, 3, [[0, '#ffffff', 0.35], [1, '#ffffff', 0]]));
    k.circ(12, 12, 9.3, 'none', ' stroke="#bae6fd" stroke-opacity="0.65" stroke-width="0.4"');
  }),

  cloud: art('cloud', (k) => {
    const d =
      'M6.4 18.5H17.6C20 18.5 21.5 16.9 21.5 14.8 21.5 12.9 20.1 11.4 18.2 11.2 17.8 7.8 15.2 5 11.8 5 9.1 5 6.9 6.7 6.1 9.1 3.8 9.5 2 11.5 2 13.9 2 16.5 4 18.5 6.4 18.5Z';
    k.path(d, k.lin(0, 5, 0, 18.5, [[0, '#ffffff'], [0.55, '#e0ecff'], [1, '#93b8ef']]));
    k.ell(11.8, 9.6, 4.6, 3.6, '#ffffff', ' opacity="0.65"');
    k.ell(17.6, 13.4, 3, 2.4, '#ffffff', ' opacity="0.35"');
    k.path('M3.4 16.4C4.2 17.8 5.4 18.5 6.4 18.5H17.6C19 18.5 20.2 17.9 20.8 16.9 17 17.6 8 17.6 3.4 16.4Z', '#3b82f6', ' opacity="0.28"');
  }),

  vm: art('vm', (k) => {
    // Virtual machines: a stack of OS windows, the front one a live console.
    k.rect(5.5, 4, 16, 11.6, 0.8, k.mat(4, 11.6, M.charcoal), ' opacity="0.75"');
    k.rect(4, 5.6, 16, 11.6, 0.8, k.mat(5.6, 11.6, M.charcoal), ' opacity="0.9"');
    k.rect(2.5, 7.2, 16.6, 13.3, 0.8, k.mat(7.2, 13.3, ['#e2e8f0', '#cbd5e1', '#94a3b8']));
    k.circ(3.9, 8.4, 0.42, '#f87171').circ(5.2, 8.4, 0.42, '#fbbf24').circ(6.5, 8.4, 0.42, '#4ade80');
    k.rect(3.2, 9.5, 15.2, 10.3, 0.35, '#071a12');
    k.screen(3.2, 9.5, 15.2, 10.3, 0.35, '#8ef0b8');
    k.rect(4.2, 10.8, 1.4, 0.55, 0.15, '#4ade80').rect(6.2, 10.8, 7.8, 0.55, 0.2, '#86efac', ' opacity="0.8"');
    k.rect(4.2, 12.3, 9.6, 0.55, 0.2, '#86efac', ' opacity="0.55"');
    k.rect(4.2, 13.8, 6.4, 0.55, 0.2, '#86efac', ' opacity="0.55"');
    k.rect(4.2, 15.3, 1.4, 0.55, 0.15, '#4ade80').rect(6.2, 15.2, 0.6, 0.8, 0, '#bbf7d0', ' class="nxLed"');
    k.glare(3.2, 9.5, 15.2, 10.3);
    k.rect(20.2, 9, 1.3, 1.3, 0.3, '#16a34a').rect(20.2, 11, 1.3, 1.3, 0.3, '#16a34a', ' opacity="0.6"');
  }),

  container: art('container', (k) => {
    // A shipping container in three-quarter view: corrugated side, double doors with lock rods.
    k.path('M12 3L21 7.5L12 12L3 7.5Z', k.lin(3, 3, 21, 12, [[0, '#7dd3fc'], [1, '#0ea5e9']]));
    k.line('M5.4 7.5L12 4.2M8 8.8L14.6 5.5M10.6 10.1L17.2 6.8', '#e0f2fe', 0.35, ' opacity="0.6"');
    k.path('M3 7.5L12 12V21.5L3 17Z', k.lin(3, 0, 12, 0, [[0, '#0284c7'], [1, '#0369a1']]));
    for (let i = 1; i < 9; i++) {
      const x = 3 + i;
      k.line(`M${x} ${f(7.5 + i * 0.5 + 0.4)}V${f(17 + i * 0.5 - 0.4)}`, '#0c4a6e', 0.4, ' opacity="0.75"');
    }
    k.path('M12 12L21 7.5V17L12 21.5Z', k.lin(12, 0, 21, 0, [[0, '#075985'], [1, '#0c4a6e']]));
    k.line('M16.5 9.8V19.3', '#082f49', 0.45);
    for (const x of [13.8, 15.2, 17.8, 19.2]) {
      const y0 = 12 - (x - 12) * 0.5 + 0.6;
      k.line(`M${x} ${f(y0)}V${f(y0 + 8.3)}`, '#bae6fd', 0.4, ' opacity="0.8"');
    }
    k.line('M3 7.5L12 12L21 7.5', '#e0f2fe', 0.4, ' opacity="0.7"');
    k.line('M12 12V21.5', '#082f49', 0.4, ' opacity="0.6"');
  }),

  rack: art('rack', (k) => {
    // A server cabinet with a tinted glass door: gear and lights behind it, a handle, casters.
    k.rect(4.5, 2.5, 15, 18.5, 0.6, k.mat(2.5, 18.5, ['#3d444e', '#1c2026', '#0d0f12']));
    k.spec(4.9, 2.6, 14.2, 0.45);
    k.rect(5.6, 3.6, 12.8, 16.3, 0.3, '#07090c');
    const units: Array<[number, string]> = [[1.6, 'sw'], [1.6, 'sw'], [2.6, 'srv'], [2.6, 'srv'], [3, 'sto'], [1.6, 'ups']];
    let y = 4.1;
    units.forEach(([h, kind], i) => {
      k.rect(6.3, y, 11.4, h, 0.15, k.lin(0, y, 0, y + h, [[0, '#4b5360'], [1, '#22272e']]));
      if (kind === 'sw') for (let p = 0; p < 8; p++) k.rect(9.4 + p * 0.95, y + 0.45, 0.7, 0.7, 0.08, '#05070a');
      if (kind === 'srv' || kind === 'sto') for (let p = 0; p < 4; p++) k.rect(10.8 + p * 1.6, y + 0.4, 1.35, h - 0.8, 0.1, '#14181d');
      k.led(7.2, y + h / 2, 0.24, i === 3 ? AMBER : GREEN, -i * 260, i === 3);
      y += h + 0.35;
    });
    k.glare(5.6, 3.6, 12.8, 16.3);
    k.rect(18.6, 8.6, 0.55, 4.4, 0.25, k.cyl(18.6, 0.55, '#6b7480', '#e5e9ee'));
    k.circ(6.6, 21, 0.5, '#0b0d10').circ(17.4, 21, 0.5, '#0b0d10');
  }),

  'patch-panel': art('patch-panel', (k) => {
    // 1U patch panel: label strip, 24 keystones, a few patched cords in colour-coded boots.
    k.path('M3.6 7.5H20.4L21.5 8.6H2.5Z', k.lin(0, 7.5, 0, 8.6, [[0, '#8a939e'], [1, '#4f5761']]));
    k.rect(2.5, 8.6, 19, 7.4, 0.35, k.mat(8.6, 7.4, M.black));
    k.spec(2.9, 8.65, 18.2, 0.4);
    k.ear(2.5, 8.6, 0.9, 7.4).ear(20.6, 8.6, 0.9, 7.4);
    k.rect(4.1, 9.3, 15.8, 0.9, 0.15, '#e5e7eb');
    k.line('M5 9.75H7.6M8.6 9.75H11.2M12.8 9.75H15.4M16.4 9.75H19', '#9ca3af', 0.3);
    const boots: Record<number, string> = { 1: '#3b82f6', 4: '#facc15', 9: '#3b82f6', 14: '#ef4444', 18: '#22c55e', 21: '#3b82f6' };
    for (let col = 0; col < 12; col++) {
      const x = 4.2 + col * 1.3 + (col >= 6 ? 0.25 : 0);
      for (let row = 0; row < 2; row++) {
        const y = 10.8 + row * 2.3;
        const i = col * 2 + row;
        k.rect(x, y, 1.1, 1.8, 0.12, '#f3f4f6');
        k.rect(x + 0.15, y + 0.2, 0.8, 1.35, 0.08, '#0b0d10');
        const boot = boots[i];
        if (boot) k.rect(x + 0.05, y + 0.5, 1, 1.25, 0.2, boot).rect(x + 0.25, y + 0.6, 0.6, 0.3, 0.1, '#ffffff', ' opacity="0.5"');
      }
    }
    k.rect(2.9, 16, 18.2, 0.5, 0.15, '#0b0d10');
  }),

  ups: art('ups', (k) => {
    // Tower UPS: glossy front bezel, backlit LCD with battery and load bars, buttons, intake.
    k.path('M17.4 3.6L19 3V20.6L17.4 21Z', k.lin(17.4, 0, 19, 0, [[0, '#2a3039'], [1, '#14181d']]));
    k.rect(5, 3, 12.6, 17.6, 0.9, k.mat(3, 17.6, ['#3a414b', '#1c2026', '#0d0f12']));
    k.spec(5.5, 3.1, 11.6, 0.5);
    k.rect(6.4, 4.7, 9.8, 5.4, 0.4, '#0b0e12');
    k.rect(7, 5.2, 8.6, 4.4, 0.25, '#0c4a6e');
    k.screen(7, 5.2, 8.6, 4.4, 0.25, '#7dd3fc');
    for (let i = 0; i < 5; i++) k.rect(7.6 + i * 1.1, 6, 0.85, 1.5, 0.1, '#7dd3fc', ` opacity="${f(0.5 + i * 0.1)}"`);
    k.rect(13.6, 6, 1.4, 1.5, 0.2, '#bae6fd', ' opacity="0.8"');
    k.rect(7.6, 8.1, 7.4, 0.55, 0.2, '#38bdf8', ' opacity="0.7"');
    k.circ(8, 11.8, 0.85, '#2b3139').circ(8, 11.8, 0.55, '#d97706');
    k.circ(10.4, 11.8, 0.6, '#2b3139').circ(12.4, 11.8, 0.6, '#2b3139').circ(14.4, 11.8, 0.6, '#2b3139');
    k.led(15.9, 11.8, 0.3, GREEN, -360);
    k.vents(6.4, 13.8, 9.8, 5.4, 9, '#07090c');
    k.rect(5.6, 20.6, 2.4, 0.4, 0.2, '#0b0d10').rect(14.6, 20.6, 2.4, 0.4, 0.2, '#0b0d10');
  }),

  camera: art('camera', (k) => {
    // Ceiling dome camera: white mounting base, smoked dome, lens with iris rings, IR ring, rec light.
    k.path('M4.5 18V19.2A7.5 1.8 0 0 0 19.5 19.2V18Z', k.lin(0, 18, 0, 21, [[0, '#e5e9ee'], [1, '#9aa4af']]));
    k.ell(12, 18, 7.5, 1.8, k.lin(0, 16.2, 0, 19.8, [[0, '#ffffff'], [1, '#d5dbe2']]));
    k.path('M6 18A6 7.5 0 0 1 18 18Z', k.rad(10, 13, 8, [[0, '#4b5563'], [0.7, '#1f2937'], [1, '#0b0f14']]));
    k.circ(12.4, 15, 2.6, '#05070a');
    k.circ(12.4, 15, 1.9, k.rad(12, 14.4, 2.4, [[0, '#6366f1'], [0.5, '#1e1b4b'], [1, '#05070a']]));
    k.circ(12.4, 15, 0.8, '#020617');
    k.circ(11.7, 14.3, 0.45, '#ffffff', ' opacity="0.8"');
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * (200 + i * 28)) / 180;
      k.circ(12.4 + Math.cos(a) * 3.4, 15 + Math.sin(a) * 2.6, 0.22, '#7f1d1d');
    }
    k.path('M7.4 15.2A4.8 6 0 0 1 11 11', 'none', ' stroke="#ffffff" stroke-opacity="0.45" stroke-width="0.6" stroke-linecap="round"');
    k.led(16.9, 17, 0.32, RED, -100, true);
  }),

  vpc: art('vpc', (k) => {
    // A frosted-glass region: dashed boundary, a header tab, two subnets of instances.
    k.rect(2.5, 4, 19.5, 16, 1.6, k.lin(2.5, 4, 22, 20, [[0, '#0e7490'], [1, '#0c2f4a']]), ' opacity="0.95"');
    k.rect(2.9, 4.4, 18.7, 15.2, 1.3, 'none', ' stroke="#67e8f9" stroke-width="0.5" stroke-dasharray="1.6 1"');
    k.rect(2.5, 4, 7.2, 2.4, 1.2, '#22d3ee');
    k.path('M4.3 5.9H6.6A0.9 0.9 0 0 0 6.5 4.2 1.3 1.3 0 0 0 4.1 4.6 0.7 0.7 0 0 0 4.3 5.9Z', '#ecfeff');
    for (const sx of [4.2, 13.2]) {
      k.rect(sx, 8.6, 7.2, 9.6, 0.8, '#ffffff', ' opacity="0.12"');
      k.rect(sx, 8.6, 7.2, 9.6, 0.8, 'none', ' stroke="#a5f3fc" stroke-opacity="0.6" stroke-width="0.35"');
      for (let r = 0; r < 2; r++) {
        const y = 10 + r * 3.9;
        k.rect(sx + 1, y, 5.2, 2.6, 0.3, k.mat(y, 2.6, M.steel));
        k.rect(sx + 1.6, y + 0.8, 2.6, 0.9, 0.15, '#334155');
        k.circ(sx + 5.4, y + 1.3, 0.3, GREEN, ` class="nxLed" style="animation-delay:-${(sx + r) * 90}ms"`);
      }
    }
  }),

  'cloud-subnet': art('cloud-subnet', (k) => {
    k.rect(2.5, 5, 19, 14, 1.6, k.lin(2.5, 5, 21.5, 19, [[0, '#0ea5e9'], [1, '#0c4a6e']]), ' opacity="0.95"');
    k.rect(2.9, 5.4, 18.2, 13.2, 1.3, 'none', ' stroke="#bae6fd" stroke-width="0.45" stroke-dasharray="1.4 0.9"');
    k.rect(4, 6.4, 6.6, 1.6, 0.8, '#e0f2fe', ' opacity="0.9"');
    k.rect(4.7, 6.95, 4.2, 0.5, 0.2, '#0369a1');
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 4.2 + c * 5.5;
        const y = 9.6 + r * 4.4;
        k.rect(x, y, 4.6, 3.2, 0.35, k.mat(y, 3.2, M.steel));
        k.rect(x + 0.6, y + 0.9, 2.4, 1.4, 0.2, '#334155');
        k.circ(x + 3.8, y + 1.6, 0.3, GREEN, ` class="nxLed" style="animation-delay:-${(r * 3 + c) * 170}ms"`);
      }
    }
  }),

  'internet-gateway': art('internet-gateway', (k) => {
    k.circ(9, 12, 7, k.rad(9, 12, 7, [[0, '#7dd3fc'], [0.65, '#0284c7'], [1, '#0c2d48']], 6.8, 9.4));
    const land = '#22c55e';
    k.path('M5 9.6C6.2 8.2 8.6 8 9.4 9.2 9.8 10.4 8.4 11 8.6 12.4 8.8 13.6 7.2 14 6.4 13 5.6 12 4.4 11 5 9.6Z', land, ' opacity="0.85"');
    k.path('M10.6 13.8C11.8 13.2 13.4 13.8 13.4 15.2 13.2 16.6 11.4 17 10.6 16 10 15.4 10 14.2 10.6 13.8Z', land, ' opacity="0.85"');
    k.ell(6.8, 8.4, 2.2, 1.3, k.rad(6.8, 8.4, 2.2, [[0, '#ffffff', 0.35], [1, '#ffffff', 0]]));
    k.rect(14.2, 8.6, 6.8, 6.8, 0.8, k.mat(8.6, 6.8, ['#fde68a', '#f59e0b', '#b45309']));
    k.spec(14.6, 8.7, 6, 0.6);
    k.path('M15.6 11.3H18.2V9.9L20.2 12L18.2 14.1V12.7H15.6Z', '#fffbeb');
  }),

  'nat-gateway': art('nat-gateway', (k) => {
    // A translation gateway: private traffic enters on one side, leaves re-addressed on the other.
    k.rect(7.5, 5.5, 9, 13, 0.9, k.mat(5.5, 13, ['#4b5563', '#1f2937', '#0b0f14']));
    k.spec(7.9, 5.6, 8.2, 0.5);
    k.rect(8.6, 6.8, 6.8, 1.8, 0.3, '#05070a');
    k.rect(9.1, 7.25, 2.8, 0.9, 0.15, '#7dd3fc', ' opacity="0.85"');
    k.led(13.9, 7.7, 0.3, GREEN, -240);
    k.rect(8.6, 16.6, 3.4, 0.4, 0.15, '#0369a1');
    const blue = k.lin(0, 8, 0, 11, [[0, '#7dd3fc'], [1, '#0284c7']]);
    const green = k.lin(0, 13, 0, 16, [[0, '#86efac'], [1, '#16a34a']]);
    k.path('M2.2 8.7H11.6V7L14.6 9.6L11.6 12.2V10.5H2.2Z', blue, ' stroke="#e0f2fe" stroke-width="0.35" stroke-linejoin="round"');
    k.path('M21.8 13.5H12.4V11.8L9.4 14.4L12.4 17V15.3H21.8Z', green, ' stroke="#dcfce7" stroke-width="0.35" stroke-linejoin="round"');
  }),

  'route-table': art('route-table', (k) => {
    // A route table as a printed card on a clipboard: header, destination → target rows.
    k.rect(3, 4.8, 18, 16.2, 1, k.mat(4.8, 16.2, ['#818cf8', '#4f46e5', '#312e81']));
    k.rect(4.2, 6.2, 15.6, 13.8, 0.4, k.mat(6.2, 13.8, M.white));
    k.rect(9, 3.5, 6, 2.6, 0.7, k.mat(3.5, 2.6, M.steel));
    k.rect(10.6, 4.2, 2.8, 0.7, 0.35, '#475569');
    k.rect(5.2, 7.4, 13.6, 1.7, 0.2, '#6366f1');
    k.rect(5.8, 7.9, 4.2, 0.6, 0.2, '#e0e7ff').rect(12.6, 7.9, 4.4, 0.6, 0.2, '#e0e7ff');
    for (let i = 0; i < 4; i++) {
      const y = 10.4 + i * 2.25;
      k.rect(5.8, y, 4.8, 0.6, 0.2, '#94a3b8');
      k.path(`M11.2 ${f(y + 0.05)}L12.2 ${f(y + 0.3)}L11.2 ${f(y + 0.55)}Z`, '#6366f1');
      k.rect(12.6, y, i % 2 ? 3.6 : 5, 0.6, 0.2, i === 0 ? '#22c55e' : '#64748b');
      if (i < 3) k.rect(5.6, y + 1.3, 12.8, 0.2, 0, '#e2e8f0');
    }
  }),

  'security-group': art('security-group', (k) => {
    // Polished shield carrying the group's rules: allow, allow, deny.
    k.path(shieldPath(3.5, 2.5, 20.5, 22), k.mat(2.5, 19.5, ['#f9a8d4', '#db2777', '#831843']));
    k.path(shieldPath(5, 4.2, 19, 20.2), k.lin(5, 4, 19, 20, [[0, '#ec4899'], [1, '#9d174d']]));
    k.path(shieldPath(5, 4.2, 19, 20.2), 'none', ' stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.4"');
    const rows: Array<[string, number]> = [[GREEN, 7.4], [GREEN, 10.4], [RED, 13.4]];
    for (const [c, y] of rows) {
      k.rect(7.2, y, 9.6, 2, 0.5, '#ffffff', ' opacity="0.92"');
      k.circ(8.4, y + 1, 0.55, c);
      k.rect(9.6, y + 0.7, 5.8, 0.6, 0.3, '#9d174d', ' opacity="0.55"');
    }
    k.ell(9.4, 5.4, 3, 1, '#ffffff', ' opacity="0.25"');
  }),

  'vpn-gateway': art('vpn-gateway', (k) => {
    // A chrome padlock: thick shackle (filled ring, not a heavy pen), anodized body, keyhole.
    k.path(
      'M7.6 11.2V8.4A4.4 4.4 0 0 1 16.4 8.4V11.2H14.6V8.4A2.6 2.6 0 0 0 9.4 8.4V11.2Z',
      k.lin(7.6, 0, 16.4, 0, [[0, '#6b7480'], [0.3, '#f1f5f9'], [0.6, '#b8c1cb'], [1, '#5b6470']]),
    );
    k.rect(5.5, 10.8, 13, 9.2, 1.4, k.mat(10.8, 9.2, ['#a78bfa', '#6d28d9', '#3b0764']));
    k.spec(6.2, 10.9, 11.6, 0.6);
    k.rect(5.5, 18.6, 13, 1.4, 1, '#000000', ' opacity="0.2"');
    k.circ(12, 14.6, 1.35, '#1e0b3a');
    k.path('M11.35 15.2H12.65L13 17.6H11Z', '#1e0b3a');
    k.circ(11.6, 14.2, 0.35, '#c4b5fd', ' opacity="0.7"');
  }),

  k8s: art('k8s', (k) => {
    // The helm: a glossy blue heptagon, a white wheel of seven spokes.
    const R = 8.2;
    const cx = 12;
    const cy = 10.7;
    const hept = Array.from({ length: 7 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 7;
      return `${f(cx + R * Math.sin(a))} ${f(cy - R * Math.cos(a))}`;
    });
    k.path(`M${hept.join('L')}Z`, k.lin(4, 2.5, 20, 18, [[0, '#6b9cf5'], [0.5, '#326ce5'], [1, '#1b45a8']]));
    k.path(`M${hept.join('L')}Z`, 'none', ' stroke="#bfdbfe" stroke-opacity="0.6" stroke-width="0.4"');
    for (let i = 0; i < 7; i++) {
      const a = (Math.PI * 2 * i) / 7;
      const x1 = cx + 1.7 * Math.sin(a);
      const y1 = cy - 1.7 * Math.cos(a);
      const x2 = cx + 5.4 * Math.sin(a);
      const y2 = cy - 5.4 * Math.cos(a);
      k.line(`M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`, '#ffffff', 0.9);
      k.circ(x2, y2, 0.75, '#ffffff');
    }
    k.circ(cx, cy, 3.6, 'none', ' stroke="#ffffff" stroke-width="1.1"');
    k.circ(cx, cy, 1.3, '#ffffff');
    k.ell(9.2, 5.6, 3.2, 1.3, '#ffffff', ' opacity="0.22"');
  }),

  'managed-db': art('managed-db', (k) => {
    drum(k, 4.5, 6.2, 15, 11.4, 2.25, '#164e63', '#67e8f9', 2);
    // Managed: a green "healthy" badge in the corner.
    k.circ(17.5, 17.5, 3.5, '#ffffff');
    k.circ(17.5, 17.5, 3, k.rad(16.6, 16.4, 3.6, [[0, '#86efac'], [0.6, '#22c55e'], [1, '#15803d']]));
    k.line('M15.9 17.6L17.1 18.8L19.2 16.4', '#ffffff', 0.9);
  }),

  'object-storage': art('object-storage', (k) => {
    // A brushed steel bucket with banded hoops, objects showing inside.
    k.path('M5 5.4L6.6 18.6A2.4 1.4 0 0 0 9 20H15A2.4 1.4 0 0 0 17.4 18.6L19 5.4Z', k.cyl(5, 14, '#115e59', '#5eead4'));
    k.line('M5.5 9.4H18.5', '#042f2e', 0.6, ' opacity="0.5"');
    k.line('M6.1 14.8H17.9', '#042f2e', 0.6, ' opacity="0.5"');
    k.line('M5.5 9.9H18.5M6.1 15.3H17.9', '#ccfbf1', 0.3, ' opacity="0.5"');
    k.ell(12, 5.4, 7, 1.9, '#134e4a');
    k.rect(8.4, 4.4, 2.6, 2, 0.3, '#fbbf24').rect(11.4, 3.9, 2.4, 2.2, 0.3, '#f472b6').rect(14, 4.6, 2.2, 1.6, 0.3, '#60a5fa');
    k.ell(12, 5.4, 7, 1.9, 'none', ' stroke="#99f6e4" stroke-width="0.6"');
  }),

  generic: art('generic', (k) => {
    // An unbranded appliance block in brushed aluminium, one port and a status light.
    k.path('M12 3L20 7.5L12 12L4 7.5Z', k.lin(4, 3, 20, 12, [[0, '#f8fafc'], [1, '#c3cbd4']]));
    k.path('M4 7.5L12 12V21L4 16.5Z', k.lin(4, 0, 12, 0, [[0, '#a9b3be'], [1, '#8b95a1']]));
    k.path('M12 12L20 7.5V16.5L12 21Z', k.lin(12, 0, 20, 0, [[0, '#6f7a86'], [1, '#535d69']]));
    k.line('M4 7.5L12 12L20 7.5', '#ffffff', 0.4, ' opacity="0.6"');
    k.path('M14 14.1L17.6 12.1V14.1L14 16.1Z', '#0b0e12');
    k.led(6.2, 12.6, 0.42, GREEN, -400);
    k.path('M5.6 15.2L10.4 17.9', 'none', ' stroke="#ffffff" stroke-opacity="0.3" stroke-width="0.4"');
  }),

  laptop: art('laptop', (k) => {
    // An open laptop: lid with a thin bezel and camera, a keyboard deck in perspective.
    k.rect(4, 4.5, 16, 11.1, 0.7, k.mat(4.5, 11.1, ['#3a414b', '#1b1f25', '#0c0e11']));
    k.circ(12, 5.05, 0.2, '#334155');
    k.rect(4.7, 5.5, 14.6, 9.4, 0.2, k.lin(4.7, 5.5, 19.3, 14.9, [[0, '#0f766e'], [0.5, '#0891b2'], [1, '#4338ca']]));
    k.screen(4.7, 5.5, 14.6, 9.4, 0.2);
    k.rect(5.6, 6.6, 7.4, 4.8, 0.3, '#f8fafc', ' opacity="0.88"');
    k.rect(5.6, 6.6, 7.4, 0.9, 0.3, '#cbd5e1');
    k.rect(6.3, 8.3, 4.2, 0.45, 0.2, '#93c5fd').rect(6.3, 9.3, 5.4, 0.45, 0.2, '#cbd5e1');
    k.rect(13.8, 9, 4.6, 4.6, 0.3, '#0f172a', ' opacity="0.8"');
    k.rect(14.4, 10, 2.8, 0.4, 0.15, GREEN);
    k.glare(4.7, 5.5, 14.6, 9.4);
    k.path('M4 15.6H20L22 18.6H2Z', k.lin(0, 15.6, 0, 18.6, [[0, '#e5e9ee'], [1, '#aeb7c1']]));
    for (let r = 0; r < 3; r++) {
      const y = 16 + r * 0.75;
      const inset = 0.6 + (2 - r) * 0.45;
      k.line(`M${f(4 + inset)} ${f(y + 0.3)}H${f(20 - inset)}`, '#475569', 0.5, ' stroke-dasharray="0.6 0.25" opacity="0.7"');
    }
    k.rect(10.4, 18, 3.2, 0.4, 0.2, '#94a3b8');
    k.rect(2, 18.6, 20, 0.9, 0.45, k.lin(0, 18.6, 0, 19.5, [[0, '#c4ccd5'], [1, '#7b8590']]));
  }),

  'ip-phone': art('ip-phone', (k) => {
    // A desk IP phone: handset in its cradle, colour display, line keys, keypad.
    k.path('M5.6 9H20.5L19.4 21H3.5Z', k.mat(9, 12, M.charcoal));
    k.spec(5.8, 9.05, 14.5, 0.5);
    k.path(
      'M4 4.2C4 3.5 4.5 3 5.2 3H7.8C8.5 3 9 3.5 9 4.2V18.8C9 19.5 8.5 20 7.8 20H5.2C4.5 20 4 19.5 4 18.8Z',
      k.lin(4, 0, 9, 0, [[0, '#4a525d'], [0.45, '#2a3039'], [1, '#111418']]),
    );
    k.rect(4.6, 3.6, 3.8, 1.8, 0.6, '#0b0d10').rect(4.6, 17.6, 3.8, 1.8, 0.6, '#0b0d10');
    k.spec(4.6, 3.1, 3.8, 0.5);
    k.rect(10.4, 10.2, 8.6, 4.4, 0.3, '#0b0e12');
    k.rect(10.8, 10.6, 7.8, 3.6, 0.2, k.lin(10.8, 10.6, 18.6, 14.2, [[0, '#1e40af'], [1, '#0e7490']]));
    k.screen(10.8, 10.6, 7.8, 3.6, 0.2);
    k.rect(11.4, 11.3, 3.4, 0.45, 0.2, '#e0f2fe').rect(11.4, 12.3, 5.4, 0.45, 0.2, '#93c5fd', ' opacity="0.8"');
    k.led(18.4, 9.9, 0.28, GREEN, -300);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        k.rect(11.1 + c * 2.25, 15.4 + r * 1.3, 1.7, 0.9, 0.25, k.lin(0, 15.4 + r * 1.3, 0, 16.3 + r * 1.3, [[0, '#6b7480'], [1, '#3a414b']]));
      }
    }
    k.rect(18.3, 15.4, 0.9, 1.6, 0.25, '#16a34a').rect(18.3, 17.6, 0.9, 1.6, 0.25, '#dc2626');
  }),

  mobile: art('mobile', (k) => {
    // A smartphone: titanium frame, edge-to-edge glass, home screen of app tiles.
    k.rect(7, 2.5, 10, 19, 1.7, k.cyl(7, 10, '#5b6470', '#d5dbe2'));
    k.rect(6.85, 6.5, 0.3, 2, 0.15, '#7b8590').rect(16.85, 7, 0.3, 3, 0.15, '#7b8590');
    k.rect(7.45, 2.95, 9.1, 18.1, 1.35, '#05070a');
    k.rect(7.85, 3.35, 8.3, 17.3, 1.05, k.lin(7.85, 3.35, 16.15, 20.65, [[0, '#4338ca'], [0.5, '#7c3aed'], [1, '#db2777']]));
    k.screen(7.85, 3.35, 8.3, 17.3, 1.05);
    k.rect(10.6, 3.8, 2.8, 0.75, 0.38, '#05070a');
    const tiles = ['#22c55e', '#f59e0b', '#38bdf8', '#f43f5e', '#a78bfa', '#14b8a6', '#facc15', '#60a5fa', '#fb7185', '#34d399', '#e879f9', '#f97316'];
    tiles.forEach((c, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      k.rect(8.6 + col * 2.45, 6 + row * 2.6, 1.7, 1.7, 0.45, c);
    });
    k.rect(8.4, 17.9, 7.2, 2.2, 0.9, '#ffffff', ' opacity="0.22"');
    for (let c = 0; c < 3; c++) k.rect(8.9 + c * 2.25, 18.3, 1.5, 1.4, 0.4, ['#22c55e', '#38bdf8', '#f8fafc'][c]!);
    k.glare(7.85, 3.35, 8.3, 17.3);
  }),

  modem: art('modem', (k) => {
    // An ISP cable/fibre modem: white gloss, vented lid, a labelled column of link lights,
    // and the coax F-connector on its flank.
    k.path('M4.4 7H19.6L21 9H3Z', k.lin(0, 7, 0, 9, [[0, '#ffffff'], [1, '#cfd6de']]));
    k.line('M7 8H17', '#94a3b8', 0.45, ' stroke-dasharray="0.6 0.5"');
    k.rect(3, 9, 18, 9, 0.7, k.mat(9, 9, M.white));
    k.spec(3.4, 9.05, 17.2, 0.8);
    const lights: Array<[string, number, boolean]> = [[GREEN, -100, false], [GREEN, -500, false], [BLUE, -260, false], [BLUE, -820, false], [AMBER, -380, true]];
    lights.forEach(([c, d, w], i) => {
      k.led(5.6 + i * 2.4, 12.4, 0.4, c, d, w);
      k.rect(4.9 + i * 2.4, 13.6, 1.4, 0.35, 0.15, '#94a3b8');
    });
    k.rect(4.4, 15.6, 6, 0.5, 0.25, '#0369a1', ' opacity="0.8"');
    k.rect(17.8, 15, 2.2, 1.7, 0.3, '#cfd6de');
    k.circ(18.9, 15.85, 0.7, k.rad(18.7, 15.6, 0.9, [[0, '#fde68a'], [1, '#a16207']]));
    k.circ(18.9, 15.85, 0.2, '#1f2937');
    k.rect(4, 18, 2.4, 0.5, 0.25, '#94a3b8').rect(17.6, 18, 2.4, 0.5, 0.25, '#94a3b8');
  }),

  nas: art('nas', (k) => {
    // A desktop NAS: four tool-less drive trays behind a dark front, status and power.
    k.path('M17.4 3.6L19 3V20.4L17.4 21Z', k.lin(17.4, 0, 19, 0, [[0, '#2a3039'], [1, '#14181d']]));
    k.rect(5, 3, 12.6, 17.6, 0.9, k.mat(3, 17.6, M.black));
    k.spec(5.5, 3.1, 11.6, 0.45);
    k.led(6.4, 4.6, 0.3, GREEN, -120).led(7.6, 4.6, 0.3, BLUE, -640);
    k.circ(15.7, 4.6, 0.62, '#2b3139').circ(15.7, 4.6, 0.36, BLUE, ' class="nxLed" style="animation-delay:-300ms"');
    for (let i = 0; i < 4; i++) {
      const x = 6 + i * 2.65;
      k.rect(x, 6.2, 2.3, 12.4, 0.3, k.lin(x, 0, x + 2.3, 0, [[0, '#4b5360'], [0.5, '#5b6470'], [1, '#2b3139']]));
      k.mesh(x + 0.2, 6.5, 1.9, 9.2, 0.75, '#0b0e12');
      k.rect(x + 0.4, 16.3, 1.5, 1.6, 0.25, '#14181d');
      k.led(x + 1.15, 17.1, 0.24, i === 3 ? AMBER : GREEN, -i * 410, i === 3);
    }
    k.rect(6, 19.3, 3.4, 0.4, 0.15, '#0d9488');
    k.rect(5.6, 20.6, 2.4, 0.4, 0.2, '#0b0d10').rect(14.6, 20.6, 2.4, 0.4, 0.2, '#0b0d10');
  }),
};

const artFor = (type: DeviceType): Art => ART[type] ?? ART.generic;

/** Product-render markup (0..24 box) for a device type; its gradients live in the defs. */
export function deviceFlatArt(type: DeviceType): string {
  return artFor(type).body;
}

/** `<defs>` holding the gradients the given types' icons reference (each type once). */
export function deviceFlatDefs(types: Iterable<DeviceType>): string {
  const seen = new Set<Art>();
  for (const t of types) seen.add(artFor(t));
  return `<defs>${[...seen].map((a) => a.defs).join('')}</defs>`;
}

/** Every icon's gradients, for an SVG root that may draw any type (the canvas, the library). */
export const FLAT_ART_DEFS = deviceFlatDefs(Object.keys(ART) as DeviceType[]);
