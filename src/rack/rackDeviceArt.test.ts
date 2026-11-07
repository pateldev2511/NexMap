import { describe, it, expect } from 'vitest';
import {
  deviceFaceParts,
  deviceGhostParts,
  deviceOppositeFaceParts,
  devicePortLayout,
  faceStyleFor,
  RACK_ART_DEFS,
} from './rackDeviceArt';
import { RACK_DEVICE_PRESETS } from './rackDevicePresets';
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

  // The bug my first W2a attempt missed: the VISIBLE patch panel is drawn by a
  // photo skin (rackPhotoSkins.patchPanelSkin), a different code path from
  // devicePortLayout. Testing devicePortLayout alone passed while the rendered
  // panel still showed 2 rows AND its ports no longer lined up with the cable
  // hit markers. This tests the ACTUAL rendered output + the alignment.
  it('the RENDERED patch panel (deviceFaceParts) draws port numbers in one row', () => {
    // Panduit/patch-panel matches the photo-skin path, not the fallback art.
    const dev = withPorts('patch-panel', 24);
    dev.vendor = 'Panduit';
    const svg = join(deviceFaceParts(dev, panel));
    // Port numbers are the small mono <text ... font-size="5">N</text> the skin
    // draws. Match the whole tag (attribute order varies), keep the font-size=5
    // ones, pull their y.
    const ys = [...svg.matchAll(/<text\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((t) => t.includes('font-size="5"'))
      .map((t) => Math.round(parseFloat(/\by="([\d.]+)"/.exec(t)![1]!)));
    expect(ys.length).toBeGreaterThanOrEqual(20); // most of 24 ports numbered
    expect(new Set(ys).size).toBe(1); // ONE row, not two
  });

  it('drawn patch ports align with the cable hit markers (no click desync)', () => {
    const dev = withPorts('patch-panel', 24);
    dev.vendor = 'Panduit';
    // Hit markers come from devicePortLayout; both must use the same layout.
    const markerXs = devicePortLayout(dev, panel).map((r) => Math.round(r.x));
    const svg = join(deviceFaceParts(dev, panel));
    // The skin's jack rects (fill #111827) — the visible port bodies.
    const jackXs = [...svg.matchAll(/<rect\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((r) => r.includes('fill="#111827"'))
      .map((r) => Math.round(parseFloat(/\bx="([\d.]+)"/.exec(r)![1]!)));
    expect(jackXs.length).toBe(24);
    // Every drawn jack sits at a hit-marker x (same layout → same coordinates).
    expect(jackXs.every((jx) => markerXs.some((mx) => Math.abs(mx - jx) <= 1))).toBe(true);
  });

  it('a generic UPS renders a battery+LCD faceplate, not PSU fan grilles', () => {
    const ups: Device = {
      id: 'u', kind: 'device', type: 'ups', name: 'UPS 1', x: 0, y: 0, width: 56, height: 88, layerId: 'L',
      interfaces: [],
    };
    const svg = join(deviceFaceParts(ups, { x: 100, y: 50, w: 560, h: 88 }));
    expect(svg).toContain('url(#rkLCD)'); // status LCD
    expect((svg.match(/url\(#rkLedG\)/g) ?? []).length).toBeGreaterThanOrEqual(3); // charge bar segments
  });

  it('a vendor-skinned APC UPS uses its photo skin, not the fallback', () => {
    const apc: Device = {
      id: 'u', kind: 'device', type: 'ups', name: 'UPS 1', vendor: 'APC', model: 'Smart-UPS SRT 2200',
      x: 0, y: 0, width: 56, height: 88, layerId: 'L', interfaces: [],
    };
    const svg = join(deviceFaceParts(apc, { x: 100, y: 50, w: 560, h: 88 }));
    expect(svg).toContain('#7f1d1d'); // the APC skin's red UPS badge — skin took precedence
  });

  it('router / LB / WLC render as appliances (accent + console, no SFP cages)', () => {
    const cases: [DeviceType, string][] = [
      ['router', '#2563eb'],
      ['load-balancer', '#ef4444'],
      ['wireless-controller', '#14b8a6'],
    ];
    for (const [type, accent] of cases) {
      const svg = join(deviceFaceParts(withPorts(type, 8), panel));
      expect(svg).toContain(accent); // type-colored accent stripe
      expect(svg).toContain('#38bdf8'); // console port (light-blue border)
      expect(svg).toContain('#f59e0b'); // mgmt port (amber border)
    }
  });

  it('a vendor-skinned appliance still uses its photo skin, not the fallback', () => {
    const f5: Device = {
      id: 'l', kind: 'device', type: 'load-balancer', name: 'LB', vendor: 'F5', model: 'BIG-IP',
      x: 0, y: 0, width: 56, height: 40, layerId: 'L',
      interfaces: [{ id: 'p0', name: '1.1' }],
    };
    const svg = join(deviceFaceParts(f5, panel));
    // The load-balancer skin (applianceFrontSkin) runs before panelKindFor; it
    // does not emit the fallback's amber mgmt port + blue console pair.
    const hasFallbackConsolePair = svg.includes('#38bdf8') && svg.includes('#f59e0b');
    expect(hasFallbackConsolePair).toBe(false);
  });

  it('a rail-mounted PDU renders a vertical outlet strip (not a horizontal panel)', () => {
    const pdu: Device = {
      id: 'p', kind: 'device', type: 'ups', name: 'PDU 1', mount: 'rail',
      x: 0, y: 0, width: 16, height: 240, layerId: 'L',
      interfaces: Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, name: `C13-${i}` })),
    };
    // A rail strip: narrow and tall.
    const stripPanel = { x: 500, y: 40, w: 16, h: 240 };
    const parts = deviceFaceParts(pdu, stripPanel);
    const svg = join(parts);
    // Outlet rects (fill C.cage #161c24) — stacked in a column: many distinct
    // Y, essentially one X.
    const outlets = [...svg.matchAll(/<rect\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((r) => r.includes('fill="#161c24"') && /width="1[01]/.test(r))
      .map((r) => ({
        x: Math.round(parseFloat(/\bx="([\d.]+)"/.exec(r)![1]!)),
        y: Math.round(parseFloat(/\by="([\d.]+)"/.exec(r)![1]!)),
      }));
    expect(outlets.length).toBeGreaterThanOrEqual(6); // most of 8 outlets fit
    expect(new Set(outlets.map((o) => o.y)).size).toBeGreaterThanOrEqual(6); // stacked vertically
    expect(new Set(outlets.map((o) => o.x)).size).toBe(1); // single column
  });

  it('a PDU strip too short for its outlets draws fewer, never a negative-height one', () => {
    const pdu: Device = {
      id: 'p', kind: 'device', type: 'ups', name: 'PDU 1', mount: 'rail',
      x: 0, y: 0, width: 16, height: 30, layerId: 'L',
      interfaces: Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, name: `C13-${i}` })),
    };
    const svg = join(deviceFaceParts(pdu, { x: 50, y: 5, w: 16, h: 30 }));
    expect(svg).not.toMatch(/(height|width)="-/);
    const outlets = [...svg.matchAll(/<rect\b[^>]*fill="#161c24"[^>]*>/g)];
    expect(outlets.length).toBeGreaterThan(0);
    expect(outlets.length).toBeLessThan(8);
  });

  it('a rail-mounted cable manager draws a finger duct per U, not PDU outlets', () => {
    const vm: Device = {
      id: 'v', kind: 'device', type: 'generic', name: 'Vertical manager 1', mount: 'rail',
      rackAccessory: 'cable-manager', ruSpan: 8,
      x: 0, y: 0, width: 16, height: 240, layerId: 'L', interfaces: [],
    };
    const svg = join(deviceFaceParts(vm, { x: 500, y: 40, w: 16, h: 240 }));
    const fingers = [...svg.matchAll(/<rect\b[^>]*height="4"[^>]*>/g)];
    expect(fingers).toHaveLength(8);
    expect(svg).not.toContain('url(#rkLedG)'); // no PDU breaker LED
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
    expect((svg.match(/url\(#rkJack\)/g) ?? []).length).toBe(8); // one metal shield per port
    expect((svg.match(/url\(#rkCage\)/g) ?? []).length).toBeGreaterThanOrEqual(4); // uplink cages
  });

  it('10G+ ports draw as SFP cages, copper as RJ45', () => {
    const optical = dev('switch', {
      interfaces: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `Te1/${i + 1}` })),
    });
    const svg = join(deviceFaceParts(optical, panel));
    expect(svg).not.toContain('url(#rkJack)');
    expect((svg.match(/url\(#rkCage\)/g) ?? []).length).toBe(8 + 4); // 8 ports + 4 uplinks
  });

  it('every drawn jack sits on its cable hit rect, for every faceplate style', () => {
    const types: DeviceType[] = ['switch', 'firewall', 'router', 'server', 'storage', 'patch-panel'];
    for (const t of types) {
      const d = dev(t);
      const rects = devicePortLayout(d, { ...panel, h: 60 });
      const svg = join(deviceFaceParts(d, { ...panel, h: 60 }));
      for (const r of rects) expect(svg, `${t} ${r.name}`).toContain(`x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}"`);
    }
  });

  it('dense port fields stay clear of the uplink block and the mounting ears', () => {
    const full = { x: 10, y: 0, w: 580, h: 30 };
    for (const [type, count] of [['switch', 52], ['switch', 48], ['firewall', 16], ['router', 8]] as const) {
      const d = dev(type, { interfaces: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Gi1/0/${i + 1}` })) });
      const svg = join(deviceFaceParts(d, full));
      const right = Math.max(...devicePortLayout(d, full).map((r) => r.x + r.w));
      // Every right-hand block element (cages, console, LCD) starts after the last jack.
      const blockXs = [...svg.matchAll(/<rect x="([\d.]+)"[^>]*(url\(#rkCage\)|#38bdf8|url\(#rkLCD\))/g)]
        .map((m) => parseFloat(m[1]!))
        .filter((x) => x > full.x + full.w / 2); // the right-hand block, not the left-zone console
      expect(blockXs.length, type).toBeGreaterThan(0);
      expect(Math.min(...blockXs), `${type} ${count}`).toBeGreaterThanOrEqual(right);
      expect(right, `${type} ${count}`).toBeLessThan(full.x + full.w - 11);
    }
  });

  it('the silkscreen never runs into the first port', () => {
    const long = 'a-very-long-hostname-for-the-core-distribution-switch-01';
    for (const t of ['switch', 'firewall', 'router', 'server'] as DeviceType[]) {
      const d = dev(t, { name: long });
      const first = Math.min(...devicePortLayout(d, panel).map((r) => r.x));
      const label = /<text data-facelabel="1" x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)</.exec(join(deviceFaceParts(d, panel)))!;
      const end = parseFloat(label[1]!) + label[3]!.length * parseFloat(label[2]!) * 0.6;
      expect(end, t).toBeLessThanOrEqual(first + 0.5);
    }
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

// hideFaceplateText must suppress the device NAME on BOTH render paths (the photo
// skin AND the parametric chassis fallback) — the two-renderer trap that bit patch
// panels. Every faceplate name carries data-facelabel; brand badges / ports do not.
describe('deviceFaceParts — hide faceplate name labels', () => {
  it('SKIN path (Cisco switch): name label present by default, gone when hidden', () => {
    const cisco = dev('switch', { vendor: 'Cisco', model: 'C9300', name: 'core-sw' });
    expect(join(deviceFaceParts(cisco, panel, 'front', false))).toContain('data-facelabel');
    expect(join(deviceFaceParts(cisco, panel, 'front', true))).not.toContain('data-facelabel');
  });

  it('CHASSIS fallback (unbranded switch): name present by default, gone when hidden', () => {
    const plain = dev('switch', { vendor: undefined, model: undefined, name: 'edge-sw-01' });
    const shown = join(deviceFaceParts(plain, panel, 'front', false));
    expect(shown).toContain('data-facelabel');
    expect(shown).toContain('edge-sw-01');
    const hidden = join(deviceFaceParts(plain, panel, 'front', true));
    expect(hidden).not.toContain('data-facelabel');
    expect(hidden).not.toContain('edge-sw-01');
  });

  it('keeps the realistic faceplate — LED/ports survive when the name is hidden', () => {
    const cisco = dev('switch', { vendor: 'Cisco', name: 'core-sw' });
    // hiding the name does not blank the whole faceplate (LED glow still there)
    expect(join(deviceFaceParts(cisco, panel, 'front', true))).toContain('url(#rkLedG)');
  });
});

describe('deviceFaceParts — review regressions', () => {
  const ports = (n: number, name = (i: number) => `Gi1/0/${i + 1}`) =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: name(i) }));
  const withPresets = (h: (d: Device, p: { x: number; y: number; w: number; h: number }) => void) => {
    for (const p of RACK_DEVICE_PRESETS) {
      const d = dev(p.type, { name: p.name ?? p.label, rackAccessory: p.accessory, mount: p.mount, ruSpan: p.span, interfaces: ports(Math.min(p.ports, 48), p.portName) });
      h(d, p.mount === 'rail' ? { x: 50, y: 5, w: 16, h: 30 } : { x: 5, y: 5, w: 112, h: Math.max(22, Math.min(34, p.span * 13)) });
    }
  };

  it('library thumbnails and short rail strips never emit a negative size', () => {
    withPresets((d, p) => {
      for (const face of ['front', 'rear'] as const) {
        const svg = join(deviceFaceParts(d, p, face));
        expect(svg, `${d.name} ${face}`).not.toMatch(/(width|height|rx|r)="-/);
        expect(svg, `${d.name} ${face}`).not.toContain('NaN');
      }
    });
  });

  it('a branded rail PDU still draws as an outlet strip', () => {
    const pdu = dev('ups', { name: 'PDU', vendor: 'APC', model: 'AP8853', mount: 'rail', interfaces: ports(8, (i) => `C13-${i}`) });
    const svg = join(deviceFaceParts(pdu, { x: 500, y: 40, w: 16, h: 240 }));
    expect(svg).toContain('url(#rkPduBody)');
    expect(svg).not.toContain('url(#rkLCD)');
  });

  it('a 24-port patch panel fits a half-width bay', () => {
    const half = { x: 10, y: 0, w: 288, h: 30 };
    const rects = devicePortLayout(dev('patch-panel', { interfaces: ports(24, (i) => `${i + 1}`) }), half);
    expect(Math.max(...rects.map((r) => r.x + r.w))).toBeLessThanOrEqual(half.x + half.w);
  });

  it('storage I/O ports stay left of the drive cage; blade I/O stays above the PSU bay', () => {
    const full = { x: 10, y: 0, w: 580, h: 120 };
    const sto = dev('storage', { interfaces: ports(8) });
    const cageX = Math.min(...[...join(deviceFaceParts(sto, full)).matchAll(/<rect x="([\d.]+)"[^>]*fill="url\(#rkCaddy\)"/g)].map((m) => parseFloat(m[1]!)));
    expect(Math.max(...devicePortLayout(sto, full).map((r) => r.x + r.w))).toBeLessThan(cageX);

    const blade = dev('server', { name: 'Blade chassis', ruSpan: 6, interfaces: ports(4) });
    const six = { x: 10, y: 0, w: 580, h: 180 };
    const io = devicePortLayout(blade, six);
    expect(io.length).toBe(4);
    expect(Math.max(...io.map((r) => r.y + r.h))).toBeLessThan(six.y + 14); // inside the top bezel
  });

  it('a 1U unit named "chassis" is a server, not a squeezed blade bay', () => {
    expect(faceStyleFor(dev('server', { name: 'chassis-01', ruSpan: 1 }))).toBe('server');
    expect(faceStyleFor(dev('server', { name: 'Blade chassis', ruSpan: 6 }))).toBe('blade');
  });
});
