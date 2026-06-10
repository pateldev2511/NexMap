import { describe, it, expect } from 'vitest';
import { buildRackSvg, cableScheduleRows, cableScheduleCsv } from './buildRackSvg';
import type { Device, Rack, RackCable } from '@/model/types';

const rack: Rack = { id: 'r1', name: 'MDF "Main"', ruHeight: 42 };

const sw: Device = {
  id: 'sw', kind: 'device', type: 'switch', name: 'core-sw', x: 0, y: 0, width: 56, height: 40, layerId: 'L',
  rackId: 'r1', ru: 40, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full',
  interfaces: [{ id: 'p1', name: 'Gi1/0/1' }, { id: 'p2', name: 'Gi1/0/2' }],
};
const srv: Device = {
  id: 'srv', kind: 'device', type: 'server', name: 'esxi-01', x: 0, y: 0, width: 56, height: 40, layerId: 'L',
  rackId: 'r1', ru: 36, ruSpan: 2, mount: 'rack', side: 'front', bay: 'full',
  interfaces: [{ id: 'nic0', name: 'vmnic0' }],
};
const cable: RackCable = {
  id: 'c1', aEnd: { deviceId: 'sw', ifaceId: 'p1' }, bEnd: { deviceId: 'srv', ifaceId: 'nic0' }, color: '#22d3ee', label: 'uplink',
};

describe('buildRackSvg — export-safe markup', () => {
  const svg = buildRackSvg(rack, [sw, srv], [cable], { background: '#ffffff' });

  it('is a well-formed svg with integer width/height (raster.ts regex reads them)', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    const m = svg.match(/width="(\d+)" height="(\d+)"/);
    expect(m).toBeTruthy();
    expect(Number.isInteger(Number(m![1]))).toBe(true);
  });

  it('uses ZERO CSS variables (the A2 blank-export trap) — only literal colors', () => {
    expect(svg).not.toContain('var(');
    expect(svg).not.toContain('currentColor');
    expect(svg).not.toContain('<foreignObject');
    expect(svg).toContain('#22d3ee'); // the cable color, literal
  });

  it('escapes user strings (rack name has a quote)', () => {
    expect(svg).toContain('MDF &quot;Main&quot; · 42U');
    expect(svg).not.toContain('MDF "Main" · 42U'); // raw quotes would break the attr/markup
  });

  it('draws the device name, jacks, and a color-coded cable line', () => {
    expect(svg).toContain('core-sw');
    expect(svg).toContain('esxi-01');
    expect(svg).toMatch(/<rect[^>]*rx="1.5"/); // jack
    expect(svg).toContain('<path'); // curved, haloed cable
  });

  it('renders an empty rack as a valid frame (the must-test edge case)', () => {
    const empty = buildRackSvg(rack, [], []);
    expect(empty.startsWith('<svg')).toBe(true);
    expect(empty).toContain('MDF &quot;Main&quot; · 42U');
    expect(empty).not.toContain('var(');
  });
});

describe('cable schedule (E3)', () => {
  it('derives installer rows with device:port labels', () => {
    const rows = cableScheduleRows([sw, srv], [cable]);
    expect(rows).toEqual([
      { color: '#22d3ee', label: 'uplink', from: 'core-sw:Gi1/0/1', to: 'esxi-01:vmnic0', lengthFt: '' },
    ]);
  });

  it('falls back to ids when a name is missing, and CSV-quotes fields', () => {
    const csv = cableScheduleCsv([sw, srv], [cable]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Color,Label,From,To,Length (ft)');
    expect(lines[1]).toBe('"#22d3ee","uplink","core-sw:Gi1/0/1","esxi-01:vmnic0",""');
  });
});
