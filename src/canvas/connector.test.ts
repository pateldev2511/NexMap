import { describe, it, expect } from 'vitest';
import { connectorPoints, pathD, segmentMidpoints, labelAnchor, connectorLabel } from './connector';
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
