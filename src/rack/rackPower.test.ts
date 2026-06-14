import { describe, it, expect } from 'vitest';
import { powerFeedAnalysis, proposePowerBalance } from './rackPower';
import type { Device } from '@/model/types';

const dev = (over: Partial<Device>): Device => ({
  id: 'd' + Math.random().toString(36).slice(2), kind: 'device', type: 'server', name: 'd',
  x: 0, y: 0, width: 56, height: 40, layerId: 'L', rackId: 'r1', ...over,
});

describe('powerFeedAnalysis', () => {
  it('splits dual-corded load 50/50 and makes each feed carry it fully on failover', () => {
    const a = powerFeedAnalysis([dev({ watts: 400, powerFeed: 'AB' })]);
    expect(a.normalA).toBe(200);
    expect(a.normalB).toBe(200);
    expect(a.failoverA).toBe(400);
    expect(a.failoverB).toBe(400);
    expect(a.dualCorded).toBe(1);
    expect(a.singleCorded).toBe(0);
  });

  it('puts single-corded load fully on its feed and counts it as a SPOF', () => {
    const a = powerFeedAnalysis([
      dev({ watts: 100, powerFeed: 'A' }),
      dev({ watts: 60, powerFeed: 'B' }),
    ]);
    expect(a.normalA).toBe(100);
    expect(a.normalB).toBe(60);
    expect(a.failoverA).toBe(100); // B dying doesn't add to A
    expect(a.failoverB).toBe(60);
    expect(a.singleCorded).toBe(2);
    expect(a.dualCorded).toBe(0);
  });

  it('defaults missing feed to single A and ignores zero-watt gear', () => {
    const a = powerFeedAnalysis([dev({ watts: 250 }), dev({ watts: 0, powerFeed: 'AB' }), dev({})]);
    expect(a.normalA).toBe(250);
    expect(a.singleCorded).toBe(1); // only the 250W default-A device counts
    expect(a.dualCorded).toBe(0);
  });

  it('mixed fleet: failover on the surviving feed = dual gear (full) + that feed’s single gear', () => {
    const a = powerFeedAnalysis([
      dev({ watts: 400, powerFeed: 'AB' }),
      dev({ watts: 200, powerFeed: 'A' }),
      dev({ watts: 100, powerFeed: 'B' }),
    ]);
    // If A dies, B carries: dual full (400) + B-only (100) = 500
    expect(a.failoverB).toBe(500);
    // If B dies, A carries: dual full (400) + A-only (200) = 600
    expect(a.failoverA).toBe(600);
  });
});

describe('proposePowerBalance', () => {
  it('moves single-corded gear to even out a lopsided fleet', () => {
    // All three on A (300W); moving one 100W device to B closes the gap.
    const p = proposePowerBalance([
      dev({ id: 'x', watts: 100, powerFeed: 'A' }),
      dev({ id: 'y', watts: 100, powerFeed: 'A' }),
      dev({ id: 'z', watts: 100, powerFeed: 'A' }),
    ]);
    expect(p.beforeDiff).toBe(300);
    expect(p.afterDiff).toBe(100); // 200 vs 100
    expect(p.flips).toHaveLength(1);
    expect(p.flips[0]!.from).toBe('A');
    expect(p.flips[0]!.to).toBe('B');
    expect(p.movedWatts).toBe(100);
  });

  it('proposes nothing when already balanced', () => {
    const p = proposePowerBalance([
      dev({ watts: 100, powerFeed: 'A' }),
      dev({ watts: 100, powerFeed: 'B' }),
    ]);
    expect(p.beforeDiff).toBe(0);
    expect(p.afterDiff).toBe(0);
    expect(p.flips).toHaveLength(0);
    expect(p.movedWatts).toBe(0);
  });

  it('never moves dual-corded (AB) gear and still reports it as not redundant-fixing', () => {
    const p = proposePowerBalance([
      dev({ id: 'ab', watts: 1000, powerFeed: 'AB' }),
      dev({ id: 's', watts: 50, powerFeed: 'A' }),
    ]);
    // AB splits 500/500; the lone single-corded 50W can't be split, gap is 50, no flip helps.
    expect(p.flips.find((f) => f.deviceId === 'ab')).toBeUndefined();
    expect(p.afterDiff).toBe(50);
    expect(p.remainingSingleCorded).toBe(1); // balancing never adds redundancy
  });

  it('is a no-op for an empty / zero-watt fleet', () => {
    expect(proposePowerBalance([]).flips).toHaveLength(0);
    const p = proposePowerBalance([dev({ watts: 0, powerFeed: 'A' }), dev({})]);
    expect(p.flips).toHaveLength(0);
    expect(p.beforeDiff).toBe(0);
  });

  it('is deterministic — same fleet yields the same proposal', () => {
    const fleet = [
      dev({ id: 'a', watts: 300, powerFeed: 'A' }),
      dev({ id: 'b', watts: 120, powerFeed: 'A' }),
      dev({ id: 'c', watts: 80, powerFeed: 'A' }),
    ];
    expect(proposePowerBalance(fleet)).toEqual(proposePowerBalance(fleet));
  });
});
