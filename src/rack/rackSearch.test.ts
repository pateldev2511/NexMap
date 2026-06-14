import { describe, it, expect } from 'vitest';
import { deviceMatchesQuery, searchDevices } from './rackSearch';
import type { Device } from '@/model/types';

let n = 0;
const dev = (over: Partial<Device> = {}): Device => ({
  id: 'd' + n++, kind: 'device', type: 'server', name: 'web-01',
  x: 0, y: 0, width: 56, height: 40, layerId: 'L', ...over,
});

describe('deviceMatchesQuery', () => {
  it('matches across name, vendor, model, owner, assetTag, serial, status', () => {
    const d = dev({
      name: 'core-sw', vendor: 'Arista', model: '7050X', owner: 'Priya',
      assetTag: 'AST-9912', serial: 'SN-ABCDEF', status: 'maintenance',
    });
    expect(deviceMatchesQuery(d, 'arista')).toBe(true);
    expect(deviceMatchesQuery(d, 'priya')).toBe(true);
    expect(deviceMatchesQuery(d, 'ast-9912')).toBe(true);
    expect(deviceMatchesQuery(d, 'abcdef')).toBe(true);
    expect(deviceMatchesQuery(d, 'maintenance')).toBe(true);
    expect(deviceMatchesQuery(d, 'nope')).toBe(false);
  });

  it('matches by VLAN id on an interface (both "vlan20" and "20")', () => {
    const d = dev({ interfaces: [{ id: 'i1', name: 'Gi0/1', vlan: 20 }] });
    expect(deviceMatchesQuery(d, 'vlan20')).toBe(true);
    expect(deviceMatchesQuery(d, '20')).toBe(true);
    expect(deviceMatchesQuery(d, 'gi0/1')).toBe(true);
  });

  it('is case-insensitive and empty query never matches', () => {
    const d = dev({ name: 'Edge-FW' });
    expect(deviceMatchesQuery(d, 'EDGE')).toBe(true);
    expect(deviceMatchesQuery(d, '')).toBe(false);
    expect(deviceMatchesQuery(d, '   ')).toBe(false);
  });
});

describe('searchDevices', () => {
  it('returns matches in input order; empty query returns nothing', () => {
    const a = dev({ name: 'a', owner: 'Sam' });
    const b = dev({ name: 'b', owner: 'Lee' });
    const c = dev({ name: 'c', owner: 'Sam' });
    expect(searchDevices([a, b, c], 'sam').map((d) => d.id)).toEqual([a.id, c.id]);
    expect(searchDevices([a, b, c], '')).toEqual([]);
  });
});
