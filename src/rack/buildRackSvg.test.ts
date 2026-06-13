import { describe, it, expect } from 'vitest';
import {
  buildRackSvg,
  buildRackRowSvg,
  buildRackRowFacesSvg,
  buildLabelSheetSvg,
  buildConnectionsTableSvg,
  composeExport,
  cableScheduleRows,
  cableScheduleCsv,
} from './buildRackSvg';
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
      { color: '#22d3ee', label: 'uplink', from: 'core-sw:Gi1/0/1', to: 'esxi-01:vmnic0', lengthFt: '', vlan: '' },
    ]);
  });

  it('falls back to ids when a name is missing, and CSV-quotes fields', () => {
    const csv = cableScheduleCsv([sw, srv], [cable]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Color,Label,From,To,VLAN,Length (ft)');
    expect(lines[1]).toBe('"#22d3ee","uplink","core-sw:Gi1/0/1","esxi-01:vmnic0","",""');
  });

  it('shows the VLAN when both ends agree, and "a/b" when they differ', () => {
    const swV: Device = { ...sw, interfaces: [{ id: 'p1', name: 'Gi1/0/1', vlan: 10 }] };
    const srvSame: Device = { ...srv, interfaces: [{ id: 'nic0', name: 'vmnic0', vlan: 10 }] };
    expect(cableScheduleRows([swV, srvSame], [cable])[0]!.vlan).toBe('10');
    const srvDiff: Device = { ...srv, interfaces: [{ id: 'nic0', name: 'vmnic0', vlan: 20 }] };
    expect(cableScheduleRows([swV, srvDiff], [cable])[0]!.vlan).toBe('10/20');
  });
});

describe('buildRackRowSvg — multiple racks in one canvas', () => {
  const rackB: Rack = { id: 'r2', name: 'IDF-2', ruHeight: 24 };
  const swB: Device = {
    id: 'swB', kind: 'device', type: 'switch', name: 'edge-sw', x: 0, y: 0, width: 56, height: 40, layerId: 'L',
    rackId: 'r2', ru: 20, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full',
    interfaces: [{ id: 'q1', name: 'Gi0/1' }],
  };
  const crossRackCable: RackCable = {
    id: 'x1', aEnd: { deviceId: 'sw', ifaceId: 'p2' }, bEnd: { deviceId: 'swB', ifaceId: 'q1' }, color: '#f59e0b', label: 'inter-rack uplink',
  };

  it('renders two cabinet frames with integer canvas dims and no CSS vars', () => {
    const svg = buildRackRowSvg([rack, rackB], [sw, srv, swB], []);
    expect(svg.startsWith('<svg')).toBe(true);
    const m = svg.match(/width="(\d+)" height="(\d+)"/);
    expect(m).toBeTruthy();
    expect(Number.isInteger(Number(m![1]))).toBe(true);
    // two rack titles, two bays
    expect(svg).toContain('MDF &quot;Main&quot; · 42U');
    expect(svg).toContain('IDF-2 · 24U');
    expect(svg).not.toContain('var(');
    // wider than a single 42U cabinet (two cabinets + gutter)
    const single = buildRackSvg(rack, [sw, srv], []);
    const w1 = Number(single.match(/width="(\d+)"/)![1]);
    expect(Number(m![1])).toBeGreaterThan(w1);
  });

  it('draws a cross-rack cable as a curved path between cabinets', () => {
    const svg = buildRackRowSvg([rack, rackB], [sw, srv, swB], [crossRackCable]);
    expect(svg).toContain('#f59e0b'); // the cross-rack cable color, literal
    expect(svg).toMatch(/<path[^>]*stroke="#f59e0b"/);
  });

  it('single-rack wrapper is identical to a one-element row', () => {
    const viaWrapper = buildRackSvg(rack, [sw, srv], [cable], { background: '#fff' });
    const viaRow = buildRackRowSvg([rack], [sw, srv], [cable], { background: '#fff' });
    expect(viaWrapper).toBe(viaRow);
  });

  it('buildRackRowFacesSvg stacks front over rear (both) and exactly one art <defs>', () => {
    const rearDev: Device = { ...swB, id: 'rsw', name: 'rear-sw', side: 'rear', interfaces: [{ id: 'r1', name: 'Gi0/1' }] };
    const both = buildRackRowFacesSvg([rack, rackB], [sw, srv, swB, rearDev], [], { showRear: true, background: '#fff' });
    expect(both).toContain('· front');
    expect(both).toContain('· rear');
    // de-duped: the shared gradient id appears once even though two rows were stacked
    expect((both.match(/id="rkMetal"/g) ?? []).length).toBe(1);
    const m = both.match(/width="(\d+)" height="(\d+)"/);
    expect(Number.isInteger(Number(m![1]))).toBe(true);

    const frontOnly = buildRackRowFacesSvg([rack, rackB], [sw, srv, swB, rearDev], [], { showRear: false, background: '#fff' });
    expect(frontOnly).toContain('· front');
    expect(frontOnly).not.toContain('U · rear'); // no rear FACE title (the ghost label is fine)
    // rear-hidden front-only export GHOSTS the rear switch so its U isn't blank
    expect(frontOnly).toContain('rear · rear-sw');
    // ...but when both faces are stacked, no ghost is drawn (the real rear row is there)
    expect(both).not.toContain('rear · rear-sw');
  });

  it('a focused single-rack export ghosts the opposite face by default', () => {
    const rearSw: Device = { ...sw, id: 'rsw', name: 'rear-sw', side: 'rear' };
    const frontView = buildRackSvg(rack, [sw, rearSw], [], { side: 'front' });
    expect(frontView).toContain('rear · rear-sw'); // rear gear ghosted onto the front
    expect(frontView).toContain('core-sw'); // real front device still drawn
  });
});

describe('buildConnectionsTableSvg + composeExport (E2 export modes)', () => {
  const rows = cableScheduleRows([sw, srv], [cable]);

  it('renders a header and one row per cable, export-safe (no var, escaped, integer dims)', () => {
    const svg = buildConnectionsTableSvg(rows, { background: '#ffffff', title: 'Connections' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('var(');
    expect(svg).toContain('>From<');
    expect(svg).toContain('core-sw:Gi1/0/1');
    expect(svg).toContain('#22d3ee'); // color swatch fill
    const m = svg.match(/width="(\d+)" height="(\d+)"/);
    expect(Number.isInteger(Number(m![1]))).toBe(true);
  });

  it('renders a valid header-only table for zero cables', () => {
    const svg = buildConnectionsTableSvg([], {});
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('>From<');
  });

  it('composeExport: diagram | table-only | diagram+table', () => {
    const rackSvg = buildRackSvg(rack, [sw, srv], [cable]);
    const tableSvg = buildConnectionsTableSvg(rows, {});
    expect(composeExport(rackSvg, tableSvg, 'diagram')).toBe(rackSvg);
    expect(composeExport(rackSvg, tableSvg, 'table-only')).toBe(tableSvg);
    const both = composeExport(rackSvg, tableSvg, 'diagram+table', '#ffffff');
    expect(both.startsWith('<svg')).toBe(true);
    expect(both).toContain('translate(0,'); // table stacked below
    // taller than either piece alone
    const h = Number(both.match(/height="(\d+)"/)![1]);
    const rh = Number(rackSvg.match(/height="(\d+)"/)![1]);
    expect(h).toBeGreaterThan(rh);
  });
});

describe('buildLabelSheetSvg — printable labels', () => {
  it('emits a label per mounted device with name + rack/U, escaped, integer dims', () => {
    const svg = buildLabelSheetSvg([rack], [sw, srv], {});
    expect(svg).toContain('Rack labels · 2');
    expect(svg).toContain('core-sw');
    expect(svg).toContain('esxi-01');
    expect(svg).toContain('U40'); // sw at U40
    expect(svg).toContain('U36–U37'); // srv is 2U at U36
    expect(svg).toContain('MDF &quot;Main&quot;'); // rack name escaped
    const m = svg.match(/width="(\d+)" height="(\d+)"/);
    expect(Number.isInteger(Number(m![1]))).toBe(true);
  });

  it('handles an empty rack without crashing', () => {
    const svg = buildLabelSheetSvg([rack], [], {});
    expect(svg).toContain('Rack labels · 0');
    expect(svg).toContain('No mounted devices');
  });
});
