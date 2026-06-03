import { describe, it, expect } from 'vitest';
import {
  connectorPoints,
  parallelPoints,
  orthogonalPoints,
  connectorLabelLines,
  pairKey,
  pathD,
  segmentMidpoints,
  labelAnchor,
  connectorLabel,
} from './connector';
import { createDevice, createLink } from '@/model/schema';

const L = 'layer';
const a = createDevice('router', 0, 0, L, { name: 'A' }); // center 28,20
const b = createDevice('switch', 200, 0, L, { name: 'B' }); // center 228,20

describe('connector geometry', () => {
  it('builds points through waypoints', () => {
    const link = createLink(a.id, b.id, L, { waypoints: [{ x: 100, y: 80 }] });
    const pts = connectorPoints(link, a, b);
    expect(pts).toHaveLength(3);
    expect(pts[1]).toEqual({ x: 100, y: 80 });
  });

  it('pathD emits a polyline', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    expect(pathD(pts)).toBe('M0 0 L10 10 L20 0');
  });

  it('segment midpoints count = points - 1', () => {
    const link = createLink(a.id, b.id, L, { waypoints: [{ x: 100, y: 80 }] });
    expect(segmentMidpoints(connectorPoints(link, a, b))).toHaveLength(2);
  });

  it('labelAnchor picks a middle midpoint', () => {
    const link = createLink(a.id, b.id, L);
    const anchor = labelAnchor(connectorPoints(link, a, b));
    expect(anchor.x).toBeCloseTo((28 + 228) / 2);
  });

  it('connectorLabel prefers name then bandwidth', () => {
    expect(connectorLabel(createLink(a.id, b.id, L, { name: 'uplink' }))).toBe('uplink');
    expect(connectorLabel(createLink(a.id, b.id, L, { bandwidth: '10G' }))).toBe('10G');
    expect(connectorLabel(createLink(a.id, b.id, L))).toBe('');
  });
});

describe('parallel links', () => {
  it('single link is unchanged; parallel links fan out perpendicular', () => {
    const l = createLink(a.id, b.id, L);
    // Solo → straight (2 points).
    expect(parallelPoints(l, a, b, 0, 1)).toHaveLength(2);
    // In a group of 3, middle (index 1) stays centered, others offset.
    const mid = parallelPoints(l, a, b, 1, 3);
    const off = parallelPoints(l, a, b, 0, 3);
    expect(mid).toHaveLength(3);
    // a→b is horizontal (y=20), so the offset midpoint shifts in y.
    expect(mid[1]!.y).toBeCloseTo(20);
    expect(off[1]!.y).not.toBeCloseTo(20);
  });

  it('explicit waypoints suppress parallel offset', () => {
    const l = createLink(a.id, b.id, L, { waypoints: [{ x: 50, y: 50 }] });
    expect(parallelPoints(l, a, b, 0, 3)).toHaveLength(3);
    expect(parallelPoints(l, a, b, 0, 3)[1]).toEqual({ x: 50, y: 50 });
  });

  it('pairKey is order-independent', () => {
    expect(pairKey(createLink(a.id, b.id, L))).toBe(pairKey(createLink(b.id, a.id, L)));
  });
});

describe('orthogonal routing + multi-label', () => {
  it('orthogonalPoints makes a Z-elbow via mid-x', () => {
    const pts = orthogonalPoints({ x: 0, y: 0 }, { x: 100, y: 60 });
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 60 },
      { x: 100, y: 60 },
    ]);
  });

  it('orthogonalPoints leaves already-straight runs alone', () => {
    expect(orthogonalPoints({ x: 0, y: 0 }, { x: 100, y: 0 })).toHaveLength(2);
  });

  it('connectorLabelLines stacks configured labels', () => {
    const link = createLink(a.id, b.id, L, { name: 'up', bandwidth: '10G', vlan: '10,20', lacp: 'Po1' });
    expect(connectorLabelLines(link)).toEqual(['up', '10G', 'VLAN 10,20', 'LACP Po1']);
    expect(connectorLabelLines(createLink(a.id, b.id, L))).toEqual([]);
  });
});
