import { describe, expect, it } from 'vitest';
import type { Device, Rack, RackCable, ValidationIssue } from '@/model/types';
import { rackInsights } from './rackInsights';

const rack = (over: Partial<Rack> = {}): Rack => ({ id: 'r1', name: 'Rack 1', ruHeight: 24, ...over });
const dev = (over: Partial<Device> = {}): Device => ({
  id: 'd1',
  kind: 'device',
  type: 'server',
  name: 'srv-01',
  x: 0,
  y: 0,
  width: 56,
  height: 40,
  layerId: 'L',
  rackId: 'r1',
  ru: 10,
  ruSpan: 2,
  mount: 'rack',
  side: 'front',
  bay: 'full',
  interfaces: [{ id: 'p1', name: 'nic0' }],
  watts: 600,
  powerFeed: 'A',
  ...over,
});
const cable = (over: Partial<RackCable> = {}): RackCable => ({
  id: 'c1',
  aEnd: { deviceId: 'd1', ifaceId: 'p1' },
  bEnd: { deviceId: 'd2', ifaceId: 'p1' },
  color: '#fff',
  ...over,
});

describe('rackInsights', () => {
  it('surfaces actionable selected-device management suggestions', () => {
    const insights = rackInsights({
      racks: [rack()],
      devices: [dev()],
      cables: [cable()],
      selectedDeviceId: 'd1',
      activeRackId: 'r1',
    });

    expect(insights.map((i) => i.action)).toContain('add-asset-tag');
    expect(insights.map((i) => i.action)).toContain('auto-length');
    expect(insights.map((i) => i.action)).toContain('go-to-u');
    expect(insights[0]?.severity).toBe('warn');
  });

  it('prioritizes capacity and health risks above informational suggestions', () => {
    const issue: ValidationIssue = {
      id: 'v1',
      code: 'rack-loop',
      severity: 'warn',
      message: 'Loop detected',
      objectIds: ['c1'],
    };
    const insights = rackInsights({
      racks: [rack({ maxWatts: 100 })],
      devices: [dev({ assetTag: 'A-1', vendor: 'Dell', model: 'R650' })],
      cables: [],
      issues: [issue],
      selectedDeviceId: 'd1',
      activeRackId: 'r1',
    });

    expect(insights[0]).toMatchObject({ action: 'review-rack', severity: 'error' });
    expect(insights.some((i) => i.action === 'review-health')).toBe(true);
  });
});
