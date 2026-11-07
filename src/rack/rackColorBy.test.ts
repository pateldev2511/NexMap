import { describe, it, expect } from 'vitest';
import { deviceColorBy, colorByLegend, colorForString, failedFeed, FAILURE_COLORS, STATUS_COLORS } from './rackColorBy';
import type { FeedFailure } from './powerCords';
import type { Device } from '@/model/types';

const dev = (over: Partial<Device>): Device => ({
  id: 'd' + Math.random().toString(36).slice(2), kind: 'device', type: 'switch', name: 'd',
  x: 0, y: 0, width: 56, height: 40, layerId: 'L', rackId: 'r1', ...over,
});

describe('deviceColorBy', () => {
  it('gear mode tints nothing', () => {
    expect(deviceColorBy(dev({ status: 'planned' }), 'gear')).toBeNull();
  });
  it('status mode maps the lifecycle, defaulting unset to active', () => {
    expect(deviceColorBy(dev({ status: 'planned' }), 'status')).toBe(STATUS_COLORS.planned);
    expect(deviceColorBy(dev({}), 'status')).toBe(STATUS_COLORS.active);
  });
  it('owner mode is deterministic and null when no owner', () => {
    expect(deviceColorBy(dev({ owner: 'neteng' }), 'owner')).toBe(colorForString('neteng'));
    expect(deviceColorBy(dev({}), 'owner')).toBeNull();
  });
});

describe('colorForString', () => {
  it('returns a stable color for the same input', () => {
    expect(colorForString('alice')).toBe(colorForString('alice'));
  });
});

describe('colorByLegend', () => {
  it('lists distinct present values, sorted, ignoring unmounted devices', () => {
    const devices = [
      dev({ status: 'active' }),
      dev({ status: 'planned' }),
      dev({ status: 'planned' }), // dup → one entry
      dev({ status: 'decommissioned', rackId: undefined }), // unmounted → excluded
    ];
    const legend = colorByLegend(devices, 'status');
    expect(legend.map((e) => e.value)).toEqual(['active', 'planned']);
    expect(colorByLegend(devices, 'gear')).toEqual([]);
  });
});

describe('color by feed failure', () => {
  const f: FeedFailure = {
    failed: 'A',
    dark: new Map([['gone', 'single-corded']]),
    up: new Set(['ok']),
    deadSources: new Set(['pa']),
    trippedPdus: new Set(['pb']),
    overloadedUps: new Set(['ups']),
  };
  const d = (id: string) => ({ id, kind: 'device', type: 'server', name: id, x: 0, y: 0, width: 1, height: 1, layerId: 'L' }) as Device;

  it('tints what goes dark, what trips, the failed strip and what stays up', () => {
    expect(failedFeed('fail-a')).toBe('A');
    expect(failedFeed('owner')).toBeNull();
    expect(['gone', 'pb', 'ups', 'pa', 'ok', 'patch'].map((id) => deviceColorBy(d(id), 'fail-a', f))).toEqual([
      FAILURE_COLORS.dark, FAILURE_COLORS.trips, FAILURE_COLORS.trips, FAILURE_COLORS.deadStrip, FAILURE_COLORS.up, null,
    ]);
    expect(deviceColorBy(d('gone'), 'fail-a')).toBeNull(); // no simulation, no tint
  });

  it('a legend of only what is present', () => {
    expect(colorByLegend([], 'fail-a', f).map((e) => e.value)).toEqual(['Loses power', 'UPS overloads', 'Strip trips', 'Power down', 'Stays up']);
    expect(colorByLegend([], 'fail-b', { ...f, failed: 'B', dark: new Map(), trippedPdus: new Set(), overloadedUps: new Set() }).map((e) => e.value)).toEqual(['Power down', 'Stays up']);
  });
});
