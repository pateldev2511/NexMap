import { describe, it, expect } from 'vitest';
import { analyzeCabling } from './rackHealth';
import type { Device, RackCable } from '@/model/types';

let seq = 0;
function dev(id: string, over: Partial<Device> = {}): Device {
  return {
    id, kind: 'device', type: 'switch', name: id, x: 0, y: 0, width: 56, height: 40, layerId: 'L',
    rackId: 'r1', ru: 1 + seq++, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full',
    interfaces: [{ id: `${id}-p1`, name: 'p1' }, { id: `${id}-p2`, name: 'p2' }],
    ...over,
  };
}
function cable(id: string, a: string, b: string, over: Partial<RackCable> = {}): RackCable {
  return { id, aEnd: { deviceId: a, ifaceId: `${a}-p1` }, bEnd: { deviceId: b, ifaceId: `${b}-p2` }, color: '#fff', ...over };
}

const codes = (issues: { code: string }[]) => new Set(issues.map((i) => i.code));

describe('analyzeCabling — loop / STP detection', () => {
  it('flags a triangle ring A-B-C-A but not a chain', () => {
    const [a, b, c] = [dev('A'), dev('B'), dev('C')];
    const ring = [cable('1', 'A', 'B'), cable('2', 'B', 'C'), cable('3', 'C', 'A')];
    const r = analyzeCabling([a, b, c], ring);
    expect(r.loopCableIds).toHaveLength(1); // exactly the cable that closes the ring
    expect(codes(r.issues)).toContain('rack-loop');

    const chain = [cable('1', 'A', 'B'), cable('2', 'B', 'C')];
    const r2 = analyzeCabling([a, b, c], chain);
    expect(r2.loopCableIds).toHaveLength(0);
    expect(codes(r2.issues)).not.toContain('rack-loop');
  });

  it('does not treat a parallel bundle (A-B twice) as a loop', () => {
    const [a, b] = [dev('A'), dev('B')];
    const bundle = [
      cable('1', 'A', 'B'),
      { id: '2', aEnd: { deviceId: 'A', ifaceId: 'A-p2' }, bEnd: { deviceId: 'B', ifaceId: 'B-p1' }, color: '#fff' } as RackCable,
    ];
    const r = analyzeCabling([a, b], bundle);
    expect(r.loopCableIds).toHaveLength(0);
  });
});

describe('analyzeCabling — SPOF + bridges', () => {
  it('flags the middle node of a chain as a SPOF, but not its leaf uplinks as bridges', () => {
    const [a, b, c] = [dev('A'), dev('B'), dev('C')];
    const r = analyzeCabling([a, b, c], [cable('1', 'A', 'B'), cable('2', 'B', 'C')]);
    expect(r.spofIds).toContain('B');
    expect(codes(r.issues)).toContain('rack-spof');
    // A and C are single-homed leaves — their one uplink is expected, not flagged as critical.
    expect(codes(r.issues)).not.toContain('rack-bridge');
  });

  it('flags a bridge cable that joins two non-trivial clusters (two rings + 1 link)', () => {
    const ds = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => dev(id));
    const cables = [
      cable('1', 'A', 'B'), cable('2', 'B', 'C'), cable('3', 'C', 'A'), // ring 1
      cable('4', 'D', 'E'), cable('5', 'E', 'F'), cable('6', 'F', 'D'), // ring 2
      cable('7', 'C', 'D'), // bridge joining the two rings
    ];
    const r = analyzeCabling(ds, cables);
    expect(codes(r.issues)).toContain('rack-bridge'); // C-D both have degree ≥ 2
    expect(r.loopCableIds).toHaveLength(2); // one closing cable per ring
    expect(r.spofIds).toEqual(expect.arrayContaining(['C', 'D'])); // cut vertices
  });
});

describe('analyzeCabling — per-cable lint', () => {
  it('warns on speed mismatch', () => {
    const a = dev('A', { interfaces: [{ id: 'A-p1', name: 'p1', speed: '1G' }] });
    const b = dev('B', { interfaces: [{ id: 'B-p2', name: 'p2', speed: '10G' }] });
    const r = analyzeCabling([a, b], [cable('1', 'A', 'B')]);
    expect(codes(r.issues)).toContain('rack-speed-mismatch');
  });

  it('warns on media mismatch', () => {
    const a = dev('A', { interfaces: [{ id: 'A-p1', name: 'p1', kind: 'copper' }] });
    const b = dev('B', { interfaces: [{ id: 'B-p2', name: 'p2', kind: 'fiber' }] });
    const r = analyzeCabling([a, b], [cable('1', 'A', 'B')]);
    expect(codes(r.issues)).toContain('rack-media-mismatch');
  });

  it('warns when an endpoint is unmounted', () => {
    const a = dev('A');
    const b = dev('B', { rackId: undefined, ru: undefined });
    const r = analyzeCabling([a, b], [cable('1', 'A', 'B')]);
    expect(codes(r.issues)).toContain('rack-endpoint-unmounted');
  });

  it('warns when a cross-rack cable has no length set', () => {
    const a = dev('A', { rackId: 'r1' });
    const b = dev('B', { rackId: 'r2' });
    const r = analyzeCabling([a, b], [cable('1', 'A', 'B')]);
    expect(codes(r.issues)).toContain('rack-crossrack-nolength');
  });

  it('does not warn on a clean intra-rack link', () => {
    const a = dev('A', { interfaces: [{ id: 'A-p1', name: 'p1', speed: '1G', kind: 'copper' }] });
    const b = dev('B', { interfaces: [{ id: 'B-p2', name: 'p2', speed: '1G', kind: 'copper' }] });
    const r = analyzeCabling([a, b], [cable('1', 'A', 'B')]);
    expect(r.issues).toHaveLength(0);
  });
});

describe('analyzeCabling — empty', () => {
  it('returns a clean report for no cables', () => {
    const r = analyzeCabling([dev('A')], []);
    expect(r.issues).toHaveLength(0);
    expect(r.loopCableIds).toHaveLength(0);
    expect(r.spofIds).toHaveLength(0);
  });
});
