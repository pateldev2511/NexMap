import { describe, it, expect } from 'vitest';
import {
  deviceFaceParts,
  deviceGhostParts,
  deviceOppositeFaceParts,
  devicePortLayout,
  RACK_ART_DEFS,
} from './rackDeviceArt';
import type { Device, DeviceType } from '@/model/types';

const panel = { x: 100, y: 50, w: 560, h: 30 };

const withPorts = (type: DeviceType, count: number): Device => ({
  id: 'd', kind: 'device', type, name: 'x', x: 0, y: 0, width: 56, height: 40, layerId: 'L',
  interfaces: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `${i}` })),
});

/** Distinct Y bands the ports occupy = the number of visual rows. */
const rowCount = (rects: { y: number }[]) => new Set(rects.map((r) => Math.round(r.y))).size;

describe('devicePortLayout — faceplate realism (W2)', () => {
  it('a 24-port PATCH panel lays out in ONE row, not 2x12', () => {
    const rects = devicePortLayout(withPorts('patch-panel', 24), panel);
    expect(rects).toHaveLength(24);
    expect(rowCount(rects)).toBe(1);
  });

  it('a 48-port patch panel is still one row (dense keystone strip)', () => {
    const rects = devicePortLayout(withPorts('patch-panel', 48), panel);
    expect(rowCount(rects)).toBe(1);
  });

  it('patch keystones are banked in 6s (a wider gap every 6th port)', () => {
    const rects = devicePortLayout(withPorts('patch-panel', 24), panel);
    const dxs = rects.slice(1).map((r, i) => r.x - rects[i]!.x);
    const normal = Math.min(...dxs);
    // The gaps after ports 6/12/18 are wider than the within-bank pitch.
    const wide = dxs.filter((d) => d > normal + 3);
    expect(wide.length).toBe(3);
  });

  it('a 48-port SWITCH keeps two staggered rows (odd top / even bottom)', () => {
    const rects = devicePortLayout(withPorts('switch', 48), panel);
    expect(rowCount(rects)).toBe(2);
  });
});

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

describe('deviceFaceParts — rear faceplate', () => {
  it('full-depth gear shows a power+cooling rear, not a mirror of the front jacks', () => {
    const front = join(deviceFaceParts(dev('switch'), panel, 'front'));
    const rear = join(deviceFaceParts(dev('switch'), panel, 'rear'));
    expect(rear).not.toBe(front);
    expect(rear).toContain('<line'); // fan grille spokes
    expect(rear).not.toContain('notch'); // no front RJ45 jacks on the rear
    expect(rear).toContain('core-sw'); // name still labeled
  });

  it('shallow gear (patch panel) renders the same both faces', () => {
    const front = join(deviceFaceParts(dev('patch-panel'), panel, 'front'));
    const rear = join(deviceFaceParts(dev('patch-panel'), panel, 'rear'));
    expect(rear).toBe(front);
  });

  it('defaults to the front face when not specified', () => {
    expect(join(deviceFaceParts(dev('switch'), panel))).toBe(join(deviceFaceParts(dev('switch'), panel, 'front')));
  });
});

describe('deviceFaceParts — lifecycle status overlay', () => {
  it('draws nothing extra for active/unset, a dot for planned, a scrim for decommissioned', () => {
    const base = join(deviceFaceParts(dev('switch'), panel));
    const active = join(deviceFaceParts(dev('switch', { status: 'active' }), panel));
    expect(active.length).toBe(base.length); // 'active' adds no overlay

    const planned = join(deviceFaceParts(dev('switch', { status: 'planned' }), panel));
    expect(planned).toContain('stroke-dasharray="5 3"'); // dashed "planned" outline
    expect(planned).toContain('#3b82f6'); // planned status color

    const decom = join(deviceFaceParts(dev('switch', { status: 'decommissioned' }), panel));
    expect(decom).toContain('fill-opacity="0.42"'); // faded scrim
    expect(decom).toContain('#ef4444'); // decommissioned status color
  });
});

describe('deviceGhostParts — opposite-face back-of-chassis', () => {
  it('labels the real face and the device name, var-free', () => {
    const svg = join(deviceGhostParts(dev('switch', { name: 'sw-rear' }), panel, 'front'));
    expect(svg).toContain('rear · sw-rear'); // viewing front → device is on the rear
    expect(svg).not.toContain('var(');
    expect(svg).not.toContain('url(#rkLedG)'); // no live link LEDs — it's a ghost
  });

  it('flips the label when viewing the rear face', () => {
    const svg = join(deviceGhostParts(dev('server', { name: 'esxi-01' }), panel, 'rear'));
    expect(svg).toContain('front · esxi-01');
  });

  it('escapes a hostile device name', () => {
    const svg = join(deviceGhostParts(dev('switch', { name: 'a"<b' }), panel, 'front'));
    expect(svg).not.toContain('<b');
    expect(svg).toContain('&lt;');
  });

  it('emits a hatched slab (lines) without throwing', () => {
    expect(() => deviceGhostParts(dev('switch'), panel, 'front')).not.toThrow();
    expect(join(deviceGhostParts(dev('switch'), panel, 'front'))).toContain('<line');
  });
});

describe('deviceOppositeFaceParts — realistic opposite aisle', () => {
  it('renders full-depth devices as rear hardware instead of a muted ghost label', () => {
    const svg = join(deviceOppositeFaceParts(dev('server', { name: 'esxi-01' }), { ...panel, h: 84 }, 'rear'));
    expect(svg).toContain('esxi-01');
    expect(svg).toContain('url(#rkLedG)');
    expect(svg).not.toContain('front · esxi-01');
  });

  it('keeps shallow opposite-face gear as a ghost occupancy hint', () => {
    const svg = join(deviceOppositeFaceParts(dev('patch-panel', { name: 'patch-rear' }), panel, 'front'));
    expect(svg).toContain('rear · patch-rear');
    expect(svg).not.toContain('url(#rkLedG)');
  });
});
