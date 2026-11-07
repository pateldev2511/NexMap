import { describe, it, expect } from 'vitest';
import { rackHealthScore, healthBand } from './rackHealthScore';
import { analyzeCabling } from './rackHealth';
import type { Device, Rack, RackCable, ValidationIssue } from '@/model/types';

const rack = (over: Partial<Rack> = {}): Rack => ({
  id: 'r1', name: 'R1', ruHeight: 42, ...over,
});

let n = 0;
const dev = (over: Partial<Device> = {}): Device => ({
  id: 'd' + n++, kind: 'device', type: 'server', name: 'd',
  x: 0, y: 0, width: 56, height: 40, layerId: 'L', rackId: 'r1',
  ru: 1, ruSpan: 1, ...over,
});

// A fully-documented, dual-corded, balanced device — the "healthy" baseline.
const healthy = (over: Partial<Device> = {}): Device =>
  dev({ watts: 200, powerFeed: 'AB', assetTag: 'AST-1', vendor: 'Dell', model: 'R660', ...over });

describe('healthBand', () => {
  it('maps score to the semantic ramp', () => {
    expect(healthBand(95)).toBe('ok');
    expect(healthBand(80)).toBe('ok');
    expect(healthBand(79)).toBe('warn');
    expect(healthBand(50)).toBe('warn');
    expect(healthBand(49)).toBe('error');
  });
});

describe('rackHealthScore', () => {
  it('a well-documented, redundant, clean rack scores 100 / ok', () => {
    const h = rackHealthScore(rack(), [healthy(), healthy()], [], []);
    expect(h.score).toBe(100);
    expect(h.band).toBe('ok');
    expect(h.biggestRisk).toMatch(/great shape/i);
  });

  it('an empty rack is healthy (nothing to risk)', () => {
    const h = rackHealthScore(rack(), [], [], []);
    expect(h.score).toBe(100);
  });

  it('over the power cap tanks capacity and names it the biggest risk', () => {
    const h = rackHealthScore(rack({ maxWatts: 100 }), [healthy({ watts: 500 })], [], []);
    const cap = h.dimensions.find((d) => d.key === 'capacity')!;
    expect(cap.score).toBe(0);
    expect(h.biggestRisk).toMatch(/power cap/i);
    expect(h.band).not.toBe('ok');
  });

  it('all single-corded gear drags down redundancy', () => {
    const h = rackHealthScore(
      rack(),
      [dev({ watts: 300, powerFeed: 'A', assetTag: 'A1', vendor: 'X' }),
       dev({ watts: 50, powerFeed: 'A', assetTag: 'A2', vendor: 'X' })],
      [], [],
    );
    const red = h.dimensions.find((d) => d.key === 'redundancy')!;
    expect(red.score).toBeLessThan(1);
    expect(h.score).toBeLessThan(100);
  });

  it('a rated PDU that trips when the other feed fails is the redundancy risk', () => {
    const strip = (feed: 'A' | 'B') =>
      dev({ type: 'ups', mount: 'rail', side: 'rear', bay: feed === 'A' ? 'right' : 'left', ruSpan: 42, powerFeed: feed, ratedAmps: 10, ratedVolts: 100, name: `PDU ${feed}`, assetTag: 'P', vendor: 'X', interfaces: [{ id: `o${feed}`, name: 'C13-1' }] });
    const h = rackHealthScore(rack(), [strip('A'), strip('B'), healthy({ watts: 1500 })], [], []);
    const red = h.dimensions.find((d) => d.key === 'redundancy')!;
    expect(red.score).toBe(0.3);
    expect(h.biggestRisk).toBe('PDU A trips if feed B fails.');
  });

  it('missing asset tags / models hurt inventory', () => {
    const h = rackHealthScore(rack(), [healthy(), dev({ watts: 200, powerFeed: 'AB' })], [], []);
    const inv = h.dimensions.find((d) => d.key === 'inventory')!;
    expect(inv.score).toBe(0.5); // 1 of 2 documented
    expect(h.biggestRisk).toMatch(/asset tag or model/i);
  });

  it('cabling issues touching this rack lower the cabling dimension', () => {
    const d = healthy({ id: 'sw1' });
    const issue: ValidationIssue = {
      id: 'i1', severity: 'warn', code: 'LOOP', message: 'spanning-tree loop', objectIds: ['sw1'],
    };
    const h = rackHealthScore(rack(), [d], [], [issue]);
    const cab = h.dimensions.find((d) => d.key === 'cabling')!;
    expect(cab.score).toBeLessThan(1);
    expect(h.biggestRisk).toMatch(/cabling issue/i);
  });

  describe('per-cable findings (they name the cable, not a device)', () => {
    type Port = { vlan?: number; speed?: string; kind?: string };
    const sw = (id: string, rackId: string, ru: number, ports: Port[]) =>
      healthy({ id, type: 'switch', name: id, rackId, ru, interfaces: ports.map((p, i) => ({ id: `${id}-${i}`, name: `p${i}`, ...p })) });
    const cable = (id: string, a: string, b: string, i: number): RackCable => ({
      id, aEnd: { deviceId: a, ifaceId: `${a}-${i}` }, bEnd: { deviceId: b, ifaceId: `${b}-${i}` }, color: '#000', lengthFt: 5,
    });
    const r2 = rack({ id: 'r2', name: 'R2' });
    const cabling = (h: ReturnType<typeof rackHealthScore>) => h.dimensions.find((d) => d.key === 'cabling')!;

    it('a VLAN mismatch between two switches in one rack is not clean cabling', () => {
      const devices = [sw('a', 'r1', 1, [{ vlan: 1 }, { vlan: 1 }]), sw('b', 'r1', 2, [{ vlan: 2 }, { vlan: 2 }])];
      const cables = [cable('c0', 'a', 'b', 0), cable('c1', 'a', 'b', 1)];
      const { issues } = analyzeCabling(devices, cables);
      expect(issues.filter((i) => i.code === 'rack-vlan-mismatch')).toHaveLength(2);
      const h = rackHealthScore(rack(), devices, cables, issues);
      expect(h.score).toBeLessThan(100);
      expect(cabling(h).score).toBe(0.5); // two findings, each once
      expect(cabling(h).risk).toBe('2 cabling issues to review.');
      expect(h.biggestRisk).toBe('2 cabling issues to review.');
    });

    it.each([
      ['rack-speed-mismatch', { speed: '10G' }, { speed: '1G' }],
      ['rack-media-mismatch', { kind: 'sfp+' }, { kind: 'rj45' }],
      ['rack-vlan-mismatch', { vlan: 10 }, { vlan: 20 }],
    ] as const)('%s counts against both racks of a cross-rack run, once each', (code, pa, pb) => {
      const devices = [sw('a', 'r1', 1, [pa]), sw('b', 'r2', 1, [pb]), sw('c', 'r2', 2, [pb]), sw('d', 'r2', 3, [pb])];
      // One cross-rack cable (a↔b) and one wholly inside r2 (c↔d, agreeing ports).
      const cables = [cable('x', 'a', 'b', 0), cable('local', 'c', 'd', 0)];
      const { issues } = analyzeCabling(devices, cables);
      expect(issues.map((i) => [i.code, i.objectIds])).toEqual([[code, ['x']]]);
      const h1 = rackHealthScore(rack(), devices, cables, issues);
      const h2 = rackHealthScore(r2, devices, cables, issues);
      expect(cabling(h1).score).toBe(0.75);
      expect(cabling(h2).score).toBe(0.75);
      expect(cabling(h1).risk).toBe('1 cabling issue to review.');
    });

    it('a finding inside another rack does not touch this one', () => {
      const devices = [sw('a', 'r1', 1, [{}]), sw('b', 'r2', 1, [{ vlan: 1 }]), sw('c', 'r2', 2, [{ vlan: 2 }])];
      const cables = [cable('far', 'b', 'c', 0)];
      const { issues } = analyzeCabling(devices, cables);
      expect(issues.some((i) => i.code === 'rack-vlan-mismatch')).toBe(true);
      expect(rackHealthScore(rack(), devices, cables, issues).score).toBe(100);
      expect(cabling(rackHealthScore(r2, devices, cables, issues)).score).toBeLessThan(1);
    });

    it('a finding naming both the cable and its devices counts once', () => {
      const devices = [sw('a', 'r1', 1, [{}]), sw('b', 'r1', 2, [{}])];
      const cables = [cable('c', 'a', 'b', 0)];
      const issue: ValidationIssue = { id: 'i', severity: 'warn', code: 'rack-loop', message: 'loop', objectIds: ['c', 'a', 'b'] };
      expect(cabling(rackHealthScore(rack(), devices, cables, [issue])).score).toBe(0.75);
    });
  });

  it('cables missing a length estimate ding cabling (when no harder issue exists)', () => {
    const d = healthy({ id: 'sw1' });
    const cable: RackCable = {
      id: 'c1', aEnd: { deviceId: 'sw1', ifaceId: 'p1' }, bEnd: { deviceId: 'sw1', ifaceId: 'p2' },
      color: '#22d3ee',
    };
    const h = rackHealthScore(rack(), [d], [cable], []);
    const cab = h.dimensions.find((d) => d.key === 'cabling')!;
    expect(cab.score).toBeLessThan(1);
  });
});
