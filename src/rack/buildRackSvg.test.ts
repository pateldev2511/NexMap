import { describe, it, expect } from 'vitest';
import {
  buildRackSvg,
  buildRackRowSvg,
  buildRackRowFacesSvg,
  buildLabelSheetSvg,
  buildConnectionsTableSvg,
  buildPowerCordsTableSvg,
  buildPowerStripsTableSvg,
  powerCordRows,
  vstackSvg,
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

describe('buildRackSvg — hide faceplate names', () => {
  it('drops device name labels from the elevation export when the rack opts in', () => {
    const shown = buildRackSvg(rack, [sw, srv], [], { background: '#fff' });
    expect(shown).toContain('data-facelabel');
    const hidden = buildRackSvg(
      { ...rack, hideFaceplateText: true },
      [sw, srv],
      [],
      { background: '#fff' },
    );
    expect(hidden).not.toContain('data-facelabel');
    expect(hidden).not.toContain('esxi-01'); // the server name is gone
    expect(hidden).toContain('url(#rkLedG)'); // faceplate art still renders
  });
});

describe('buildRackSvg — rack-scoped callouts', () => {
  const callout = {
    id: 'c1', kind: 'text' as const, x: 700, y: 20, width: 220, height: 40, layerId: 'L',
    rackScope: 'r1', blocks: [{ kind: 'heading' as const, spans: [{ text: 'core-sw' }] }],
    anchor: { type: 'device' as const, id: 'sw' },
    leader: { color: '#ef4444', dash: 'dotted' as const, width: 2 },
  };

  it('draws the callout box + a leader to its device, and grows the export width', () => {
    const base = buildRackSvg(rack, [sw, srv], [], { background: '#fff' });
    const withCallout = buildRackSvg(rack, [sw, srv], [], { background: '#fff', callouts: [callout] });
    expect(withCallout).toContain('data-callout-id="c1"');
    expect(withCallout).toContain('data-leader-for="c1"');
    expect(withCallout).toContain('core-sw');
    // The callout column (x≈700 + 220) pushes the export wider than the bare cabinet.
    const w = (s: string) => Number(s.match(/width="(\d+)"/)![1]);
    expect(w(withCallout)).toBeGreaterThan(w(base));
  });

  it('renders no callout for a rackScope that is not this rack', () => {
    const other = { ...callout, id: 'c2', rackScope: 'other' };
    const svg = buildRackSvg(rack, [sw, srv], [], { background: '#fff', callouts: [other] });
    expect(svg).not.toContain('data-callout-id');
  });
});

describe('buildRackSvg — hideCableLabels', () => {
  it('omits per-cable labels on the elevation when asked (they live in the schedule)', () => {
    const shown = buildRackSvg(rack, [sw, srv], [cable], { background: '#fff' });
    expect(shown).toContain('uplink'); // cable.label rendered on the elevation
    const hidden = buildRackSvg(rack, [sw, srv], [cable], { background: '#fff', hideCableLabels: true });
    expect(hidden).not.toContain('uplink'); // suppressed
  });
});

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
      { color: '#22d3ee', label: 'uplink', from: 'core-sw:Gi1/0/1', to: 'esxi-01:vmnic0', crossRack: '', lengthFt: '', vlan: '', route: '' },
    ]);
  });

  it('falls back to ids when a name is missing, and CSV-quotes fields', () => {
    const csv = cableScheduleCsv([sw, srv], [cable]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Color,Label,From,To,Cross-rack,VLAN,Length (ft),Route');
    expect(lines[1]).toBe('"#22d3ee","uplink","core-sw:Gi1/0/1","esxi-01:vmnic0","","","",""');
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
    expect(frontOnly).not.toContain('U · rear'); // no rear FACE title
    // rear-hidden front-only export still hints rear gear so its U isn't blank
    expect(frontOnly).toContain('rear-sw');
    // ...but the old muted ghost label is not used for full-depth switch backs
    expect(frontOnly).not.toContain('rear · rear-sw');
    // ...and when both faces are stacked, the rear row has hardware context without ghost labels
    expect(both).toContain('rear-sw');
    expect(both).not.toContain('rear · rear-sw');
  });

  it('a focused single-rack export renders opposite full-depth gear as rear hardware by default', () => {
    const rearSw: Device = { ...sw, id: 'rsw', name: 'rear-sw', side: 'rear' };
    const frontView = buildRackSvg(rack, [sw, rearSw], [], { side: 'front' });
    expect(frontView).toContain('rear-sw'); // rear gear still occupies the front view
    expect(frontView).not.toContain('rear · rear-sw'); // full-depth backs use hardware art
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

describe('power cords in the install packet', () => {
  const base = { kind: 'device', x: 0, y: 0, width: 56, height: 40, layerId: 'L', mount: 'rack', side: 'front', bay: 'full' } as const;
  const r1: Rack = { id: 'r1', name: 'MDF', ruHeight: 12 };
  const r2: Rack = { id: 'r2', name: 'IDF', ruHeight: 12 };
  const pdu: Device = {
    ...base, id: 'pa', type: 'ups', name: 'pdu-a', rackId: 'r1', ru: 1, ruSpan: 12, mount: 'rail', side: 'rear', bay: 'right', powerFeed: 'A',
    interfaces: Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, name: `C13-${i + 1}` })),
  };
  const esx: Device = { ...base, id: 's1', type: 'server', name: 'esxi-01', rackId: 'r1', ru: 12, ruSpan: 1, powerFeed: 'AB' };
  const idfSw: Device = { ...base, id: 's2', type: 'switch', name: 'idf-sw', rackId: 'r2', ru: 5, ruSpan: 1 };

  it('lists every cord in racks with PDUs, and skips racks with none', () => {
    expect(powerCordRows([r1, r2], [pdu, esx, idfSw])).toEqual([
      { rack: 'MDF', device: 'esxi-01', u: 'U12', feed: 'A', pdu: 'pdu-a', outlet: 'C13-1' },
      { rack: 'MDF', device: 'esxi-01', u: 'U12', feed: 'B', pdu: 'no free outlet', outlet: '' },
    ]);
  });

  it('renders an export-safe table that stacks under the connections', () => {
    const table = buildPowerCordsTableSvg(powerCordRows([r1], [pdu, esx]), { background: '#ffffff', title: 'Power cords' });
    expect(table.startsWith('<svg')).toBe(true);
    expect(table).not.toContain('var(');
    expect(table).toContain('>Power cords<');
    expect(table).toContain('>Outlet<');
    expect(table).toContain('>C13-1<');
    expect(table).toContain('>no free outlet<');
    const both = vstackSvg(buildConnectionsTableSvg([], {}), table, '#ffffff');
    const h = (svg: string) => Number(svg.match(/height="(\d+)"/)![1]);
    expect(h(both)).toBeGreaterThan(h(table));
  });

  it('a power-strip table with each strip’s load and both failure verdicts, only for racks with PDUs', () => {
    const pdb: Device = { ...pdu, id: 'pb', name: 'pdu-b', bay: 'left', powerFeed: 'B', ratedAmps: 10, ratedVolts: 200 };
    const big: Device = { ...esx, watts: 2400 };
    const table = buildPowerStripsTableSvg([r1, r2], [pdu, pdb, big, idfSw], { background: '#ffffff', title: 'Power strips' })!;
    expect(table).toContain('>Power strips<');
    expect(table).toContain('>If other feed fails<');
    expect(table).toContain('>10 A × 200 V · 2.00 kW<');
    expect(table).toContain('>trips if A fails<');
    expect(table).toContain('>no rating<');
    // The verdicts cover every exported rack, like the row view's: the IDF's single-corded switch counts.
    expect(table).toContain('>If feed A fails: 2 units lose power (1 single-corded, 1 on a tripped strip) · pdu-b trips<');
    expect(table).not.toContain('>IDF<'); // …but the IDF has no PDU, so no row
    expect(buildPowerStripsTableSvg([r2], [idfSw])).toBeNull();
  });

  it('a table on a dark export sits on a white card, so its text stays legible', () => {
    const table = buildPowerCordsTableSvg(powerCordRows([r1], [pdu, esx]), { background: '#0c1015', title: 'Power cords' });
    expect(table).toMatch(/<rect x="0" y="0" width="\d+" height="\d+" rx="6" fill="#ffffff"\/>/);
    expect(table).not.toContain('#0c1015');
  });
});
