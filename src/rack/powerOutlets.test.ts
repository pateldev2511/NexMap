/**
 * UPS / PDU outlets as real cablable ports.
 *
 * The property that matters most is the one that has bitten this codebase twice: the
 * DRAWN outlet and the HIT-TESTED outlet must be the same rect. The APC skin
 * previously drew no outlets at all — just a vent block — so a UPS read as a louvre
 * panel and had nothing to plug into.
 */
import { describe, expect, it } from 'vitest';
import { deviceFaceParts } from './rackDeviceArt';
import { devicePortLayout } from './portLayouts';
import { deviceRect } from './rackLayout';
import { portAt, portCenter } from './portHit';
import { isTransitive } from './cableTrace';
import {
  DEFAULT_OUTLET_MEDIA,
  isPowerDevice,
  isPowerDataMismatch,
  isPowerMedia,
  isPowerPort,
} from '@/model/powerPorts';
import type { Device, DeviceType, Interface, Rack } from '@/model/types';

const RACK: Rack = { id: 'rk', name: 'RK', ruHeight: 42 };

const iface = (id: string, partial: Partial<Interface> = {}): Interface => ({
  id,
  name: id,
  ...partial,
});

const mk = (
  type: DeviceType,
  ports: number,
  ruSpan: number,
  partial: Partial<Device> = {},
  media?: string,
): Device => ({
  id: 'd',
  kind: 'device',
  type,
  name: 'PWR-01',
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
  interfaces: Array.from({ length: ports }, (_, i) =>
    iface(`o${i + 1}`, media ? { kind: media } : {}),
  ),
  ...partial,
});

/** Outlet rects as DRAWN, read back off the generated SVG. */
function drawnOutlets(svg: string) {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const m of svg.matchAll(/<rect ([^>]*)\/>/g)) {
    const at = m[1]!;
    if ((/data-fx="([^"]*)"/.exec(at)?.[1] ?? '') !== 'outlet') continue;
    const num = (k: string) => Number(new RegExp(`${k}="([-\\d.]+)"`).exec(at)?.[1] ?? NaN);
    const b = { x: num('x'), y: num('y'), w: num('width'), h: num('height') };
    if (!Object.values(b).some(Number.isNaN)) out.push(b);
  }
  return out;
}

describe('classifying a power port', () => {
  it('only a UPS is a power device', () => {
    expect(isPowerDevice('ups')).toBe(true);
    for (const t of ['switch', 'server', 'patch-panel', 'router'] as DeviceType[]) {
      expect(isPowerDevice(t)).toBe(false);
    }
  });

  it('recognises mains connector families, case-insensitively', () => {
    for (const k of ['C13', 'c14', 'IEC C19', 'NEMA 5-15R', 'schuko', 'outlet']) {
      expect(isPowerMedia(k)).toBe(true);
    }
    for (const k of ['RJ45', 'LC/UPC', 'SFP+', undefined]) {
      expect(isPowerMedia(k)).toBe(false);
    }
  });

  it('a UPS port with no media is an outlet (back-compat with saved projects)', () => {
    // The library presets never set `kind`, so existing projects rely on this.
    const u = mk('ups', 2, 2);
    expect(isPowerPort(u, u.interfaces![0]!)).toBe(true);
  });

  it('an EXPLICIT data media on a UPS wins — an NMC port is not an outlet', () => {
    const u = mk('ups', 1, 2, {}, 'RJ45');
    expect(isPowerPort(u, u.interfaces![0]!)).toBe(false);
  });

  it('an explicit outlet media on non-power gear is still an outlet', () => {
    const srv = mk('server', 1, 1, {}, 'C14');
    expect(isPowerPort(srv, srv.interfaces![0]!)).toBe(true);
  });

  it('flags a power port cabled to a data port, either way round', () => {
    const u = mk('ups', 1, 2);
    const sw = mk('switch', 1, 1, {}, 'RJ45');
    const a = { device: u, iface: u.interfaces![0]! };
    const b = { device: sw, iface: sw.interfaces![0]! };
    expect(isPowerDataMismatch(a, b)).toBe(true);
    expect(isPowerDataMismatch(b, a)).toBe(true);
  });

  it('does not flag power-to-power or data-to-data', () => {
    const u = mk('ups', 1, 2);
    const u2 = mk('ups', 1, 2);
    const a = { device: u, iface: u.interfaces![0]! };
    expect(isPowerDataMismatch(a, { device: u2, iface: u2.interfaces![0]! })).toBe(false);
    const sw = mk('switch', 1, 1, {}, 'RJ45');
    const sw2 = mk('switch', 1, 1, {}, 'RJ45');
    expect(
      isPowerDataMismatch(
        { device: sw, iface: sw.interfaces![0]! },
        { device: sw2, iface: sw2.interfaces![0]! },
      ),
    ).toBe(false);
  });
});

describe('outlets are cablable ports', () => {
  it('a rack UPS now yields outlet rects — it used to yield none', () => {
    const u = mk('ups', 6, 2);
    const rects = devicePortLayout(u, deviceRect(RACK, u));
    expect(rects).toHaveLength(6);
    expect(rects.map((r) => r.ifaceId)).toEqual(u.interfaces!.map((i) => i.id));
  });

  it('a 0U PDU yields a vertical column of outlets', () => {
    const pdu = mk('ups', 8, 6, { mount: 'rail' });
    const rects = devicePortLayout(pdu, deviceRect(RACK, pdu));
    expect(rects).toHaveLength(8);
    // One column: every outlet shares an x, and y increases.
    expect(new Set(rects.map((r) => r.x.toFixed(1))).size).toBe(1);
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i]!.y).toBeGreaterThan(rects[i - 1]!.y);
    }
  });

  it('a PSU shelf, cable manager and blanking panel still yield nothing', () => {
    for (const t of ['generic'] as DeviceType[]) {
      const d = mk(t, 4, 1);
      expect(devicePortLayout(d, deviceRect(RACK, d))).toEqual([]);
    }
  });

  it('outlets stay inside the chassis', () => {
    for (const [span, rail] of [
      [2, false],
      [3, false],
      [6, true],
    ] as const) {
      const d = mk('ups', 8, span, rail ? { mount: 'rail' } : {});
      const panel = deviceRect(RACK, d);
      for (const r of devicePortLayout(d, panel)) {
        expect(r.x).toBeGreaterThanOrEqual(panel.x - 0.01);
        expect(r.y).toBeGreaterThanOrEqual(panel.y - 0.01);
        expect(r.x + r.w).toBeLessThanOrEqual(panel.x + panel.w + 0.01);
        expect(r.y + r.h).toBeLessThanOrEqual(panel.y + panel.h + 0.01);
      }
    }
  });

  it('no two outlets overlap', () => {
    const d = mk('ups', 8, 2);
    const rects = devicePortLayout(d, deviceRect(RACK, d));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 0.01 && oy > 0.01).toBe(false);
      }
    }
  });
});

describe('drawn outlets ARE the hit targets', () => {
  const cases: { label: string; device: Device }[] = [
    { label: 'generic rack UPS', device: mk('ups', 6, 2) },
    { label: 'APC skin', device: mk('ups', 6, 2, { vendor: 'APC', model: 'Smart-UPS SRT 2200' }) },
    { label: '0U PDU', device: mk('ups', 8, 6, { mount: 'rail' }) },
  ];

  for (const { label, device } of cases) {
    it(`${label}: every drawn outlet matches a port rect exactly`, () => {
      const panel = deviceRect(RACK, device);
      const drawn = drawnOutlets(deviceFaceParts(device, panel, 'front').join(''));
      const ports = devicePortLayout(device, panel);
      expect(drawn.length).toBeGreaterThan(0);
      expect(drawn).toHaveLength(ports.length);
      // Same geometry, not merely the same count.
      const fmt = (r: { x: number; y: number; w: number; h: number }) =>
        `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.w.toFixed(1)},${r.h.toFixed(1)}`;
      expect(drawn.map(fmt).sort()).toEqual(ports.map(fmt).sort());
    });

    it(`${label}: aiming at an outlet centre resolves to that outlet`, () => {
      const panel = deviceRect(RACK, device);
      const ports = devicePortLayout(device, panel);
      for (const p of ports) {
        const c = portCenter({ ...p, deviceId: device.id });
        const hit = portAt(
          ports.map((r) => ({ ...r, deviceId: device.id })),
          c.x,
          c.y,
        );
        expect(hit?.ifaceId).toBe(p.ifaceId);
      }
    });
  }
});

describe('tracing terminates at a UPS', () => {
  it('a UPS is not a pass-through, so a power feed ends there', () => {
    // Only patch panels are transitive; a feed must not continue "through" a UPS.
    expect(isTransitive('ups')).toBe(false);
  });
});

describe('generated outlets carry the outlet media', () => {
  it('DEFAULT_OUTLET_MEDIA reads as power', () => {
    expect(isPowerMedia(DEFAULT_OUTLET_MEDIA)).toBe(true);
  });
});
