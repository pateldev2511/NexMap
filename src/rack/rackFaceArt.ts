/**
 * Realistic rack faceplates — the one renderer every rack view draws through.
 *
 * Every unit is drawn the way 19" gear actually looks: a powder-coated or brushed
 * faceplate between two mounting ears (one captive screw per U), a silkscreened model
 * name, and the parts that make the kind recognisable at a glance — RJ45 jacks in
 * metal shields with link lights, SFP cages with dust plugs, hot-swap drive caddies,
 * PSU modules with handles, fan guards, a backlit UPS display, keystone strips.
 *
 * The SAME port rectangles drive the drawing and the cable hit-testing
 * ({@link devicePortLayout}), so a jack you see is exactly the jack you click.
 * Vendor looks (rackPhotoSkins) are themes over this renderer, not a second one —
 * which is what keeps skinned and unskinned gear from drifting apart.
 *
 * Output is literal-hex SVG element strings in absolute coordinates; gradients come
 * from the shared RACK_ART_DEFS ids, so editor, row view, and PNG/PDF export render
 * identically. Pure and deterministic.
 */
import type { Device } from '@/model/types';
import { escapeXml } from '@/io/export/buildSvg';
import { portLayout, PATCH_PORT_OPTS, type PortRect, type Rect } from './rackLayout';
import { isCableManager } from './panelKind';

const n = (v: number) => v.toFixed(1);

/** How a unit's front looks. Art only — power and depth rules keep using panelKind. */
export type FaceStyle =
  | 'switch'
  | 'firewall'
  | 'appliance'
  | 'patch'
  | 'fiber'
  | 'server'
  | 'gpu'
  | 'storage'
  | 'tape'
  | 'blade'
  | 'ups'
  | 'psu'
  | 'pc'
  | 'kvm'
  | 'cable-mgr'
  | 'brush'
  | 'shelf'
  | 'blank';

const hay = (d: Pick<Device, 'vendor' | 'model' | 'name'>) =>
  [d.vendor, d.model, d.name].filter(Boolean).join(' ').toLowerCase();

/** Pick the faceplate for a device from its type, accessory mark, and name/model. */
export function faceStyleFor(device: Device): FaceStyle {
  if (isCableManager(device)) return 'cable-mgr';
  const h = hay(device);
  const ports = device.interfaces ?? [];
  switch (device.type) {
    case 'switch':
      return 'switch';
    case 'firewall':
      return 'firewall';
    case 'router':
    case 'load-balancer':
    case 'wireless-controller':
    case 'access-point':
    case 'modem':
    case 'vpn-gateway':
    case 'nat-gateway':
    case 'internet-gateway':
      return 'appliance';
    case 'patch-panel':
      return /fib(er|re)|\blc\b|\bsc\b|\bmpo\b|odf/.test(h) || ports.some((p) => /^(lc|sc|mpo)/i.test(p.name)) ? 'fiber' : 'patch';
    case 'server':
    case 'vm':
    case 'container':
      // A blade face needs room for its blade bay: 4U and up, named or port-less.
      if ((device.ruSpan ?? 1) >= 4 && (/blade|chassis|m1000|synergy|ucs 5108/.test(h) || ((device.ruSpan ?? 1) >= 5 && ports.length === 0))) return 'blade';
      if (/\bgpu\b|dgx|hgx|a100|h100/.test(h)) return 'gpu';
      return 'server';
    case 'storage':
    case 'nas':
    case 'managed-db':
    case 'object-storage':
      return /tape|\blto\b|library/.test(h) ? 'tape' : 'storage';
    case 'ups':
      return /\bpsu\b|power\s*shelf/.test(h) ? 'psu' : 'ups';
    case 'end-user':
    case 'laptop':
      return /\bkvm\b|console drawer/.test(h) ? 'kvm' : 'pc';
    default:
      if (/\bkvm\b|console drawer/.test(h)) return 'kvm';
      if (/\bbrush/.test(h)) return 'brush';
      if (/^shelf\b|\bshelf( \d+)?$|cantilever/.test(h)) return 'shelf';
      return 'blank';
  }
}

/**
 * A port name that is an optical cage, not copper: Cisco-style speed prefixes
 * (Te/Tw/Fo/Hu…), Juniper xe-/et-, explicit SFP/QSFP, and NX-OS/EOS slot/port
 * Ethernet (Eth1/1). A bare eth0 or Ethernet1 is copper.
 */
const isOpticalPort = (name: string) =>
  /^(te|tw|fo|hu|xe-|et-|sfp|qsfp)/i.test(name) || /^eth(ernet)?\d+\/\d+/i.test(name);

/** Ear width for a panel (the mounting flange each side). */
function earW(p: Rect): number {
  return p.w >= 200 ? 11 : Math.max(2, p.w * 0.035);
}

/** Port-free strip on the left reserved for the silkscreen + controls, per style. */
function nameZoneFor(style: FaceStyle, p: Rect): number {
  switch (style) {
    case 'switch':
      return Math.min(130, p.w * 0.24);
    case 'firewall':
    case 'appliance':
      return Math.min(140, p.w * 0.25);
    case 'server':
    case 'gpu':
      return Math.min(112, p.w * 0.2);
    case 'pc':
    case 'kvm':
      return Math.min(132, p.w * 0.26);
    default:
      return Math.min(96, p.w * 0.18);
  }
}

/** Width of the right-hand uplink / console block the port field must leave clear. */
function rightBlockFor(style: FaceStyle, p: Rect): number {
  switch (style) {
    case 'switch':
      return Math.min(70, p.w * 0.13);
    case 'firewall':
      return Math.min(76, p.w * 0.14);
    case 'appliance':
      return Math.min(66, p.w * 0.12);
    default:
      return 12;
  }
}

/** Patch layout for a panel: the shared options, scaled down for a half-width bay. */
function patchOpts(p: Rect) {
  return { ...PATCH_PORT_OPTS, nameZone: Math.min(PATCH_PORT_OPTS.nameZone, p.w * 0.11), rightInset: Math.min(PATCH_PORT_OPTS.rightInset, p.w * 0.03) };
}

/** The storage / tape name zone (label, lights, I/O strip) left of the media. */
function storageZone(p: Rect): number {
  return Math.min(130, p.w * 0.23);
}

/**
 * The visible port rectangles for a device on a panel — the ONE layout both the art
 * and the cable hit markers use. Kinds without front ports (power, passive) return none.
 */
export function devicePortLayout(device: Device, panel: Rect): PortRect[] {
  const ports = (device.interfaces ?? []).map((i) => ({ id: i.id, name: i.name }));
  if (ports.length === 0) return [];
  const style = faceStyleFor(device);
  const p = panel;
  switch (style) {
    case 'patch':
    case 'fiber':
      // Real 1U patch panels run every keystone in ONE row, banked in 6s.
      // The label zone and inset shrink on a half-width bay so 24 keystones still fit.
      return portLayout(p, ports, patchOpts(p));
    case 'switch':
      // Two staggered rows (odd top / even bottom) in banks of 6, clear of the uplinks.
      return portLayout(p, ports, {
        groupEvery: 6,
        groupGap: 6,
        nameZone: nameZoneFor(style, p),
        rightInset: rightBlockFor(style, p),
        maxJack: 18,
      });
    case 'firewall':
      return portLayout(p, ports, {
        groupEvery: 4,
        groupGap: 6,
        nameZone: nameZoneFor(style, p),
        rightInset: rightBlockFor(style, p),
        maxJack: 16,
      });
    case 'appliance':
      // Router / LB / WLC: one sparse row; console + mgmt live in the right block.
      return portLayout(p, ports, {
        rows: 1,
        nameZone: nameZoneFor(style, p),
        rightInset: rightBlockFor(style, p),
        maxJack: 14,
      });
    case 'server':
    case 'gpu':
      return portLayout(p, ports, {
        gap: 3,
        nameZone: nameZoneFor(style, p),
        rightInset: Math.min(p.w * 0.44, 270),
        maxJack: 12,
        rows: ports.length <= 4 ? 1 : 2,
      });
    case 'pc':
    case 'kvm':
      return portLayout(p, ports, { rows: 1, nameZone: nameZoneFor(style, p), rightInset: p.w * 0.45, maxJack: 12 });
    case 'storage':
    case 'tape': {
      // Management / host ports sit in a small I/O strip at the bottom-left, inside
      // the name zone — never under the drive cage that starts at its edge.
      const E = earW(p);
      const h = Math.min(18, p.h * 0.6);
      const strip = { x: p.x + E + 4, y: p.y + p.h - h - 2, w: Math.max(8, storageZone(p) - E - 10), h };
      return portLayout(strip, ports, { rows: 1, nameZone: 0, rightInset: 0, gap: 3, maxJack: 11 });
    }
    case 'blade': {
      // A blade chassis carries its management ports in the top bezel, between the
      // name and the chassis LCD (the bottom is the PSU bay).
      const strip = { x: p.x + p.w * 0.42, y: p.y + 1.5, w: Math.min(170, p.w * 0.3), h: 11 };
      return portLayout(strip, ports, { rows: 1, nameZone: 0, rightInset: 0, gap: 3, maxJack: 11 });
    }
    default:
      return [];
  }
}

/** A brand look applied over the realistic renderer. */
export interface FaceTheme {
  /** Faceplate paint (a RACK_ART_DEFS url or hex). */
  plate: string;
  edge: string;
  /** Mounting-ear paint. */
  ear: string;
  text: string;
  textMut: string;
  /** Brand/type accent: stripe, power ring, bezel trim. */
  accent: string;
  /** Vendor badge on the faceplate (skinned gear only). */
  badge?: { text: string; fill: string; ink: string };
  /** The plate is light (silkscreen and mesh switch to dark ink). */
  light?: boolean;
  /** Server bezel trim style for vendor skins. */
  bezel?: 'honeycomb' | 'slats';
}

const TYPE_ACCENT: Record<string, string> = {
  router: '#2563eb',
  'load-balancer': '#ef4444',
  'wireless-controller': '#14b8a6',
  'access-point': '#14b8a6',
  modem: '#0369a1',
  'vpn-gateway': '#7c3aed',
  'nat-gateway': '#0369a1',
  'internet-gateway': '#0284c7',
};

/** The unbranded look: charcoal powder coat, accent from the device family. */
export function defaultTheme(device: Device, style: FaceStyle): FaceTheme {
  const accent =
    style === 'switch' ? '#0891b2'
    : style === 'firewall' ? '#dc2626'
    : style === 'appliance' ? (TYPE_ACCENT[device.type] ?? '#2563eb')
    : style === 'server' || style === 'gpu' || style === 'blade' ? '#059669'
    : style === 'storage' || style === 'tape' ? '#0d9488'
    : style === 'ups' || style === 'psu' ? '#d97706'
    : '#64748b';
  return {
    plate: style === 'patch' || style === 'fiber' ? 'url(#rkPatch)' : 'url(#rkMetal)',
    edge: '#06090d',
    ear: 'url(#rkEar)',
    text: '#e7edf4',
    textMut: '#9fb0c2',
    accent,
  };
}

// ── primitives ───────────────────────────────────────────────────────────────

/** Smallest silkscreen that still reads at 100% zoom. */
const MIN_FONT = 5.5;

/**
 * Scale a monospace label DOWN until the whole string fits. Only a string too long even
 * at the smallest legible size is shortened — in the middle, so both the vendor and the
 * model number (usually at the end) survive.
 */
function fitLabel(text: string, maxFont: number, availW: number): { text: string; fontSize: number } {
  const t = text.trim();
  const fontSize = Math.max(MIN_FONT, Math.min(maxFont, availW / Math.max(1, t.length * 0.6)));
  const fits = Math.floor(availW / (fontSize * 0.6) + 1e-6);
  if (t.length <= fits || fits < 5) return { text: t, fontSize };
  const head = Math.ceil((fits - 1) / 2);
  return { text: `${t.slice(0, head)}…${t.slice(t.length - (fits - 1 - head))}`, fontSize };
}

/**
 * The silkscreen: vendor + model (or the name) on top, the device name below when the
 * plate is tall enough. Both lines carry data-facelabel so "hide faceplate text" drops
 * them on every path; brand badges and port numbers are not labels.
 */
function silkscreen(
  device: Device,
  x: number,
  y: number,
  availW: number,
  th: FaceTheme,
  h: number,
  maxFont = Math.max(7, Math.min(10.5, h * 0.3)),
  omitVendor = false,
): string[] {
  // Next to a vendor badge the logo already says who made it; print the model.
  const vendorModel = (omitVendor ? [device.model] : [device.vendor, device.model]).filter(Boolean).join(' ');
  const primary = vendorModel || device.name;
  const secondary = vendorModel ? device.name : '';
  const fit = fitLabel(primary, maxFont, availW);
  const ink = th.light ? '#172033' : th.text;
  const out = [
    `<text data-facelabel="1" x="${n(x)}" y="${n(y)}" font-family="ui-monospace,Menlo,monospace" font-size="${n(fit.fontSize)}" font-weight="800" letter-spacing="0.2" fill="${ink}">${escapeXml(fit.text)}</text>`,
  ];
  if (secondary && h >= 44) {
    const sec = fitLabel(secondary, 8, availW);
    out.push(
      `<text data-facelabel="1" x="${n(x)}" y="${n(y + fit.fontSize + 3)}" font-family="ui-monospace,Menlo,monospace" font-size="${n(sec.fontSize)}" fill="${th.light ? '#475569' : th.textMut}">${escapeXml(sec.text)}</text>`,
    );
  }
  return out;
}

function badgeW(th: FaceTheme): number {
  return th.badge ? Math.min(64, Math.max(30, Math.min(14, th.badge.text.length) * 5.2 + 10)) : 0;
}

function badge(th: FaceTheme, x: number, y: number): string {
  if (!th.badge) return '';
  const t = escapeXml(th.badge.text.slice(0, 14));
  const w = badgeW(th);
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="10" rx="2" fill="${th.badge.fill}" stroke="${th.accent}" stroke-width="0.7"/>` +
    `<text x="${n(x + w / 2)}" y="${n(y + 7.4)}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="6.6" font-weight="900" letter-spacing="0.4" fill="${th.badge.ink}">${t}</text>`
  );
}

/** A status LED with a glow core (gradient ids from RACK_ART_DEFS). */
function led(cx: number, cy: number, r: number, color: 'G' | 'A' | 'B' | 'R' | 'off' = 'G'): string {
  if (color === 'off') return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#1a2028" stroke="#05080c" stroke-width="0.4"/>`;
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#rkLed${color})"/>`;
}

/**
 * An RJ45 jack: stamped metal shield, dark cavity with gold contacts and the latch
 * notch, link (green) and activity (amber) lights in the upper corners.
 */
function rj45(j: Rect, lit = true): string {
  const { x, y, w, h } = j;
  const notchW = Math.max(2.4, w * 0.34);
  const ledR = Math.max(0.8, Math.min(1.5, w * 0.09));
  // The cavity IS the jack rect; its stroke is the stamped shield (one element, not two).
  let s =
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="1" fill="#05080c" stroke="url(#rkJack)" stroke-width="1.1"/>` +
    `<rect x="${n(x + (w - notchW) / 2)}" y="${n(y + h - 1.6)}" width="${n(notchW)}" height="2" fill="#05080c"/>`;
  if (w >= 12) s += `<path d="M ${n(x + w * 0.24)} ${n(y + 2.2)} h ${n(w * 0.52)}" stroke="#b08d2c" stroke-width="0.9" stroke-dasharray="0.6 0.7"/>`;
  if (lit) s += led(x + ledR + 1.3, y + ledR + 1.3, ledR, 'G') + led(x + w - ledR - 1.3, y + ledR + 1.3, ledR, 'A');
  return s;
}

/** An SFP/QSFP cage: steel frame, a dust plug or a seated optic with its pull-tab. */
function sfp(j: Rect, seated = false): string {
  const { x, y, h } = j;
  const w = Math.max(4, j.w);
  let s =
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="0.8" fill="url(#rkCage)" stroke="#2b3542" stroke-width="0.5"/>` +
    `<rect x="${n(x + 1.1)}" y="${n(y + h * 0.28)}" width="${n(w - 2.2)}" height="${n(h * 0.46)}" rx="0.5" fill="#05080c"/>`;
  s += seated
    ? `<rect x="${n(x + 1.6)}" y="${n(y + h * 0.33)}" width="${n(w - 3.2)}" height="${n(h * 0.36)}" rx="0.4" fill="#9aa6b2"/><rect x="${n(x + w / 2 - 1.2)}" y="${n(y + h * 0.36)}" width="2.4" height="${n(h * 0.3)}" fill="#2563eb"/>`
    : `<rect x="${n(x + 1.6)}" y="${n(y + h * 0.33)}" width="${n(w - 3.2)}" height="${n(h * 0.36)}" rx="0.4" fill="#1f2937"/>`;
  return s;
}

/** A fan behind a wire guard: concentric guard rings, swept blades, hub. */
function fan(cx: number, cy: number, r: number): string {
  let s = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#06090d" stroke="#3b4654" stroke-width="0.9"/>`;
  for (let i = 0; i < 5; i++) {
    const a0 = (i * 72 * Math.PI) / 180;
    const a1 = a0 + 0.9;
    const r0 = r * 0.3;
    const r1 = r * 0.88;
    s += `<path d="M ${n(cx + r0 * Math.cos(a0))} ${n(cy + r0 * Math.sin(a0))} Q ${n(cx + r1 * Math.cos(a0 + 0.2))} ${n(cy + r1 * Math.sin(a0 + 0.2))} ${n(cx + r1 * Math.cos(a1))} ${n(cy + r1 * Math.sin(a1))}" fill="none" stroke="#2b3542" stroke-width="${n(Math.max(1, r * 0.22))}" stroke-linecap="round"/>`;
  }
  s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.66)}" fill="none" stroke="#5b6778" stroke-width="0.6"/>`;
  s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.36)}" fill="none" stroke="#5b6778" stroke-width="0.6"/>`;
  s += `<line x1="${n(cx - r)}" y1="${n(cy)}" x2="${n(cx + r)}" y2="${n(cy)}" stroke="#5b6778" stroke-width="0.6"/>`;
  s += `<line x1="${n(cx)}" y1="${n(cy - r)}" x2="${n(cx)}" y2="${n(cy + r)}" stroke="#5b6778" stroke-width="0.6"/>`;
  s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.2)}" fill="url(#rkHub)"/>`;
  return s;
}

/** Perforated intake: staggered rows of round holes (dashed strokes keep it cheap). */
function perforation(x: number, y: number, w: number, h: number, light = false, pitch = 3.2): string[] {
  if (w < 6 || h < 4) return [];
  const rows = Math.max(1, Math.floor((h - 1) / pitch));
  const hole = light ? '#7b8794' : '#04070a';
  // Every row is a subpath of ONE path (dashing restarts per subpath, so each
  // row's offset staggers the holes): a 4U intake is one element, not forty.
  let d = '';
  for (let r = 0; r < rows; r++) {
    const yy = y + pitch / 2 + r * pitch + (h - rows * pitch) / 2;
    const off = r % 2 ? pitch / 2 : 0;
    d += `M ${n(x + off + 1)} ${n(yy)} H ${n(x + w - 1)} `;
  }
  return [`<path d="${d.trim()}" stroke="${hole}" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="0.01 ${n(pitch)}"/>`];
}

/** Hot-swap drive caddy. `vertical` = 2.5" SFF carrier standing on its edge. */
function caddy(x: number, y: number, w: number, h: number, vertical: boolean, ledColor: 'G' | 'A' = 'G'): string {
  let s = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="1.2" fill="url(#rkCaddy)" stroke="#04070a" stroke-width="0.6"/>`;
  if (vertical) {
    s += perforation(x + 1.4, y + 2, w - 2.8, h * 0.62, false, 2.4).join('');
    s += `<rect x="${n(x + 1.2)}" y="${n(y + h * 0.72)}" width="${n(w - 2.4)}" height="${n(h * 0.2)}" rx="0.8" fill="url(#rkHandle)"/>`;
    s += led(x + w / 2, y + h - 2.2, 0.9, ledColor);
  } else {
    s += perforation(x + 2, y + 1.4, w * 0.62, h - 2.8, false, 2.4).join('');
    s += `<rect x="${n(x + w * 0.7)}" y="${n(y + 1.2)}" width="${n(w * 0.22)}" height="${n(h - 2.4)}" rx="0.8" fill="url(#rkHandle)"/>`;
    s += led(x + w - 2.2, y + 2.4, 0.9, ledColor);
  }
  return s;
}

/** A hot-swap PSU module: handle, fan guard, status LED. */
function psuModule(x: number, y: number, w: number, h: number): string {
  let s = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="1.5" fill="url(#rkModule)" stroke="#04070a" stroke-width="0.7"/>`;
  const fr = Math.min(h * 0.36, w * 0.24);
  s += fan(x + fr + 4, y + h / 2, fr);
  s += `<rect x="${n(x + w - 9)}" y="${n(y + 3)}" width="5" height="${n(h - 6)}" rx="2.2" fill="url(#rkHandle)"/>`;
  s += led(x + fr * 2 + 9, y + h / 2, 1.3, 'G');
  return s;
}

/** A C13/C14 IEC socket: the trapezoid shroud with its three pins. */
function iec(cx: number, cy: number, w: number, inlet = false): string {
  const h = w * 0.78;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const cut = w * 0.22;
  return (
    `<path d="M ${n(x0)} ${n(y0)} H ${n(x0 + w)} V ${n(y0 + h - cut)} L ${n(x0 + w - cut)} ${n(y0 + h)} H ${n(x0 + cut)} L ${n(x0)} ${n(y0 + h - cut)} Z" fill="${inlet ? '#0b1016' : '#11161d'}" stroke="#5b6778" stroke-width="0.6"/>` +
    `<path d="M ${n(cx - w * 0.24)} ${n(cy - h * 0.06)} v ${n(h * 0.3)} M ${n(cx + w * 0.24)} ${n(cy - h * 0.06)} v ${n(h * 0.3)} M ${n(cx)} ${n(cy - h * 0.32)} v ${n(h * 0.24)}" stroke="${inlet ? '#c0a24a' : '#020406'}" stroke-width="${n(Math.max(0.8, w * 0.09))}" stroke-linecap="round"/>`
  );
}

/** A USB-A port. */
function usb(x: number, y: number): string {
  return `<rect x="${n(x)}" y="${n(y)}" width="7" height="3.6" rx="0.5" fill="#cfd6de" stroke="#2b3542" stroke-width="0.4"/><rect x="${n(x + 1)}" y="${n(y + 1.6)}" width="5" height="1.2" fill="#1d4ed8"/>`;
}

/** A recessed power button with a lit ring. */
function powerButton(cx: number, cy: number, r: number, ring = '#22c55e'): string {
  return (
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="url(#rkHub)" stroke="#04070a" stroke-width="0.6"/>` +
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.66)}" fill="none" stroke="${ring}" stroke-width="0.9" opacity="0.9"/>` +
    `<path d="M ${n(cx)} ${n(cy - r * 0.5)} v ${n(r * 0.42)}" stroke="#e5e9ee" stroke-width="0.8" stroke-linecap="round"/>`
  );
}

/**
 * The common unit: a soft shadow, the faceplate, a lit top edge, two mounting ears
 * with a captive screw per U.
 */
function frame(p: Rect, th: FaceTheme, earsOn = true): string[] {
  const E = earW(p);
  const out = [
    `<rect x="${n(p.x)}" y="${n(p.y + 1.4)}" width="${n(p.w)}" height="${n(p.h - 0.8)}" rx="2.5" fill="#020617" fill-opacity="0.38"/>`,
    `<rect x="${n(p.x)}" y="${n(p.y + 0.4)}" width="${n(p.w)}" height="${n(p.h - 0.8)}" rx="2.5" fill="${th.plate}" stroke="${th.edge}" stroke-width="0.9"/>`,
    `<rect x="${n(p.x + 1.2)}" y="${n(p.y + 1)}" width="${n(p.w - 2.4)}" height="${n(Math.min(p.h * 0.3, 10))}" rx="2" fill="url(#rkSheen)"/>`,
    `<rect x="${n(p.x + 1)}" y="${n(p.y + p.h - 2)}" width="${n(p.w - 2)}" height="1" fill="#000000" fill-opacity="0.35"/>`,
  ];
  if (earsOn && p.w >= 120) {
    const units = Math.max(1, Math.round(p.h / 30));
    for (const ex of [p.x, p.x + p.w - E]) {
      out.push(`<rect x="${n(ex)}" y="${n(p.y + 0.4)}" width="${n(E)}" height="${n(p.h - 0.8)}" rx="2" fill="${th.ear}" stroke="${th.edge}" stroke-width="0.6"/>`);
      // One captive screw per U: the heads, then every head's cross in a single path.
      let cross = '';
      for (let u = 0; u < units; u++) {
        const cy = p.y + (p.h / units) * (u + 0.5);
        out.push(`<circle cx="${n(ex + E / 2)}" cy="${n(cy)}" r="2.2" fill="url(#rkScrew)" stroke="#04070a" stroke-width="0.6"/>`);
        cross += `M ${n(ex + E / 2 - 1.2)} ${n(cy)} h 2.4 M ${n(ex + E / 2)} ${n(cy - 1.2)} v 2.4 `;
      }
      out.push(`<path d="${cross.trim()}" stroke="#3b4654" stroke-width="0.55"/>`);
    }
  }
  return out;
}

/** The body: the faceplate between the ears. */
function body(p: Rect): Rect {
  const E = p.w >= 120 ? earW(p) : 0;
  return { x: p.x + E + 3, y: p.y, w: p.w - 2 * E - 6, h: p.h };
}

/** Silkscreen + status lights in the left name zone. */
function leftZone(device: Device, p: Rect, b: Rect, zoneW: number, th: FaceTheme, hide: boolean, lights: Array<'G' | 'A' | 'B' | 'R' | 'off'>): string[] {
  const out: string[] = [];
  const top = p.y + Math.min(12, p.h * 0.42);
  // A branded unit wears its logo top-left: the model prints beside it on a 1U plate,
  // or on its own line beneath it where the plate is tall enough.
  const bw = badgeW(th);
  const stacked = bw > 0 && p.h >= 44;
  if (bw) out.push(badge(th, b.x + 2, top - 8.2));
  const lx = b.x + 2 + (bw && !stacked ? bw + 4 : 0);
  const labelY = stacked ? top + 11 : top;
  const avail = Math.max(24, zoneW - (lx - p.x) - 10);
  if (!hide) out.push(...silkscreen(device, lx, labelY, avail, th, p.h, undefined, bw > 0));
  const ly = p.y + p.h - Math.min(8, p.h * 0.26);
  lights.forEach((c, i) => out.push(led(b.x + 4 + i * 7, ly, 1.5, c)));
  return out;
}

// ── faces ────────────────────────────────────────────────────────────────────

function switchFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  const zone = nameZoneFor('switch', p);
  out.push(...leftZone(device, p, b, zone, th, hide, ['G', 'G', 'A', 'off']));
  // Console (blue RJ45) + USB + mode button at the end of the name zone.
  const cy = p.y + p.h - Math.min(9.5, p.h * 0.32);
  if (p.w >= 300) {
    out.push(`<rect x="${n(p.x + zone - 22)}" y="${n(cy - 3.6)}" width="9" height="7.2" rx="1" fill="#0f2c4a" stroke="#38bdf8" stroke-width="0.7"/>`);
    out.push(`<circle cx="${n(p.x + zone - 7)}" cy="${n(cy)}" r="2" fill="url(#rkHub)" stroke="#04070a" stroke-width="0.4"/>`);
  }
  const jacks = devicePortLayout(device, p);
  jacks.forEach((j, i) => out.push(isOpticalPort(j.name) ? sfp(j, i % 3 !== 2) : rj45(j, i % 5 !== 3)));
  // Uplink block: 2×2 SFP+ cages with their port LEDs.
  const rb = rightBlockFor('switch', p);
  const cw = Math.max(3, Math.min(22, (rb - 16) / 2));
  const ch = Math.min(9, (p.h - 10) / 2);
  // The block starts where the port grid's reserved inset does — never under a jack.
  const ux = p.x + p.w - rb + 6;
  // A thumbnail-sized plate has no room for the uplink block; real-size ones always do.
  if (p.w >= 200) {
    for (let c = 0; c < 2; c++) {
      for (let r = 0; r < 2; r++) out.push(sfp({ x: ux + c * (cw + 3), y: p.y + p.h / 2 - ch - 1 + r * (ch + 2), w: cw, h: ch }, r === 0));
    }
  }
  out.push(`<rect x="${n(b.x + 2)}" y="${n(p.y + p.h - 3.2)}" width="${n(Math.min(70, zone - 20))}" height="1.4" rx="0.7" fill="${th.accent}"/>`);
  return out;
}

function firewallFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  const zone = nameZoneFor('firewall', p);
  out.push(...leftZone(device, p, b, zone, th, hide, ['G', 'G', 'R', 'off']));
  for (const j of devicePortLayout(device, p)) out.push(isOpticalPort(j.name) ? sfp(j, true) : rj45(j));
  // Right block: HA / MGMT pair and a small status display.
  const rb = rightBlockFor('firewall', p);
  const rx = p.x + p.w - rb + 6;
  const cy = p.y + p.h / 2;
  out.push(`<rect x="${n(rx)}" y="${n(cy - 5)}" width="${n(Math.min(30, rb * 0.45))}" height="10" rx="1.4" fill="url(#rkLCD)" stroke="#2dd4bf" stroke-width="0.5"/>`);
  out.push(`<rect x="${n(rx + rb * 0.5)}" y="${n(cy - 4)}" width="10" height="8" rx="1" fill="#0f2c4a" stroke="#64748b" stroke-width="0.6"/>`);
  // Zone stripes: red (outside) / blue (inside).
  out.push(`<rect x="${n(b.x + 2)}" y="${n(p.y + p.h - 3.2)}" width="26" height="1.4" rx="0.7" fill="${th.accent}"/>`);
  out.push(`<rect x="${n(b.x + 31)}" y="${n(p.y + p.h - 3.2)}" width="26" height="1.4" rx="0.7" fill="#2563eb"/>`);
  return out;
}

function applianceFace(device: Device, p: Rect, th: FaceTheme, hide: boolean, vendor: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  const zone = nameZoneFor('appliance', p);
  out.push(...leftZone(device, p, b, zone, th, hide, ['G', 'G', 'off']));
  for (const j of devicePortLayout(device, p)) out.push(isOpticalPort(j.name) ? sfp(j, true) : rj45(j));
  const rb = rightBlockFor('appliance', p);
  const rx = p.x + p.w - rb + 6;
  const cy = p.y + p.h / 2;
  if (vendor) {
    // A branded appliance: a neutral MGMT port and its badge.
    out.push(`<rect x="${n(rx)}" y="${n(cy - 4)}" width="10" height="8" rx="1" fill="#0b1016" stroke="#64748b" stroke-width="0.6"/>`);
  } else {
    // Console (light-blue) + management (amber) pair, then USB.
    out.push(`<rect x="${n(rx)}" y="${n(cy - 4)}" width="10" height="8" rx="1" fill="#0f2c4a" stroke="#38bdf8" stroke-width="0.8"/>`);
    out.push(`<rect x="${n(rx + 13)}" y="${n(cy - 4)}" width="10" height="8" rx="1" fill="#2a1a04" stroke="#f59e0b" stroke-width="0.8"/>`);
    if (rb > 40) out.push(usb(rx + 27, cy - 1.8));
  }
  out.push(`<rect x="${n(b.x + 2)}" y="${n(p.y + p.h - 3.2)}" width="40" height="1.4" rx="0.7" fill="${th.accent}"/>`);
  return out;
}

function patchFace(device: Device, p: Rect, th: FaceTheme, hide: boolean, fiber: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  const jacks = devicePortLayout(device, p);
  if (!hide) {
    // Panels print their model along the bottom rail, under the keystone row — the
    // only strip wide enough for it; with no ports, it sits in the left zone.
    const first = jacks[0];
    const last = jacks[jacks.length - 1];
    const under = first && last ? first.y + first.h + 6.3 : 0;
    if (first && last && under <= p.y + p.h - 0.8) {
      out.push(...silkscreen(device, first.x, under, last.x + last.w - first.x, th, 0, MIN_FONT));
    } else {
      out.push(...silkscreen(device, b.x + 1, p.y + Math.min(12, p.h * 0.42), Math.max(20, patchOpts(p).nameZone - (b.x - p.x) - 4), th, p.h));
    }
  }
  if (jacks.length > 0) {
    // The write-on label strip the numbers sit on.
    const first = jacks[0]!;
    const last = jacks[jacks.length - 1]!;
    if (first.w >= 9 && p.h >= 26) {
      out.push(`<rect x="${n(first.x - 2)}" y="${n(first.y - 6.4)}" width="${n(last.x + last.w - first.x + 4)}" height="5.6" rx="0.8" fill="#e8ecf1" fill-opacity="0.92"/>`);
    }
  }
  jacks.forEach((j, i) => {
    if (fiber) {
      // LC duplex adapter: aqua (OM3/4) body, both ferrule bores in one path.
      const br = Math.min(j.w, j.h) * 0.16;
      const cy = j.y + j.h / 2;
      out.push(`<rect x="${n(j.x)}" y="${n(j.y)}" width="${n(j.w)}" height="${n(j.h)}" rx="1" fill="#22d3ee" fill-opacity="0.9" stroke="#0e7490" stroke-width="1"/>`);
      out.push(
        `<path d="M ${n(j.x + j.w * 0.3 - br)} ${n(cy)} a ${n(br)} ${n(br)} 0 1 0 ${n(br * 2)} 0 a ${n(br)} ${n(br)} 0 1 0 ${n(-br * 2)} 0 M ${n(j.x + j.w * 0.7 - br)} ${n(cy)} a ${n(br)} ${n(br)} 0 1 0 ${n(br * 2)} 0 a ${n(br)} ${n(br)} 0 1 0 ${n(-br * 2)} 0" fill="#05080c"/>`,
      );
    } else {
      // Keystone: dark jack framed by its white snap-in bezel (the stroke).
      out.push(`<rect x="${n(j.x)}" y="${n(j.y)}" width="${n(j.w)}" height="${n(j.h)}" rx="1" fill="#111827" stroke="#d5dbe2" stroke-width="1.2"/>`);
    }
    if (j.w >= 9 && p.h >= 26) {
      out.push(`<text x="${n(j.x + j.w / 2)}" y="${n(j.y - 1.6)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="5" fill="#334155">${i + 1}</text>`);
    }
  });
  if (th.badge) out.push(badge(th, b.x + 1, p.y + p.h - 12));
  return out;
}

function serverFace(device: Device, p: Rect, th: FaceTheme, hide: boolean, gpu: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  const zone = nameZoneFor('server', p);
  out.push(...leftZone(device, p, b, zone, th, hide, ['G', 'B']));
  out.push(powerButton(b.x + Math.min(zone - (b.x - p.x) - 12, 60), p.y + p.h - Math.min(8, p.h * 0.27), 3.2, th.accent));
  for (const j of devicePortLayout(device, p)) out.push(rj45(j));
  // Drive cage on the right: 2.5" SFF carriers standing up (1U: 10, 2U+: 2 rows of 12).
  // A GPU box keeps a short bank of drives up top; the rest of its face is intake.
  const areaW = Math.min(p.w * 0.44, 270) - 10;
  const areaX = p.x + p.w - earW(p) - 6 - areaW;
  const rows = gpu ? 1 : p.h >= 52 ? (p.h >= 100 ? 3 : 2) : 1;
  const cols = rows === 1 ? 10 : 12;
  const gap = 1.6;
  const cw = (areaW - (cols - 1) * gap) / cols;
  const cageH = gpu ? Math.min(34, p.h * 0.32) : p.h - 4;
  const chH = (cageH - 2 - (rows - 1) * gap) / rows;
  out.push(`<rect x="${n(areaX - 3)}" y="${n(p.y + 2)}" width="${n(areaW + 6)}" height="${n(cageH)}" rx="1.6" fill="#05080c"/>`);
  if (gpu) {
    const my = p.y + cageH + 5;
    out.push(`<rect x="${n(areaX - 3)}" y="${n(my)}" width="${n(areaW + 6)}" height="${n(p.y + p.h - 3 - my)}" rx="1.5" fill="#0b1016"/>`);
    out.push(...perforation(areaX - 3, my, areaW + 6, p.y + p.h - 3 - my, false, 2.6));
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(caddy(areaX + c * (cw + gap), p.y + 3 + r * (chH + gap), cw, chH, true, r * cols + c === 5 ? 'A' : 'G'));
    }
  }
  // Intake between the NICs and the drives (a GPU box is mostly intake).
  const jacks = devicePortLayout(device, p);
  const meshX = jacks.length ? Math.max(...jacks.map((j) => j.x + j.w)) + 8 : p.x + zone + 4;
  const meshW = areaX - 8 - meshX;
  if (meshW > 12) {
    out.push(`<rect x="${n(meshX)}" y="${n(p.y + 3)}" width="${n(meshW)}" height="${n(p.h - 6)}" rx="1.5" fill="${gpu ? '#0b1016' : '#11161d'}"/>`);
    out.push(...perforation(meshX, p.y + 3, meshW, p.h - 6, false, gpu ? 2.6 : 3.2));
    if (th.bezel === 'honeycomb' || th.bezel === 'slats') {
      out.push(`<rect x="${n(meshX)}" y="${n(p.y + 3)}" width="${n(meshW)}" height="${n(p.h - 6)}" rx="1.5" fill="none" stroke="${th.accent}" stroke-width="0.9" opacity="0.8"/>`);
    }
  }
  if (p.h >= 52) {
    out.push(`<rect x="${n(b.x + 2)}" y="${n(p.y + p.h - 22)}" width="38" height="9" rx="1.5" fill="url(#rkLCD)" stroke="#2dd4bf" stroke-width="0.5"/>`);
    out.push(`<text x="${n(b.x + 5)}" y="${n(p.y + p.h - 15.6)}" font-family="ui-monospace,Menlo,monospace" font-size="5.2" fill="#99f6e4">OK</text>`);
  }
  return out;
}

function storageFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  const zone = storageZone(p);
  out.push(...leftZone(device, p, b, zone, th, hide, p.h >= 44 ? [] : ['G', 'G']));
  if (p.h >= 44) {
    for (let i = 0; i < 3; i++) out.push(led(b.x + 4 + i * 7, p.y + Math.min(30, p.h * 0.5), 1.5, i === 2 ? 'B' : 'G'));
  }
  for (const j of devicePortLayout(device, p)) out.push(rj45(j));
  // 3.5" LFF carriers lying flat: 4 across, as many rows as the height holds.
  const areaX = p.x + zone;
  const areaW = p.x + p.w - earW(p) - 6 - areaX;
  const rows = Math.max(1, Math.round(p.h / 30));
  const cols = Math.max(3, Math.min(6, Math.round(areaW / 70)));
  const gap = 2;
  const cw = (areaW - (cols - 1) * gap) / cols;
  const chH = (p.h - 6 - (rows - 1) * gap) / rows;
  out.push(`<rect x="${n(areaX - 3)}" y="${n(p.y + 2)}" width="${n(areaW + 6)}" height="${n(p.h - 4)}" rx="1.6" fill="#05080c"/>`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push(caddy(areaX + c * (cw + gap), p.y + 3 + r * (chH + gap), cw, chH, false, (r + c) % 7 === 4 ? 'A' : 'G'));
  }
  return out;
}

function tapeFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  const zone = storageZone(p);
  out.push(...leftZone(device, p, b, zone, th, hide, ['G', 'A']));
  for (const j of devicePortLayout(device, p)) out.push(rj45(j));
  // Operator panel display, then the cartridge magazines behind a smoked window.
  const dx = p.x + zone;
  const dw = Math.min(54, p.w * 0.1);
  out.push(`<rect x="${n(dx)}" y="${n(p.y + 4)}" width="${n(dw)}" height="${n(Math.min(18, p.h - 8))}" rx="1.6" fill="url(#rkLCD)" stroke="#2dd4bf" stroke-width="0.5"/>`);
  if (dw >= 30) out.push(`<text x="${n(dx + 4)}" y="${n(p.y + 12)}" font-family="ui-monospace,Menlo,monospace" font-size="5.5" fill="#99f6e4">READY</text>`);
  const mx = dx + dw + 8;
  const mw = p.x + p.w - earW(p) - 10 - mx;
  if (mw >= 24) {
    out.push(`<rect x="${n(mx)}" y="${n(p.y + 3)}" width="${n(mw)}" height="${n(p.h - 6)}" rx="2" fill="#0b1016" stroke="#334155" stroke-width="0.6"/>`);
    const carts = Math.max(4, Math.floor(mw / 9));
    const cw = (mw - 6) / carts;
    for (let i = 0; i < carts; i++) {
      out.push(`<rect x="${n(mx + 3 + i * cw)}" y="${n(p.y + 6)}" width="${n(cw - 1.6)}" height="${n(p.h - 12)}" rx="0.6" fill="${['#1e3a8a', '#273241', '#134e4a', '#273241'][i % 4]}" opacity="0.9"/>`);
    }
    out.push(`<rect x="${n(mx)}" y="${n(p.y + 3)}" width="${n(mw)}" height="${n((p.h - 6) * 0.4)}" rx="2" fill="#ffffff" fill-opacity="0.06"/>`);
  }
  return out;
}

function bladeFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  // Top bezel strip: name + chassis LCD; then half-height blades; then the PSU bay.
  const strip = 14;
  // The name runs up to the I/O strip at 42% of the width (see devicePortLayout).
  if (!hide) out.push(...silkscreen(device, b.x + 2, p.y + 10, p.w * 0.42 - (b.x - p.x) - 8, th, 30));
  out.push(`<rect x="${n(b.x + b.w - 46)}" y="${n(p.y + 3)}" width="44" height="9" rx="1.4" fill="url(#rkLCD)" stroke="#2dd4bf" stroke-width="0.5"/>`);
  const psuH = Math.max(14, Math.min(26, p.h * 0.17));
  const io = devicePortLayout(device, p);
  for (const j of io) out.push(rj45(j));
  const bayY = p.y + strip;
  const bayH = p.h - strip - psuH - 4;
  const rows = bayH >= 90 ? 2 : 1;
  const cols = 8;
  const gap = 2;
  const bw = (b.w - (cols - 1) * gap) / cols;
  const bh = (bayH - (rows - 1) * gap) / rows;
  out.push(`<rect x="${n(b.x - 1)}" y="${n(bayY - 1)}" width="${n(b.w + 2)}" height="${n(bayH + 2)}" rx="1.6" fill="#05080c"/>`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = b.x + c * (bw + gap);
      const y = bayY + r * (bh + gap);
      out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(bw)}" height="${n(bh)}" rx="1.2" fill="url(#rkModule)" stroke="#04070a" stroke-width="0.6"/>`);
      out.push(...perforation(x + 3, y + 4, bw - 6, bh * 0.55, false, 3));
      out.push(`<rect x="${n(x + 3)}" y="${n(y + bh * 0.66)}" width="${n(bw - 6)}" height="${n(Math.min(7, bh * 0.12))}" rx="1.5" fill="url(#rkHandle)"/>`);
      out.push(powerButton(x + bw / 2, y + bh - 7, 2.6, th.accent));
      out.push(led(x + 5, y + bh - 7, 1.2, 'G'));
      out.push(led(x + bw - 5, y + bh - 7, 1.2, (r * cols + c) % 9 === 5 ? 'A' : 'B'));
    }
  }
  const psuY = p.y + p.h - psuH - 2;
  const psuW = (b.w - 5 * 3) / 6;
  for (let i = 0; i < 6; i++) out.push(psuModule(b.x + i * (psuW + 3), psuY, psuW, psuH));
  if (th.badge) out.push(badge(th, b.x + b.w - 116, p.y + 2.5));
  return out;
}

function upsFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  // A bezel grille across the face, the operator panel on the left third.
  const panelW = Math.min(160, b.w * 0.34);
  if (!hide) out.push(...silkscreen(device, b.x + 2, p.y + Math.min(12, p.h * 0.42), panelW - 6, th, Math.min(p.h, 40)));
  const lcdY = p.y + Math.max(p.h * 0.42, 15);
  const lcdH = Math.max(9, Math.min(22, p.h - (lcdY - p.y) - 5));
  const lcdW = Math.max(10, Math.min(80, panelW - 34));
  out.push(`<rect x="${n(b.x + 2)}" y="${n(lcdY)}" width="${n(lcdW)}" height="${n(lcdH)}" rx="1.6" fill="url(#rkLCD)" stroke="#2dd4bf" stroke-width="0.6"/>`);
  // Charge bar: five segments where the display is wide enough to show them.
  const segs = lcdW >= 30 ? 5 : 0;
  const segW = (lcdW - 10) / 5;
  for (let i = 0; i < segs; i++) {
    out.push(`<rect x="${n(b.x + 5 + i * segW)}" y="${n(lcdY + lcdH - 6)}" width="${n(segW - 1.4)}" height="3.4" rx="0.6" fill="url(#rkLedG)"/>`);
  }
  if (lcdH >= 14) out.push(`<text x="${n(b.x + 5)}" y="${n(lcdY + 7)}" font-family="ui-monospace,Menlo,monospace" font-size="5.4" fill="#ccfbf1">ONLINE 230V</text>`);
  // Buttons under / beside the display.
  const bx = b.x + lcdW + 8;
  out.push(powerButton(bx + 5, lcdY + lcdH / 2, Math.min(4, lcdH / 2.4), th.accent));
  for (let i = 0; i < 2; i++) out.push(`<rect x="${n(bx + 13 + i * 9)}" y="${n(lcdY + lcdH / 2 - 2.5)}" width="7" height="5" rx="1.2" fill="url(#rkHub)" stroke="#04070a" stroke-width="0.4"/>`);
  // Grille to the right.
  const gx = b.x + panelW + 6;
  const gw = b.x + b.w - gx;
  out.push(`<rect x="${n(gx)}" y="${n(p.y + 3)}" width="${n(gw)}" height="${n(p.h - 6)}" rx="1.8" fill="#0b1016"/>`);
  let slats = '';
  for (let i = 0; i < Math.floor(gw / 6); i++) slats += `M ${n(gx + 3.6 + i * 6)} ${n(p.y + 6.6)} V ${n(p.y + p.h - 6.6)} `;
  out.push(`<path d="${slats.trim()}" stroke="#2a313b" stroke-width="3.2" stroke-linecap="round"/>`);
  if (th.badge) out.push(badge(th, gx + gw / 2 - 24, p.y + p.h / 2 - 5));
  return out;
}

function psuFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  const zone = Math.min(110, b.w * 0.2);
  out.push(...leftZone(device, p, b, zone, th, hide, ['G', 'G', 'off']));
  const mods = Math.max(2, Math.min(6, Math.floor((b.w - zone) / 70)));
  const mw = (b.w - zone - (mods - 1) * 4) / mods;
  for (let i = 0; i < mods; i++) out.push(psuModule(b.x + zone + i * (mw + 4), p.y + 3, mw, p.h - 6));
  return out;
}

function pcFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  const zone = nameZoneFor('pc', p);
  out.push(...leftZone(device, p, b, zone, th, hide, ['G', 'off']));
  for (const j of devicePortLayout(device, p)) out.push(rj45(j));
  // Slim optical drive slot, two USB, power button, then a vent block.
  const rx = p.x + p.w * 0.55;
  const cy = p.y + p.h / 2;
  out.push(`<rect x="${n(rx)}" y="${n(cy - 3)}" width="${n(p.w * 0.16)}" height="6" rx="1" fill="#0b1016" stroke="#334155" stroke-width="0.5"/>`);
  out.push(`<rect x="${n(rx + 4)}" y="${n(cy - 0.5)}" width="${n(p.w * 0.16 - 8)}" height="1" fill="#475569"/>`);
  out.push(usb(rx + p.w * 0.16 + 8, cy - 1.8), usb(rx + p.w * 0.16 + 18, cy - 1.8));
  out.push(powerButton(rx + p.w * 0.16 + 36, cy, 3.4, th.accent));
  const vx = rx + p.w * 0.16 + 46;
  const vw = p.x + p.w - earW(p) - 8 - vx;
  if (vw > 10) out.push(...perforation(vx, p.y + 4, vw, p.h - 8));
  return out;
}

function kvmFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  // A 1U console drawer, closed: a full-width handle bar, the lid seam, latch and LEDs.
  const out = frame(p, th);
  const b = body(p);
  const zone = nameZoneFor('kvm', p);
  out.push(...leftZone(device, p, b, zone, th, hide, ['G', 'B']));
  for (const j of devicePortLayout(device, p)) out.push(rj45(j));
  const hx = p.x + p.w * 0.55;
  const hw = p.x + p.w - earW(p) - 10 - hx;
  out.push(`<rect x="${n(hx)}" y="${n(p.y + p.h * 0.32)}" width="${n(hw)}" height="${n(p.h * 0.36)}" rx="${n(p.h * 0.18)}" fill="url(#rkHandle)" stroke="#04070a" stroke-width="0.5"/>`);
  out.push(`<rect x="${n(hx + hw / 2 - 8)}" y="${n(p.y + p.h * 0.42)}" width="16" height="${n(p.h * 0.16)}" rx="1" fill="#1f2937"/>`);
  return out;
}

function cableMgrFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, { ...th, plate: '#1a1f26' });
  const b = body(p);
  // Plastic finger duct: a row of D-shaped fingers across a slotted channel.
  out.push(`<rect x="${n(b.x)}" y="${n(p.y + p.h * 0.36)}" width="${n(b.w)}" height="${n(p.h * 0.28)}" rx="1" fill="#0b0e12"/>`);
  const count = Math.max(6, Math.floor(b.w / 34));
  const pitch = b.w / count;
  const fw = Math.min(pitch * 0.4, 10);
  // All fingers in one path (a 42U row of managers stays light): rounded plastic bars
  // with the dark channel showing between them, a lit edge down each.
  let fingers = '';
  let edges = '';
  const reach = Math.max(0, p.h - 6 - fw);
  for (let i = 0; i < count; i++) {
    const cx = b.x + i * pitch + pitch / 2;
    fingers += `M ${n(cx)} ${n(p.y + 3 + fw / 2)} v ${n(reach)} `;
    edges += `M ${n(cx - fw * 0.3)} ${n(p.y + 3 + fw / 2)} v ${n(reach)} `;
  }
  out.push(`<path d="${fingers.trim()}" stroke="#2f3742" stroke-width="${n(fw)}" stroke-linecap="round"/>`);
  out.push(`<path d="${edges.trim()}" stroke="#4b5563" stroke-width="0.8" stroke-linecap="round"/>`);
  // Stock managers carry no label; a renamed one gets a small tag on its first finger gap.
  if (!hide && !/^(cable manager( \d+)?|cm-?\d+)$/i.test(device.name.trim())) {
    out.push(`<rect x="${n(b.x + 2)}" y="${n(p.y + p.h / 2 - 5)}" width="${n(Math.min(120, device.name.length * 5 + 10))}" height="10" rx="2" fill="#0b0e12"/>`);
    out.push(...silkscreen(device, b.x + 6, p.y + p.h / 2 + 2.4, Math.min(112, b.w * 0.25), th, 0, 7));
  }
  return out;
}

function brushFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  // A slot full of nylon bristles meeting in the middle.
  const sy = p.y + p.h * 0.28;
  const sh = p.h * 0.44;
  out.push(`<rect x="${n(b.x + 4)}" y="${n(sy)}" width="${n(b.w - 8)}" height="${n(sh)}" rx="${n(sh / 2)}" fill="#06090d"/>`);
  out.push(`<path d="M ${n(b.x + 8)} ${n(sy + sh * 0.3)} H ${n(b.x + b.w - 8)} M ${n(b.x + 8)} ${n(sy + sh * 0.7)} H ${n(b.x + b.w - 8)}" stroke="#2b3542" stroke-width="${n(sh * 0.36)}" stroke-dasharray="0.6 0.9"/>`);
  if (!hide && p.h >= 44) out.push(...silkscreen(device, b.x + 4, p.y + 10, 140, th, 30));
  return out;
}

function shelfFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  // A cantilever shelf seen from the front: open above, a vented front lip below.
  const out: string[] = [];
  const E = earW(p);
  const lipH = Math.min(9, p.h * 0.3);
  out.push(`<rect x="${n(p.x + E)}" y="${n(p.y + 0.4)}" width="${n(p.w - 2 * E)}" height="${n(p.h - lipH)}" fill="#05080c" opacity="0.55"/>`);
  // The tray floor, seen just from above, running back into the cabinet.
  out.push(`<path d="M ${n(p.x + E + 6)} ${n(p.y + p.h - lipH - 6)} H ${n(p.x + p.w - E - 6)} L ${n(p.x + p.w - E)} ${n(p.y + p.h - lipH - 1)} H ${n(p.x + E)} Z" fill="url(#rkModule)"/>`);
  out.push(...frame({ x: p.x, y: p.y + p.h - lipH - 1, w: p.w, h: lipH + 1 }, th, false));
  out.push(...perforation(p.x + E + 8, p.y + p.h - lipH, p.w - 2 * E - 16, lipH - 2, false, 3));
  for (const ex of [p.x, p.x + p.w - E]) {
    out.push(`<rect x="${n(ex)}" y="${n(p.y + 0.4)}" width="${n(E)}" height="${n(p.h - 0.8)}" rx="2" fill="${th.ear}" stroke="${th.edge}" stroke-width="0.6"/>`);
    out.push(`<circle cx="${n(ex + E / 2)}" cy="${n(p.y + p.h - lipH / 2 - 0.5)}" r="2.1" fill="url(#rkScrew)" stroke="#04070a" stroke-width="0.4"/>`);
  }
  if (!hide) out.push(...silkscreen(device, p.x + E + 8, p.y + Math.min(12, p.h * 0.36), 160, th, 30));
  return out;
}

function blankFace(device: Device, p: Rect, th: FaceTheme, hide: boolean): string[] {
  const out = frame(p, th);
  const b = body(p);
  // Stamped stiffening ribs + snap rivets (cage-screw grey), no lights.
  const ribs = Math.max(1, Math.round(p.h / 30));
  for (let i = 0; i < ribs; i++) {
    const cy = p.y + (p.h / ribs) * (i + 0.5);
    out.push(`<rect x="${n(b.x + 16)}" y="${n(cy - 1.4)}" width="${n(b.w - 32)}" height="2.8" rx="1.4" fill="#000000" fill-opacity="0.32"/>`);
    out.push(`<rect x="${n(b.x + 16)}" y="${n(cy - 1.4)}" width="${n(b.w - 32)}" height="0.8" rx="0.4" fill="#ffffff" fill-opacity="0.08"/>`);
  }
  for (const sx of [b.x + 7, b.x + b.w - 7]) {
    out.push(`<circle cx="${n(sx)}" cy="${n(p.y + p.h / 2)}" r="2.6" fill="#3a4654" stroke="#06090d" stroke-width="0.6"/>`);
    out.push(`<path d="M ${n(sx - 1.6)} ${n(p.y + p.h / 2)} h 3.2" stroke="#05080c" stroke-width="0.7"/>`);
  }
  // A stock "Blank" says nothing; anything else that fell back here keeps its name.
  if (!hide && !/^blank( \d+)?$/i.test(device.name.trim())) {
    out.push(...silkscreen(device, b.x + 16, p.y + Math.min(12, p.h * 0.42), 160, th, 30));
  }
  return out;
}

/**
 * Front faceplate for a device in absolute coordinates, in a given theme. `vendor`
 * marks a skinned (branded) unit: it swaps the generic console pair for a branded
 * management port.
 */
export function frontFaceParts(device: Device, p: Rect, th: FaceTheme, hide = false, vendor = false): string[] {
  const style = faceStyleFor(device);
  switch (style) {
    case 'switch':
      return switchFace(device, p, th, hide);
    case 'firewall':
      return firewallFace(device, p, th, hide);
    case 'appliance':
      return applianceFace(device, p, th, hide, vendor);
    case 'patch':
      return patchFace(device, p, th, hide, false);
    case 'fiber':
      return patchFace(device, p, th, hide, true);
    case 'server':
      return serverFace(device, p, th, hide, false);
    case 'gpu':
      return serverFace(device, p, th, hide, true);
    case 'storage':
      return storageFace(device, p, th, hide);
    case 'tape':
      return tapeFace(device, p, th, hide);
    case 'blade':
      return bladeFace(device, p, th, hide);
    case 'ups':
      return upsFace(device, p, th, hide);
    case 'psu':
      return psuFace(device, p, th, hide);
    case 'pc':
      return pcFace(device, p, th, hide);
    case 'kvm':
      return kvmFace(device, p, th, hide);
    case 'cable-mgr':
      return cableMgrFace(device, p, th, hide);
    case 'brush':
      return brushFace(device, p, th, hide);
    case 'shelf':
      return shelfFace(device, p, th, hide);
    default:
      return blankFace(device, p, th, hide);
  }
}

/**
 * Rear faceplate of a full-depth chassis: what you actually see from the hot aisle —
 * redundant PSUs with C14 inlets, fan modules, the management / I/O block.
 */
export function rearFaceParts(device: Device, p: Rect, theme: FaceTheme, hide = false): string[] {
  const style = faceStyleFor(device);
  // The back of every chassis is bare dark sheet metal, whatever colour the bezel is.
  const th: FaceTheme = { ...theme, plate: 'url(#rkRear)', ear: 'url(#rkEar)', light: false };
  const out = frame(p, th);
  const b = body(p);
  if (!hide) out.push(...silkscreen(device, b.x + 2, p.y + Math.min(12, p.h * 0.42), Math.min(104, b.w * 0.19) - 8, th, Math.min(p.h, 40)));

  if (style === 'ups' || style === 'psu') {
    // Output receptacles in groups, the input cord, an EPO port.
    const cols = 8;
    const rows = p.h >= 54 ? 2 : 1;
    const ow = Math.min(15, (b.w * 0.6) / cols - 4);
    const sx = b.x + Math.min(120, b.w * 0.22);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) out.push(iec(sx + c * (ow + 5) + ow / 2, p.y + p.h / (rows + 1) * (r + 1), ow));
    }
    out.push(iec(b.x + b.w - 20, p.y + p.h / 2, 16, true));
    out.push(`<rect x="${n(b.x + b.w - 52)}" y="${n(p.y + p.h / 2 - 4)}" width="12" height="8" rx="1" fill="#0b1016" stroke="#ef4444" stroke-width="0.6"/>`);
    return out;
  }

  const tall = p.h >= 90;
  const compute = style === 'server' || style === 'gpu' || style === 'storage' || style === 'tape' || style === 'pc' || style === 'kvm';

  if (style === 'blade' && tall) {
    // Blade chassis rear: a wall of fan modules, a column of I/O modules, a PSU inlet row.
    const inletH = Math.max(16, p.h * 0.16);
    const topH = p.h - inletH - 10;
    const fanCols = 3;
    const fanRows = Math.max(2, Math.floor(topH / 46));
    const fw = Math.min(56, (b.w * 0.42) / fanCols - 4);
    const fh = topH / fanRows - 4;
    const fx0 = b.x + Math.min(120, b.w * 0.2);
    for (let r = 0; r < fanRows; r++) {
      for (let c = 0; c < fanCols; c++) {
        const x = fx0 + c * (fw + 4);
        const y = p.y + 5 + r * (fh + 4);
        out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(fw)}" height="${n(fh)}" rx="1.5" fill="url(#rkModule)" stroke="#04070a" stroke-width="0.6"/>`);
        out.push(fan(x + fw / 2, y + fh / 2 - 2, Math.min(fw, fh) * 0.36));
        out.push(led(x + fw - 5, y + fh - 4, 1.1, 'G'));
      }
    }
    const ioX = fx0 + fanCols * (fw + 4) + 8;
    const ioW = b.x + b.w - ioX;
    const mods = Math.max(2, Math.min(6, Math.floor(topH / 22)));
    const mh = topH / mods - 3;
    for (let i = 0; i < mods; i++) {
      const y = p.y + 5 + i * (mh + 3);
      out.push(`<rect x="${n(ioX)}" y="${n(y)}" width="${n(ioW)}" height="${n(mh)}" rx="1.2" fill="#0b1016" stroke="#334155" stroke-width="0.6"/>`);
      const cages = Math.max(2, Math.min(8, Math.floor((ioW - 20) / 20)));
      for (let c = 0; c < cages; c++) out.push(sfp({ x: ioX + 6 + c * 20, y: y + mh / 2 - 4, w: 16, h: 8 }, c % 3 !== 2));
      out.push(led(ioX + ioW - 6, y + mh / 2, 1.2, i === 1 ? 'A' : 'G'));
    }
    const iy = p.y + p.h - inletH - 4;
    const iw = (b.w - 5 * 4) / 6;
    for (let i = 0; i < 6; i++) {
      const x = b.x + i * (iw + 4);
      out.push(`<rect x="${n(x)}" y="${n(iy)}" width="${n(iw)}" height="${n(inletH)}" rx="1.4" fill="url(#rkModule)" stroke="#04070a" stroke-width="0.6"/>`);
      out.push(iec(x + iw * 0.3, iy + inletH / 2, Math.min(15, inletH * 0.6), true));
      out.push(led(x + iw * 0.62, iy + inletH / 2, 1.2, 'G'));
    }
    return out;
  }

  // Redundant PSUs on the right: handle, C14 inlet, a small exhaust fan, status light.
  const psuW = Math.min(64, b.w * 0.14);
  const psuH = Math.min(p.h - 6, p.h >= 54 ? 36 : 24);
  const psuY = tall ? p.y + p.h - psuH - 4 : p.y + (p.h - psuH) / 2;
  for (let i = 0; i < 2; i++) {
    const x = b.x + b.w - (i + 1) * psuW - i * 4;
    out.push(`<rect x="${n(x)}" y="${n(psuY)}" width="${n(psuW)}" height="${n(psuH)}" rx="1.5" fill="url(#rkModule)" stroke="#04070a" stroke-width="0.6"/>`);
    out.push(iec(x + psuW * 0.3, psuY + psuH / 2, Math.min(14, psuH * 0.55), true));
    if (compute) out.push(fan(x + psuW * 0.62, psuY + psuH / 2, Math.min(psuH * 0.3, 7)));
    out.push(`<rect x="${n(x + psuW - 9)}" y="${n(psuY + 3)}" width="5" height="${n(psuH - 6)}" rx="2.2" fill="url(#rkHandle)"/>`);
    out.push(led(x + psuW * 0.3, psuY + 3.5, 1.2, 'G'));
  }

  if (compute) {
    // Compute rear: onboard I/O (mgmt, NICs, USB, VGA), then PCIe slot covers —
    // some populated with a dual-port card. Fans live inside; you don't see them here.
    const right = b.x + b.w - 2 * psuW - 12;
    const ioX = b.x + Math.min(118, b.w * 0.21);
    const ioH = tall ? 28 : p.h - 8;
    const ioW = Math.min(150, right - ioX);
    // A tall array carries two controller canisters, stacked; a server has one I/O block.
    const ioYs = tall ? [p.y + 4, p.y + p.h - ioH - 4] : [p.y + 4];
    for (const ioY of ioYs) {
      out.push(`<rect x="${n(ioX)}" y="${n(ioY)}" width="${n(ioW)}" height="${n(ioH)}" rx="1.4" fill="#080c11" stroke="#1f2937" stroke-width="0.6"/>`);
      const jh = Math.min(10, ioH * 0.42);
      const jw = jh * 1.15;
      const jy = ioY + ioH / 2 - jh / 2;
      out.push(rj45({ x: ioX + 4, y: jy, w: jw, h: jh }, true));
      for (let i = 0; i < 4 && ioX + 10 + (i + 1) * (jw + 2) + jw < ioX + ioW - 34; i++) {
        out.push(rj45({ x: ioX + 10 + (i + 1) * (jw + 2), y: jy, w: jw, h: jh }, i < 2));
      }
      const ux = ioX + ioW - 30;
      out.push(usb(ux, ioY + ioH / 2 - 4.6), usb(ux, ioY + ioH / 2 + 1));
      out.push(`<path d="M ${n(ux + 9)} ${n(ioY + ioH / 2 - 3.2)} h 11 l -1.6 6.4 h -7.8 z" fill="#1d4ed8" stroke="#0b1016" stroke-width="0.5"/>`);
    }
    // PCIe slot covers, between the controllers on a tall array.
    const sx0 = ioX + ioW + 8;
    const slotW = 15;
    const slotTop = p.y + 4;
    const slotH = tall ? p.h - 8 - (psuH + 6) : p.h - 8;
    const slots = Math.max(0, Math.min(tall ? 10 : 8, Math.floor((right - sx0) / (slotW + 3))));
    for (let i = 0; i < slots; i++) {
      const x = sx0 + i * (slotW + 3);
      out.push(`<rect x="${n(x)}" y="${n(slotTop)}" width="${slotW}" height="${n(slotH)}" rx="1" fill="#141a21" stroke="#2b3542" stroke-width="0.5"/>`);
      out.push(`<line x1="${n(x + 2)}" y1="${n(slotTop + 3)}" x2="${n(x + slotW - 2)}" y2="${n(slotTop + 3)}" stroke="#6b7683" stroke-width="1.2"/>`);
      if (i % 3 === 0 && slotH >= 22) {
        const ch = Math.min(9, (slotH - 10) / 2 - 1);
        out.push(sfp({ x: x + 2, y: slotTop + 7, w: slotW - 4, h: ch }, true));
        out.push(sfp({ x: x + 2, y: slotTop + 9 + ch, w: slotW - 4, h: ch }, false));
      } else {
        out.push(...perforation(x + 2, slotTop + 6, slotW - 4, slotH - 9, false, 2.6));
      }
    }
    return out;
  }

  // Network gear: fan modules across the middle, then the management block.
  const fanR = Math.min(p.h * 0.34, p.h >= 54 ? 15 : 10.5);
  const fanCount = Math.max(2, Math.min(5, Math.floor((b.w * 0.36) / (fanR * 2 + 6))));
  const fx0 = b.x + Math.min(130, b.w * 0.24) + fanR;
  for (let i = 0; i < fanCount; i++) out.push(fan(fx0 + i * (fanR * 2 + 6), p.y + p.h / 2, fanR));
  const ioX = fx0 + fanCount * (fanR * 2 + 6);
  const ioW = Math.min(b.x + b.w - 2 * psuW - 10 - ioX, 62);
  if (ioW > 30) {
    out.push(`<rect x="${n(ioX)}" y="${n(p.y + 4)}" width="${n(ioW)}" height="${n(p.h - 8)}" rx="1.5" fill="#080c11" stroke="#1f2937" stroke-width="0.6"/>`);
    const jh = Math.min(9, p.h * 0.32);
    out.push(rj45({ x: ioX + 4, y: p.y + p.h / 2 - jh / 2, w: jh * 1.15, h: jh }, true));
    out.push(`<rect x="${n(ioX + 8 + jh * 1.15)}" y="${n(p.y + p.h / 2 - jh / 2)}" width="${n(jh * 1.15)}" height="${n(jh)}" rx="1" fill="#0f2c4a" stroke="#38bdf8" stroke-width="0.6"/>`);
    if (ioW > 50) out.push(usb(ioX + 12 + jh * 2.3, p.y + p.h / 2 - 1.8));
  }
  return out;
}
