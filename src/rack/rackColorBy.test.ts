import { describe, it, expect } from 'vitest';
import { deviceColorBy, colorByLegend, colorForString, STATUS_COLORS } from './rackColorBy';
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
