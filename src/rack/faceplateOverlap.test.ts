/**
 * Faceplate collision regression test.
 *
 * This began as a throwaway audit and is permanent because of what it found: RJ45
 * jacks drawn ON TOP of vent slats on every 1U server (up to 9 of them on the
 * Dell/HPE skins) and on top of fan bodies at 2U and above. Nothing in the suite
 * compared drawn furniture against drawn ports, so it went unnoticed.
 *
 * It parses the REAL generated SVG rather than trusting the layout helpers, so it
 * catches a divergence between what is drawn and where ports are placed — the same
 * class of bug `PATCH_PORT_OPTS` warns about in rackLayout.ts.
 *
 * Both art paths are covered, because the bug existed in both: the generic art in
 * `rackDeviceArt.ts` and the per-vendor skins in `rackPhotoSkins.ts`.
 */
import { describe, expect, it } from 'vitest';
import { deviceFaceParts, devicePortLayout } from './rackDeviceArt';
import { deviceRect } from './rackLayout';
import type { Device, DeviceType, Rack } from '@/model/types';

const RACK: Rack = { id: 'rk', name: 'RK', ruHeight: 42 };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Box, b: Box): number => {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0.01 && oy > 0.01 ? ox * oy : 0;
};

const attr = (at: string, k: string): number => {
  const m = new RegExp(`${k}="([-\\d.]+)"`).exec(at);
  return m ? Number(m[1]) : NaN;
};

/**
 * Furniture is TAGGED in the art (`data-fx="vent|cage|drive|fan"`) rather than
 * identified by fill colour. The first version of this test sniffed fills and
 * silently missed two things: the switch skin paints its vents `#263241` and the
 * appliance skin `#111827`, so neither was ever checked — and Cisco's uplink colour
 * `#1f2937` doubles as a storage-bay fill, which mis-reported a cage collision as a
 * drive-bay one. Tags cannot drift like that.
 */
type Fx = 'vent' | 'cage' | 'drive' | 'fan';

function taggedRects(svg: string, fx: Fx): Box[] {
  const out: Box[] = [];
  for (const m of svg.matchAll(/<rect ([^>]*)\/>/g)) {
    const at = m[1]!;
    if ((/data-fx="([^"]*)"/.exec(at)?.[1] ?? '') !== fx) continue;
    const b = { x: attr(at, 'x'), y: attr(at, 'y'), w: attr(at, 'width'), h: attr(at, 'height') };
    if (!Object.values(b).some(Number.isNaN)) out.push(b);
  }
  return out;
}

function taggedFans(svg: string): { cx: number; cy: number; r: number }[] {
  const out: { cx: number; cy: number; r: number }[] = [];
  for (const m of svg.matchAll(/<circle ([^>]*)\/>/g)) {
    const at = m[1]!;
    if ((/data-fx="([^"]*)"/.exec(at)?.[1] ?? '') !== 'fan') continue;
    const c = { cx: attr(at, 'cx'), cy: attr(at, 'cy'), r: attr(at, 'r') };
    if (!Object.values(c).some(Number.isNaN)) out.push(c);
  }
  return out;
}

/** TRUE circle↔rect intersection — a bounding box would over-report. */
function circleHitsRect(c: { cx: number; cy: number; r: number }, r: Box): boolean {
  const nx = Math.max(r.x, Math.min(c.cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.cy, r.y + r.h));
  return (nx - c.cx) ** 2 + (ny - c.cy) ** 2 < c.r ** 2 - 0.01;
}

const mk = (
  type: DeviceType,
  ports: number,
  ruSpan: number,
  extra: Partial<Device> = {},
): Device => ({
  id: 'd',
  kind: 'device',
  type,
  name: 'DEV-01',
  x: 0,
  y: 0,
  width: 56,
  height: 40,
  layerId: 'L',
  rackId: 'rk',
  ru: 10,
  ruSpan,
  mount: 'rack',
  side: 'front',
  bay: 'full',
  interfaces: Array.from({ length: ports }, (_, i) => ({ id: `p${i}`, name: `${i + 1}` })),
  ...extra,
});

/** Generic art (no vendor) plus the vendor skins that own their own artwork. */
const VENDORS: { label: string; extra: Partial<Device> }[] = [
  { label: 'generic', extra: {} },
  { label: 'Dell', extra: { vendor: 'Dell', model: 'PowerEdge R650' } },
  { label: 'HPE', extra: { vendor: 'HPE', model: 'ProLiant DL380' } },
  { label: 'Cisco', extra: { vendor: 'Cisco', model: 'Catalyst 9200' } },
  { label: 'Arista', extra: { vendor: 'Arista', model: '7050X3' } },
  { label: 'Juniper', extra: { vendor: 'Juniper', model: 'EX4300' } },
  { label: 'Fortinet', extra: { vendor: 'Fortinet', model: 'FortiGate 100F' } },
  { label: 'Palo Alto', extra: { vendor: 'Palo Alto', model: 'PA-3220' } },
  { label: 'NetApp', extra: { vendor: 'NetApp', model: 'FAS2750' } },
  { label: 'Panduit', extra: { vendor: 'Panduit', model: 'Cat6 Patch Panel' } },
];

const TYPES: { type: DeviceType; ports: number[]; spans: number[] }[] = [
  { type: 'switch', ports: [8, 24, 48], spans: [1, 2] },
  { type: 'firewall', ports: [4, 8, 16], spans: [1, 2] },
  { type: 'router', ports: [2, 4, 8], spans: [1, 2] },
  { type: 'load-balancer', ports: [4, 8], spans: [1, 2] },
  { type: 'wireless-controller', ports: [2, 4], spans: [1] },
  { type: 'server', ports: [2, 4, 8, 12], spans: [1, 2, 3, 4] },
  { type: 'storage', ports: [4, 8], spans: [2, 4] },
  { type: 'patch-panel', ports: [24, 48], spans: [1, 2] },
];

/** Every (type × ports × span × vendor) combination the matrix covers. */
function* matrix(): Generator<{ tag: string; device: Device }> {
  for (const t of TYPES) {
    for (const ports of t.ports) {
      for (const span of t.spans) {
        for (const v of VENDORS) {
          yield {
            tag: `${v.label} ${t.type} ${ports}p ${span}U`,
            device: mk(t.type, ports, span, v.extra),
          };
        }
      }
    }
  }
}

describe('no drawn furniture sits under a port', () => {
  it('ports never overlap vent slats — in either art path, at any height', () => {
    const failures: string[] = [];
    for (const { tag, device } of matrix()) {
      const panel = deviceRect(RACK, device);
      const svg = deviceFaceParts(device, panel, 'front').join('');
      const vents = taggedRects(svg, 'vent');
      if (vents.length === 0) continue;
      for (const p of devicePortLayout(device, panel)) {
        for (const v of vents) {
          const a = overlap(p, v);
          if (a > 0) failures.push(`${tag}: port over vent by ${a.toFixed(1)}px²`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('ports never overlap a fan body', () => {
    const failures: string[] = [];
    for (const { tag, device } of matrix()) {
      const panel = deviceRect(RACK, device);
      const svg = deviceFaceParts(device, panel, 'front').join('');
      const fans = taggedFans(svg);
      if (fans.length === 0) continue;
      for (const p of devicePortLayout(device, panel)) {
        for (const f of fans) {
          if (circleHitsRect(f, p)) failures.push(`${tag}: port over fan`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('no port escapes its own panel', () => {
    const failures: string[] = [];
    for (const { tag, device } of matrix()) {
      const panel = deviceRect(RACK, device);
      for (const p of devicePortLayout(device, panel)) {
        if (
          p.x < panel.x - 0.01 ||
          p.y < panel.y - 0.01 ||
          p.x + p.w > panel.x + panel.w + 0.01 ||
          p.y + p.h > panel.y + panel.h + 0.01
        ) {
          failures.push(`${tag}: port outside panel`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('no two ports overlap each other', () => {
    const failures: string[] = [];
    for (const { tag, device } of matrix()) {
      const ports = devicePortLayout(device, deviceRect(RACK, device));
      for (let i = 0; i < ports.length; i++) {
        for (let j = i + 1; j < ports.length; j++) {
          if (overlap(ports[i]!, ports[j]!) > 0) failures.push(`${tag}: ports ${i}/${j} overlap`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('ports never overlap a drive bay', () => {
    const failures: string[] = [];
    for (const { tag, device } of matrix()) {
      const panel = deviceRect(RACK, device);
      const svg = deviceFaceParts(device, panel, 'front').join('');
      const bays = taggedRects(svg, 'drive');
      if (bays.length === 0) continue;
      for (const p of devicePortLayout(device, panel)) {
        for (const b of bays) {
          const a = overlap(p, b);
          if (a > 0) failures.push(`${tag}: port over drive bay by ${a.toFixed(1)}px²`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('ports never overlap an SFP cage', () => {
    const failures: string[] = [];
    for (const { tag, device } of matrix()) {
      const panel = deviceRect(RACK, device);
      const svg = deviceFaceParts(device, panel, 'front').join('');
      const cages = taggedRects(svg, 'cage');
      if (cages.length === 0) continue;
      for (const p of devicePortLayout(device, panel)) {
        for (const c of cages) {
          const a = overlap(p, c);
          if (a > 0) failures.push(`${tag}: port over SFP cage by ${a.toFixed(1)}px²`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('the matrix is actually exercising something (guards a vacuous pass)', () => {
    let withPorts = 0;
    let withVents = 0;
    let withFans = 0;
    let withDrives = 0;
    let withCages = 0;
    for (const { device } of matrix()) {
      const panel = deviceRect(RACK, device);
      const svg = deviceFaceParts(device, panel, 'front').join('');
      if (devicePortLayout(device, panel).length > 0) withPorts++;
      if (taggedRects(svg, 'vent').length > 0) withVents++;
      if (taggedFans(svg).length > 0) withFans++;
      if (taggedRects(svg, 'drive').length > 0) withDrives++;
      if (taggedRects(svg, 'cage').length > 0) withCages++;
    }
    expect(withPorts).toBeGreaterThan(100);
    expect(withVents).toBeGreaterThan(10);
    expect(withFans).toBeGreaterThan(10);
    // Without these two the drive-bay and cage checks passed VACUOUSLY: the
    // furniture was untagged, so their loops found nothing to compare against.
    expect(withDrives).toBeGreaterThan(10);
    expect(withCages).toBeGreaterThan(10);
  });
});
