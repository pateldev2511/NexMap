import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { createDevice, createInterface, createRackCable, createSubnet } from '@/model/schema';
import { createConnectivityRule, createCountRule, createPlacementRule } from '@/model/invariants';
import { buildRulesReport, hasDeclaredRules, pdfSafe, rulesReportLines, rulesVerdict, type RuleReportEntry } from './rulesReport';
import { appendRulesPages } from './pdf';
import { exportRulesCsv } from './csvExport';

const L = 'layer';

describe('buildRulesReport', () => {
  it('reports each declared rule once with status and offenders (built-ins first)', () => {
    const cctv = createSubnet('10.20.0.0/24', { name: 'CCTV' });
    const cam = createDevice('server', 0, 0, L, { name: 'Cam Lobby', role: 'camera', managementIp: '10.10.0.21' });
    const report = buildRulesReport({
      devices: [cam],
      links: [],
      subnets: [cctv],
      invariants: ['every-device-named'],
      customRules: [createPlacementRule('camera', 'CCTV')],
    });
    expect(report.map((e) => [e.label, e.status])).toEqual([
      ['Every device is named', 'met'],
      ['Every “camera” lives in “CCTV”', 'broken'],
    ]);
    expect(report[1]!.offenders).toEqual([
      { id: cam.id, name: 'Cam Lobby', reason: '10.10.0.21 is in no subnet, not “CCTV”' },
    ]);
    expect(rulesVerdict(report)).toBe('1 of 2 rules met');
  });

  it('reports a count rule by its gap, since no device is at fault', () => {
    const fw = createDevice('firewall', 0, 0, L, { name: 'FW1' });
    const input = { devices: [fw], links: [], subnets: [], invariants: [], customRules: [createCountRule('firewall', 2)] };
    expect(buildRulesReport(input)).toEqual([
      { label: 'At least 2 “firewall”', kind: 'count', status: 'broken', offenders: [], detail: '1 present, 1 short' },
    ]);
    expect(exportRulesCsv(input).split('\r\n')[1]).toBe('At least 2 “firewall”,count,broken,,"1 present, 1 short"');
    expect(rulesReportLines(buildRulesReport(input))).toEqual(['[BROKEN] At least 2 "firewall"', '    1 present, 1 short']);
  });

  it('knows when there is nothing to report', () => {
    expect(hasDeclaredRules(undefined)).toBe(false);
    expect(hasDeclaredRules({ devices: [], links: [], subnets: [], invariants: [], customRules: [] })).toBe(false);
    expect(
      hasDeclaredRules({ devices: [], links: [], subnets: [], invariants: [], customRules: [createConnectivityRule('a', 'b', 1)] }),
    ).toBe(true);
    expect(rulesVerdict([{ label: 'x', kind: 'built-in', status: 'met', offenders: [] }])).toBe('1 of 1 rule met');
  });
});

describe('PDF rules appendix', () => {
  const rules: RuleReportEntry[] = [
    { label: 'Every “access” connects to ≥2 “core”', kind: 'connectivity', status: 'broken', offenders: [
      { id: 'a', name: 'Edge—1', reason: 'links to 1 of ≥2 “core”' },
    ] },
    { label: 'Every device is named', kind: 'built-in', status: 'met', offenders: [] },
  ];

  it('folds typography the built-in font cannot draw, and never emits non-Latin-1', () => {
    expect(pdfSafe('Every “a” connects to ≥2 “b” — ok')).toBe('Every "a" connects to >=2 "b" - ok');
    expect(pdfSafe('café ✓ 机')).toBe('café ? ?');
  });

  it('lays rules out as tagged lines with indented offenders', () => {
    expect(rulesReportLines(rules)).toEqual([
      '[BROKEN] Every "access" connects to >=2 "core"',
      '    - Edge-1: links to 1 of >=2 "core"',
      '[MET] Every device is named',
    ]);
  });

  it('adds a rules page after the diagram, and none when nothing is declared', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    appendRulesPages(doc, [], 'Site');
    expect(doc.getNumberOfPages()).toBe(1);
    appendRulesPages(doc, rules, 'Site');
    expect(doc.getNumberOfPages()).toBe(2);
    const out = doc.output();
    expect(out).toContain('(Site - declared rules) Tj');
    expect(out).toContain('(1 of 2 rules met, checked against the whole design when exported.) Tj');
    expect(out).toContain('(- Edge-1: links to 1 of >=2 "core") Tj');
  });

  it('flows a long report onto further pages', () => {
    const many: RuleReportEntry[] = [
      {
        label: 'No single point of failure',
        kind: 'built-in',
        status: 'broken',
        offenders: Array.from({ length: 120 }, (_, i) => ({ id: `d${i}`, name: `Switch ${i}`, reason: 'its failure cuts off 3 devices' })),
      },
    ];
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    appendRulesPages(doc, many, 'Big');
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
    expect(doc.output()).toContain('(- Switch 119: its failure cuts off 3 devices) Tj');
  });
});

describe('rules report · VLAN rules read rack cables', () => {
  it('a camera patched into the wrong VLAN port is broken in the export, with the port named', () => {
    const cctv = createSubnet('10.20.0.0/24', { name: 'CCTV', vlanId: 20 });
    const gi = createInterface('Gi0/3', { vlan: 10 });
    const sw = createDevice('switch', 0, 0, L, { name: 'SW1', interfaces: [gi] });
    const eth = createInterface('eth0');
    const cam = createDevice('camera', 0, 0, L, { name: 'Cam1', role: 'camera', managementIp: '10.20.0.10', interfaces: [eth] });
    const [entry] = buildRulesReport({
      devices: [sw, cam],
      links: [],
      subnets: [cctv],
      rackCables: [createRackCable({ deviceId: sw.id, ifaceId: gi.id }, { deviceId: cam.id, ifaceId: eth.id }, '#000')],
      invariants: [],
      customRules: [createPlacementRule('camera', 'VLAN 20')],
    });
    expect(entry).toMatchObject({ status: 'broken', offenders: [{ name: 'Cam1', reason: 'SW1 Gi0/3 is on VLAN 10' }] });
  });
});
