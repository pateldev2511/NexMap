import { describe, it, expect } from 'vitest';
import { rackHealthScore, healthBand } from './rackHealthScore';
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
