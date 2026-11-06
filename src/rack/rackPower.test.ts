import { describe, it, expect } from 'vitest';
import { cordsIntoPdu, isPdu, nextPduFeed, pduFeedCoverage, powerFeedAnalysis, proposePowerBalance } from './rackPower';
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

describe('PDUs and their feeds', () => {
  const pdu = (over: Partial<Device> = {}) =>
    dev({ type: 'ups', mount: 'rail', side: 'rear', ru: 1, ruSpan: 6, interfaces: Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, name: `C13-${i + 1}` })), ...over });

  it('a PDU is a rail-mounted ups; a rack UPS is not', () => {
    expect(isPdu(pdu())).toBe(true);
    expect(isPdu(dev({ type: 'ups', mount: 'rack' }))).toBe(false);
    expect(cordsIntoPdu(dev({ type: 'ups', mount: 'rack', ru: 1 }))).toBe(false); // it feeds the PDUs
  });

  it('a new PDU takes the feed the rack lacks: A, then B, then the emptier one', () => {
    expect(nextPduFeed('r1', [])).toBe('A');
    expect(nextPduFeed('r1', [pdu({ powerFeed: 'A' })])).toBe('B');
    expect(nextPduFeed('r1', [pdu()])).toBe('B'); // unset counts as A
    expect(nextPduFeed('r1', [pdu({ powerFeed: 'B' })])).toBe('A');
    expect(nextPduFeed('r1', [pdu({ powerFeed: 'A' }), pdu({ powerFeed: 'B' })])).toBe('A');
    expect(nextPduFeed('r1', [pdu({ powerFeed: 'A', rackId: 'other' })])).toBe('A'); // another rack's
  });

  it('counts cords per feed: one per single-corded unit, one on each feed per dual-corded unit', () => {
    const [a, b] = pduFeedCoverage({ id: 'r1' }, [
      pdu({ id: 'pa', powerFeed: 'A' }),
      dev({ id: 's1', ru: 10, powerFeed: 'AB' }),
      dev({ id: 's2', ru: 12 }), // unset → A
      dev({ id: 's3', ru: 14, powerFeed: 'B' }),
      dev({ id: 'pp', type: 'patch-panel', ru: 20 }), // no cord
      dev({ id: 'cm', type: 'generic', name: 'cm-01', ru: 21 }), // cable manager: no cord
      dev({ id: 'off', ru: null as unknown as number }), // not mounted
    ]);
    expect(a).toMatchObject({ feed: 'A', pdus: 1, outlets: 8, cords: 2, deviceIds: ['s1', 's2'] });
    expect(b).toMatchObject({ feed: 'B', pdus: 0, outlets: 0, cords: 2, deviceIds: ['s1', 's3'] });
  });
});
