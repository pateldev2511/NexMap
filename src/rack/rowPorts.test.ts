/**
 * Absolute row port geometry (W6b). The property that matters: the array feeding
 * the DRAWN jacks is the same array feeding hit-testing, so a click can never land
 * on a different port than the one under the cursor.
 */
import { describe, expect, it } from 'vitest';
import {
  groupPortsByDevice,
  resolveDrop,
  resolvePress,
  rowPortTargets,
  type PortCol,
} from './rowPorts';
import { portAt, portCenter, type PortTarget } from './portHit';
import { bayOrigin, cabinetSize, deviceRect } from './rackLayout';
import type { Device, DeviceType, Interface, Rack } from '@/model/types';

const rack = (id: string, ruHeight = 42): Rack => ({ id, name: id.toUpperCase(), ruHeight });

const iface = (id: string): Interface => ({ id, name: id });

const device = (
  id: string,
  rackId: string,
  ru: number,
  ports: number,
  type: DeviceType = 'switch',
  partial: Partial<Device> = {},
): Device => ({
  id,
  kind: 'device',
  type,
  name: id.toUpperCase(),
  x: 0,
  y: 0,
  width: 56,
  height: 40,
  layerId: 'L',
  rackId,
  ru,
  ruSpan: 1,
  mount: 'rack',
  side: 'front',
  bay: 'full',
  interfaces: Array.from({ length: ports }, (_, i) => iface(`${id}p${i + 1}`)),
  ...partial,
});

const cols = (racks: Rack[]): PortCol[] =>
  racks.map((r, i) => ({
    rack: r,
    frontX: i * 700,
    rearX: i * 700 + cabinetSize(r).width + 20,
  }));

describe('rowPortTargets', () => {
  it('emits one target per interface', () => {
    const r = rack('rk1');
    const d = device('sw', 'rk1', 10, 8);
    expect(rowPortTargets(cols([r]), [d], false)).toHaveLength(8);
  });

  it('carries deviceId and ifaceId through', () => {
    const r = rack('rk1');
    const d = device('sw', 'rk1', 10, 2);
    const targets = rowPortTargets(cols([r]), [d], false);
    expect(targets.map((t) => t.ifaceId).sort()).toEqual(['swp1', 'swp2']);
    expect(targets.every((t) => t.deviceId === 'sw')).toBe(true);
  });

  it('places ports INSIDE their own device panel', () => {
    const r = rack('rk1');
    const d = device('sw', 'rk1', 10, 4);
    const [col] = cols([r]);
    const origin = bayOrigin(col!.frontX);
    const dr = deviceRect(r, d);
    const panel = { x: origin.x + dr.x, y: origin.y + dr.y, w: dr.w, h: dr.h };

    for (const t of rowPortTargets([col!], [d], false)) {
      expect(t.x).toBeGreaterThanOrEqual(panel.x);
      expect(t.y).toBeGreaterThanOrEqual(panel.y);
      expect(t.x + t.w).toBeLessThanOrEqual(panel.x + panel.w);
      expect(t.y + t.h).toBeLessThanOrEqual(panel.y + panel.h);
    }
  });

  it('separates racks horizontally — no two racks share port coordinates', () => {
    const rs = [rack('rk1'), rack('rk2')];
    const ds = [device('a', 'rk1', 10, 4), device('b', 'rk2', 10, 4)];
    const targets = rowPortTargets(cols(rs), ds, false);
    const xsA = targets.filter((t) => t.deviceId === 'a').map((t) => t.x);
    const xsB = targets.filter((t) => t.deviceId === 'b').map((t) => t.x);
    expect(Math.max(...xsA)).toBeLessThan(Math.min(...xsB));
  });

  it('ignores devices in other racks', () => {
    const rs = [rack('rk1')];
    const ds = [device('a', 'rk1', 10, 4), device('b', 'rk2', 10, 4)];
    expect(rowPortTargets(cols(rs), ds, false).every((t) => t.deviceId === 'a')).toBe(true);
  });

  it('ignores unmounted devices', () => {
    const r = rack('rk1');
    const d = { ...device('sw', 'rk1', 10, 4), ru: undefined };
    expect(rowPortTargets(cols([r]), [d], false)).toEqual([]);
  });

  it('ignores 0U rail gear, which has no faceplate jack grid', () => {
    const r = rack('rk1');
    const d = device('pdu', 'rk1', 1, 8, 'ups', { mount: 'rail' });
    expect(rowPortTargets(cols([r]), [d], false)).toEqual([]);
  });

  it('a device with no interfaces contributes nothing', () => {
    const r = rack('rk1');
    expect(rowPortTargets(cols([r]), [device('sw', 'rk1', 10, 0)], false)).toEqual([]);
  });

  it('is empty with no racks', () => {
    expect(rowPortTargets([], [device('sw', 'rk1', 10, 4)], false)).toEqual([]);
  });
});

describe('rear face visibility', () => {
  const rearDev = () =>
    device('rd', 'rk1', 10, 4, 'switch', { side: 'rear' });

  it('rear gear contributes NOTHING while the rear face is hidden', () => {
    // Cabling to a port you cannot see would be a click into the void.
    expect(rowPortTargets(cols([rack('rk1')]), [rearDev()], false)).toEqual([]);
  });

  it('rear gear contributes once the rear face is shown', () => {
    expect(rowPortTargets(cols([rack('rk1')]), [rearDev()], true)).toHaveLength(4);
  });

  it('rear ports land in the REAR column, not the front one', () => {
    const col = cols([rack('rk1')])[0]!;
    const targets = rowPortTargets([col], [rearDev()], true);
    const origin = bayOrigin(col.rearX);
    expect(Math.min(...targets.map((t) => t.x))).toBeGreaterThanOrEqual(origin.x);
  });

  it('front and rear gear in one rack do not collide', () => {
    const col = cols([rack('rk1')])[0]!;
    const front = device('f', 'rk1', 10, 4);
    const rear = device('r', 'rk1', 10, 4, 'switch', { side: 'rear' });
    const targets = rowPortTargets([col], [front, rear], true);
    const fx = targets.filter((t) => t.deviceId === 'f').map((t) => t.x);
    const rx = targets.filter((t) => t.deviceId === 'r').map((t) => t.x);
    expect(Math.max(...fx)).toBeLessThan(Math.min(...rx));
  });
});

describe('hit-testing agrees with the drawn geometry', () => {
  it('the centre of every emitted target resolves back to that same port', () => {
    // This is the anti-desync guarantee: draw and hit-test share one array, so
    // aiming at a jack cannot resolve to its neighbour.
    const rs = [rack('rk1'), rack('rk2')];
    const ds = [
      device('sw', 'rk1', 20, 24),
      device('pp', 'rk1', 10, 24, 'patch-panel'),
      device('srv', 'rk2', 5, 4, 'server'),
    ];
    const targets = rowPortTargets(cols(rs), ds, false);
    expect(targets.length).toBeGreaterThan(40);

    for (const t of targets) {
      const c = portCenter(t);
      const hit = portAt(targets, c.x, c.y);
      expect(hit).not.toBeNull();
      expect(hit!.deviceId).toBe(t.deviceId);
      expect(hit!.ifaceId).toBe(t.ifaceId);
    }
  });

  it('a point in the aisle between racks hits nothing', () => {
    const rs = [rack('rk1'), rack('rk2')];
    const ds = [device('a', 'rk1', 10, 4), device('b', 'rk2', 10, 4)];
    const targets = rowPortTargets(cols(rs), ds, false);
    // Far above the bays, in the rack title strip.
    expect(portAt(targets, 0, -500)).toBeNull();
  });
});

describe('groupPortsByDevice', () => {
  it('groups every target under its device', () => {
    const rs = [rack('rk1')];
    const ds = [device('a', 'rk1', 10, 4), device('b', 'rk1', 20, 6)];
    const grouped = groupPortsByDevice(rowPortTargets(cols(rs), ds, false));
    expect(grouped.get('a')).toHaveLength(4);
    expect(grouped.get('b')).toHaveLength(6);
  });

  it('is empty for no targets', () => {
    expect(groupPortsByDevice([]).size).toBe(0);
  });
});

describe('resolvePress — the port-vs-device arbiter (E20)', () => {
  const ports = () => rowPortTargets(cols([rack('rk1')]), [device('sw', 'rk1', 10, 4)], false);
  const onAJack = () => {
    const p = ports()[0]!;
    return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  };

  it('a press on a jack at the NEAR tier starts a cable', () => {
    const at = onAJack();
    const r = resolvePress({ tier: 'near', cablingEnabled: true, ports: ports(), ...at });
    expect(r.kind).toBe('cable');
    if (r.kind === 'cable') expect(r.source.ifaceId).toBe(ports()[0]!.ifaceId);
  });

  // The E20 guarantee: a jack is ~2px below `near`, so an INVISIBLE target must not
  // steal the press and turn a device drag into a stray cable.
  it('the same press at MID or FAR resolves to the DEVICE, not a cable', () => {
    const at = onAJack();
    for (const tier of ['mid', 'far'] as const) {
      expect(resolvePress({ tier, cablingEnabled: true, ports: ports(), ...at }).kind).toBe(
        'device',
      );
    }
  });

  it('resolves to the device when cabling is disabled, even at near', () => {
    const at = onAJack();
    expect(
      resolvePress({ tier: 'near', cablingEnabled: false, ports: ports(), ...at }).kind,
    ).toBe('device');
  });

  it('a press in the brand-label zone left of the jacks is a DEVICE press', () => {
    const ps = ports();
    const at = { x: Math.min(...ps.map((p) => p.x)) - 20, y: ps[0]!.y + ps[0]!.h / 2 };
    expect(resolvePress({ tier: 'near', cablingEnabled: true, ports: ps, ...at }).kind).toBe(
      'device',
    );
  });

  it('a press far off in the aisle is a DEVICE press', () => {
    expect(
      resolvePress({ tier: 'near', cablingEnabled: true, ports: ports(), x: -9999, y: -9999 })
        .kind,
    ).toBe('device');
  });

  it('with no ports at all, every press is a device press', () => {
    expect(
      resolvePress({ tier: 'near', cablingEnabled: true, ports: [], x: 0, y: 0 }).kind,
    ).toBe('device');
  });

  it('every drawn jack is individually aimable', () => {
    const ps = ports();
    for (const p of ps) {
      const r = resolvePress({
        tier: 'near',
        cablingEnabled: true,
        ports: ps,
        x: p.x + p.w / 2,
        y: p.y + p.h / 2,
      });
      expect(r.kind).toBe('cable');
      if (r.kind === 'cable') expect(r.source.ifaceId).toBe(p.ifaceId);
    }
  });
});

describe('resolveDrop', () => {
  const ps = () =>
    rowPortTargets(
      cols([rack('rk1')]),
      [device('a', 'rk1', 10, 4), device('b', 'rk1', 20, 4)],
      false,
    );
  const centre = (p: PortTarget) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 });

  it('a drop on another port returns that port', () => {
    const all = ps();
    const src = all.find((p) => p.deviceId === 'a')!;
    const dst = all.find((p) => p.deviceId === 'b')!;
    const c = centre(dst);
    expect(resolveDrop(src, all, c.x, c.y)).toMatchObject({ ifaceId: dst.ifaceId });
  });

  it('a drop on empty space returns null — a changed mind, not an error', () => {
    const all = ps();
    expect(resolveDrop(all[0]!, all, -9999, -9999)).toBeNull();
  });

  it('a drop back on the SOURCE port returns null', () => {
    const all = ps();
    const src = all[0]!;
    const c = centre(src);
    expect(resolveDrop(src, all, c.x, c.y)).toBeNull();
  });

  it('a drop on a DIFFERENT port of the same device is allowed — legality is the store’s job', () => {
    const all = ps().filter((p) => p.deviceId === 'a');
    const c = centre(all[3]!);
    expect(resolveDrop(all[0]!, all, c.x, c.y)).toMatchObject({ ifaceId: all[3]!.ifaceId });
  });
});
