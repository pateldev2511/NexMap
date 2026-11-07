import { describe, it, expect } from 'vitest';
import { buildHandoffSvg, cableCountLabel, exportFailureMessage, handoffFileName, handoffScope } from './rackExport';
import { buildLabelSheetSvg, cableScheduleCsv, cableScheduleRows } from './buildRackSvg';
import { bomCsv } from './rackBom';
import { powerCordCsv, powerStripCsv } from './powerCords';
import type { Device, Rack, RackCable } from '@/model/types';

// Two racks, A and B: a local run inside each and one run between them.
const A: Rack = { id: 'ra', name: 'Rack A', ruHeight: 42 };
const B: Rack = { id: 'rb', name: 'Rack B', ruHeight: 42, order: 1 };
const dev = (id: string, rackId: string | undefined, ru: number, over: Partial<Device> = {}): Device => ({
  id, kind: 'device', type: 'switch', name: id, x: 0, y: 0, width: 56, height: 40, layerId: 'L',
  ...(rackId ? { rackId, ru, ruSpan: 1 } : {}),
  interfaces: [0, 1].map((i) => ({ id: `${id}-${i}`, name: `p${i}` })),
  ...over,
});
const pdu = (id: string, rackId: string): Device =>
  dev(id, rackId, 1, { type: 'ups', mount: 'rail', side: 'rear', bay: 'right', ruSpan: 42, powerFeed: 'A', interfaces: [{ id: `${id}-o1`, name: 'C13-1' }] });
const devices: Device[] = [
  dev('a-core', 'ra', 20, { watts: 200, powerFeed: 'A' }),
  dev('a-edge', 'ra', 18),
  pdu('a-pdu', 'ra'),
  dev('b-core', 'rb', 20, { watts: 200, powerFeed: 'A' }),
  dev('b-edge', 'rb', 18),
  pdu('b-pdu', 'rb'),
  dev('spare-ap', undefined, 0, { type: 'access-point' }),
];
const cable = (id: string, a: string, b: string, i = 0): RackCable => ({
  id, aEnd: { deviceId: a, ifaceId: `${a}-${i}` }, bEnd: { deviceId: b, ifaceId: `${b}-${i}` }, color: '#2563eb', label: id,
});
// The cross-rack run is drawn from B's side, so A's packet must turn it round.
const cables = [cable('A-LOCAL', 'a-core', 'a-edge'), cable('X-RUN', 'b-core', 'a-core', 1), cable('B-LOCAL', 'b-core', 'b-edge')];
const racks = [A, B];

describe('handoffScope — a focused rack', () => {
  const h = handoffScope('rack', A, racks, devices, cables);

  it('holds A’s gear, A’s local run and its cross-rack run, not B’s local run', () => {
    expect(h.label).toBe('Rack A');
    expect(h.racks).toEqual([A]);
    expect(h.mounted.map((d) => d.id)).toEqual(['a-core', 'a-edge', 'a-pdu']);
    expect(h.cables.map((c) => c.id)).toEqual(['A-LOCAL', 'X-RUN']);
    expect(h.crossRack).toBe(1);
    expect(cableCountLabel(h)).toBe('2 cables (1 cross-rack)');
  });

  it('lists each run from A’s side and names the far rack', () => {
    const rows = cableScheduleRows(devices, h.cables, h.schedule);
    expect(rows.map((r) => [r.label, r.from, r.to, r.crossRack])).toEqual([
      ['A-LOCAL', 'a-core:p0', 'a-edge:p0', ''],
      ['X-RUN', 'a-core:p1', 'b-core:p1', 'to Rack B'],
    ]);
    const csv = cableScheduleCsv(devices, h.cables, h.schedule).split('\n');
    expect(csv[0]).toBe('Color,Label,From,To,Cross-rack,VLAN,Length (ft),Route');
    expect(csv).toHaveLength(3);
    expect(csv[2]).toContain('"a-core:p1","b-core:p1","to Rack B"');
  });

  it('the install packet carries only A’s rows, under titles that say so', () => {
    const svg = buildHandoffSvg(h, devices, cables, { mode: 'table-only', background: '#ffffff', showRear: true, callouts: [] });
    expect(svg).toContain('Connections · Rack A · 2 cables (1 cross-rack)');
    expect(svg).toContain('A-LOCAL');
    expect(svg).toContain('to Rack B');
    expect(svg).not.toContain('B-LOCAL');
    expect(svg).not.toContain('b-edge');
    expect(svg).toContain('Power cords · Rack A');
    expect(svg).toContain('Power strips · Rack A');
    expect(svg).not.toContain('b-pdu');
  });

  it('power, BOM and filenames match the rack the name claims', () => {
    expect(powerCordCsv(h.racks, devices)).not.toContain('Rack B');
    expect(powerStripCsv(h.racks, devices)).not.toContain('Rack B');
    expect(bomCsv(h.bom.devices).split('\r\n').at(-1)).toMatch(/^3,TOTAL/); // A's three units only
    const labels = buildLabelSheetSvg(h.racks, devices, { scope: h.label });
    expect(labels).toContain('Rack labels · Rack A · 3');
    expect(labels).not.toContain('b-core');
    expect(handoffFileName(h, 'install-packet', 'pdf')).toBe('Rack A-install-packet.pdf');
    expect(handoffFileName(h, 'elevation', 'png')).toBe('Rack A.png');
    expect(handoffFileName(h, 'cables', 'csv')).toBe('Rack A-cables.csv');
    expect(handoffFileName(h, 'bom', 'csv')).toBe('Rack A-bom.csv');
    expect(handoffFileName(h, 'labels', 'png')).toBe('Rack A-labels.png');
  });

  it('a name with path characters still makes a usable filename', () => {
    const odd = handoffScope('rack', { ...A, name: 'MDF/1: "core"' }, racks, devices, cables);
    expect(handoffFileName(odd, 'cables', 'csv')).toBe('MDF-1- -core--cables.csv');
  });
});

describe('handoffScope — the fleet', () => {
  const h = handoffScope('fleet', A, racks, devices, cables);

  it('is named as every rack and covers every run, naming both racks of a cross-rack one', () => {
    expect(h.label).toBe('All 2 racks');
    expect(h.cables).toHaveLength(3);
    const rows = cableScheduleRows(devices, h.cables, h.schedule);
    expect(rows.find((r) => r.label === 'X-RUN')).toMatchObject({ from: 'b-core:p1', to: 'a-core:p1', crossRack: 'Rack B → Rack A' });
    expect(handoffFileName(h, 'install-packet', 'png')).toBe('all-racks-install-packet.png');
    expect(handoffFileName(h, 'elevation', 'pdf')).toBe('all-racks.pdf');
    const svg = buildHandoffSvg(h, devices, cables, { mode: 'table-only', background: '#ffffff', showRear: true, callouts: [] });
    expect(svg).toContain('B-LOCAL');
    expect(powerCordCsv(h.racks, devices)).toContain('Rack B');
  });

  it('the fleet BOM is the whole project, unplaced gear included, and is named so', () => {
    expect(h.bom.label).toBe('Whole project');
    expect(h.bom.devices).toHaveLength(devices.length);
    expect(handoffFileName(h, 'bom', 'csv')).toBe('project-bom.csv');
  });
});

describe('exportFailureMessage', () => {
  it('says what failed, why, and what to try', () => {
    const fleet = handoffScope('fleet', A, racks, devices, cables);
    const one = handoffScope('rack', A, racks, devices, cables);
    expect(exportFailureMessage('the All 2 racks install packet PDF', new Error('Canvas export failed'), fleet)).toBe(
      'Couldn’t export the All 2 racks install packet PDF (Canvas export failed). Nothing was downloaded — retry, or export one rack at a time — a very large sheet can pass the browser’s canvas limit.',
    );
    expect(exportFailureMessage('the Rack A label sheet', 'boom', one)).toMatch(/\(the browser gave no reason\).*retry, or export the CSV schedule instead\.$/);
  });
});
