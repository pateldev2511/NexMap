import { describe, it, expect } from 'vitest';
import type { Device, DeviceType } from '@/model/types';
import { hasRackPhotoSkin, rackPhotoSkinKey, rackPhotoSkinParts } from './rackPhotoSkins';

const panel = { x: 100, y: 50, w: 560, h: 64 };

function dev(type: DeviceType, over: Partial<Device> = {}): Device {
  return {
    id: 'd',
    kind: 'device',
    type,
    name: 'gear-01',
    x: 0,
    y: 0,
    width: 56,
    height: 40,
    layerId: 'L',
    interfaces: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Gi0/${i}` })),
    ...over,
  };
}

const join = (parts: string[]) => parts.join('');

describe('rackPhotoSkins — deterministic model skins', () => {
  it('renders known vendor models as SVG-only, var-free skins', () => {
    const cases: Array<[DeviceType, Partial<Device>, string]> = [
      ['server', { vendor: 'Dell', model: 'PowerEdge R750' }, 'server-dell'],
      ['server', { vendor: 'HPE', model: 'ProLiant DL380 Gen11' }, 'server-hpe'],
      ['switch', { vendor: 'Cisco', model: 'Nexus 9336C-FX2' }, 'switch-cisco'],
      ['switch', { vendor: 'Arista', model: '7050SX3-48YC8' }, 'switch-arista'],
      ['ups', { vendor: 'APC', model: 'Smart-UPS SRT 2200', interfaces: [] }, 'ups-apc'],
      ['patch-panel', { vendor: 'Panduit', model: '48-port Cat6 patch' }, 'patch-panduit'],
    ];

    for (const [type, over, key] of cases) {
      const device = dev(type, over);
      const svg = join(rackPhotoSkinParts(device, panel));
      expect(rackPhotoSkinKey(device)).toBe(key);
      expect(svg.length).toBeGreaterThan(200);
      expect(svg).not.toContain('var(');
      // The vendor always leads the label, so it is always visible.
      expect(svg).toContain(device.vendor!);
      // The model may be TRUNCATED: a faceplate name is clamped to its reserved
      // brand margin (faceZones.labelRoom) so it cannot run through the vents and
      // jack rows, which it used to do on every 1U device. What must hold is that
      // whatever IS drawn is a genuine prefix of the full label, never mangled text.
      const drawn = /data-facelabel="1"[^>]*>([^<]*)</.exec(svg)?.[1] ?? '';
      expect(drawn.length).toBeGreaterThan(0);
      const full = `${device.vendor} ${device.model}`;
      // fitText uses '...' and trims before appending it.
      const visible = drawn.replace(/(\.\.\.|…)$/, '').trimEnd();
      expect(full.startsWith(visible)).toBe(true);
    }
  });

  it('renders a different rear skin for full-depth model gear', () => {
    const device = dev('server', { vendor: 'Dell', model: 'PowerEdge R750' });
    const front = join(rackPhotoSkinParts(device, panel, 'front'));
    const rear = join(rackPhotoSkinParts(device, panel, 'rear'));
    expect(rear).not.toBe(front);
    expect(rear).toContain('<line');
    expect(rear).toContain('PowerEdge');
  });

  it('escapes hostile names and model text', () => {
    // A UPS has a wide brand margin, so the hostile characters survive truncation and
    // the ESCAPING itself can still be asserted. (On a port-dense switch the label is
    // clamped short, which would hide the payload and make this test vacuous — the
    // negative assertions below cover that case separately.)
    const roomy = dev('ups', { vendor: 'APC', model: '"<script>', interfaces: [] });
    const svg = join(rackPhotoSkinParts(roomy, panel));
    expect(svg).toContain('&quot;');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');

    // And nothing hostile survives on a dense faceplate either, truncated or not.
    const dense = dev('switch', { vendor: 'Cisco', model: 'Nexus "<script>', name: 'core"<bad>' });
    const denseSvg = join(rackPhotoSkinParts(dense, panel));
    expect(denseSvg).not.toContain('<script>');
    expect(denseSvg).not.toContain('<bad>');
  });

  it('returns no parts for unknown generic gear so the parametric fallback can render', () => {
    const device = dev('generic', { interfaces: [] });
    expect(rackPhotoSkinKey(device)).toBeNull();
    expect(hasRackPhotoSkin(device)).toBe(false);
    expect(rackPhotoSkinParts(device, panel)).toEqual([]);
  });

  it('supports export-safe custom data URI photos per face', () => {
    const frontUri = 'data:image/png;base64,ZmFrZQ==';
    const rearUri = 'data:image/png;base64,cmVhcg==';
    const device = dev('server', {
      extra: {
        rackPhotoFrontDataUri: frontUri,
        rackPhotoRearDataUri: rearUri,
      },
    });
    expect(rackPhotoSkinKey(device)).toBe('custom-data-uri');
    expect(join(rackPhotoSkinParts(device, panel, 'front'))).toContain(`href="${frontUri}"`);
    expect(join(rackPhotoSkinParts(device, panel, 'rear'))).toContain(`href="${rearUri}"`);
  });

  it('does not use a face-specific custom photo on the opposite face', () => {
    const device = dev('generic', {
      extra: { rackPhotoFrontDataUri: 'data:image/png;base64,ZmFrZQ==' },
    });
    expect(hasRackPhotoSkin(device, 'front')).toBe(true);
    expect(hasRackPhotoSkin(device, 'rear')).toBe(false);
    expect(rackPhotoSkinParts(device, panel, 'rear')).toEqual([]);
  });
});
