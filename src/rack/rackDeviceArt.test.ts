import { describe, it, expect } from 'vitest';
import { deviceFaceParts, RACK_ART_DEFS } from './rackDeviceArt';
import type { Device, DeviceType } from '@/model/types';

const panel = { x: 100, y: 50, w: 560, h: 30 };

function dev(type: DeviceType, over: Partial<Device> = {}): Device {
  return {
    id: 'd', kind: 'device', type, name: 'core-sw', x: 0, y: 0, width: 56, height: 40, layerId: 'L',
    interfaces: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Gi0/${i}` })),
    ...over,
  };
}

const join = (parts: string[]) => parts.join('');

describe('rackDeviceArt — export-safe shared art', () => {
  it('defs declare the gradients exactly once', () => {
    expect(RACK_ART_DEFS).toContain('id="rkMetal"');
    expect(RACK_ART_DEFS).toContain('id="rkLedG"');
    expect(RACK_ART_DEFS.startsWith('<defs>')).toBe(true);
  });

  it('every panel kind returns well-formed, var-free, name-escaped parts', () => {
    const types: DeviceType[] = ['switch', 'firewall', 'patch-panel', 'server', 'ups', 'patch-panel'];
    for (const t of types) {
      const parts = deviceFaceParts(dev(t, { name: 'MDF "A"' }), panel);
      expect(parts.length).toBeGreaterThan(0);
      const svg = join(parts);
      expect(svg).not.toContain('var('); // device art is literal hex
      expect(svg.startsWith('<')).toBe(true);
      expect(svg).toContain('MDF &quot;A&quot;'); // escaped device name
    }
  });

  it('switch draws RJ45 jacks with notch tabs + SFP cages', () => {
    const svg = join(deviceFaceParts(dev('switch'), panel));
    expect(svg).toContain('url(#rkLedG)'); // link LEDs
    expect((svg.match(/rx="1.5"/g) ?? []).length).toBeGreaterThanOrEqual(8); // jacks
  });

  it('patch panel numbers its ports', () => {
    const svg = join(deviceFaceParts(dev('patch-panel'), panel));
    expect(svg).toMatch(/>1<\/text>/);
    expect(svg).toContain('url(#rkPatch)'); // metallic faceplate
  });

  it('server draws drive bays with activity LEDs', () => {
    const svg = join(deviceFaceParts(dev('server', { interfaces: [] }), { ...panel, h: 84 }));
    expect((svg.match(/url\(#rkLedG\)/g) ?? []).length).toBeGreaterThanOrEqual(6); // a LED per bay
  });

  it('a featureless device (blank) has cage screws, no jacks', () => {
    const svg = join(deviceFaceParts(dev('text' as DeviceType, { interfaces: [] }), panel));
    expect(svg).not.toContain('url(#rkLedG)');
    expect(svg).toContain('chassis' in {} ? '' : '#3a4654'); // screw color present
  });

  it('handles a device with zero interfaces without crashing', () => {
    expect(() => deviceFaceParts(dev('switch', { interfaces: [] }), panel)).not.toThrow();
  });
});
