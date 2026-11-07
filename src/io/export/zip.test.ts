import { describe, it, expect } from 'vitest';
import { packageTextFiles, validationReport } from './zip';
import { twoSiteDoc } from './__fixtures__/twoSite';
import {
  createDevice,
  createEmptyDocument,
  createLink,
  createRack,
  createSubnet,
  createVlan,
} from '@/model/schema';
import { loadDocument } from '@/model/migrate';

const L = 'layer';

describe('validationReport', () => {
  it('reports a clean project', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1', managementIp: '10.0.0.1' });
    const report = validationReport({ devices: [a], links: [], projectName: 'Clean' });
    expect(report).toContain('Devices: 1');
    expect(report).toContain('Generated for: Clean');
    expect(report).toContain('No validation issues');
  });

  it('lists issues by severity', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1', managementIp: '10.0.0.1' });
    const b = createDevice('switch', 0, 0, L, { name: 'R1', managementIp: '10.0.0.1' }); // dup ip + dup name
    const report = validationReport({
      devices: [a, b],
      links: [createLink(a.id, 'ghost', L)],
    });
    expect(report).toMatch(/\[ERROR\]/);
    expect(report).toContain('Issues:');
  });

  it('includes semantic validation in package reports', () => {
    const rack = createRack('Rack 1');
    const a = createDevice('server', 0, 0, L, {
      name: 'A',
      rackId: rack.id,
      ru: 41,
      ruSpan: 4,
    });
    const report = validationReport({
      devices: [a],
      links: [],
      vlans: [createVlan(5000, 'bad')],
      subnets: [createSubnet('10.0.0.0/24'), createSubnet('10.0.0.128/25')],
      racks: [rack],
      projectName: 'Semantic project',
    });
    expect(report).toContain('VLANs: 1');
    expect(report).toContain('Subnets: 2');
    expect(report).toContain('Racks: 1');
    expect(report).toContain('VLAN');
    expect(report).toContain('overlap');
    expect(report).toContain('outside rack capacity');
  });
});

describe('packageTextFiles', () => {
  const base = { doc: createEmptyDocument('2026-01-01T00:00:00.000Z'), projectName: 'P' };
  const withRules = (invariants: string[]) => ({ ...base, doc: { ...base.doc, invariants } });

  it('bundles the editable file, CSVs and validation report', () => {
    expect(Object.keys(packageTextFiles(base)).sort()).toEqual(
      ['inventory.csv', 'links.csv', 'project.nexmap', 'validation-report.txt'].sort(),
    );
  });

  it('adds rules.csv only when the design declares rules', () => {
    expect(packageTextFiles(withRules([]))['rules.csv']).toBeUndefined();
    const out = packageTextFiles(withRules(['every-device-named']));
    expect(out['rules.csv']).toBe('rule,kind,status,object,reason\r\nEvery device is named,built-in,met,,');
  });

  it('derives every text file from the one whole-project document it carries', () => {
    const { doc } = twoSiteDoc();
    const files = packageTextFiles({ doc, projectName: 'Two sites' });
    const reopened = loadDocument(files['project.nexmap']!);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.doc.devices.map((d) => d.name).sort()).toEqual(['BR-R1', 'BR-SW1', 'HQ-R1', 'HQ-SW1']);
    expect(reopened.doc.links).toHaveLength(3);
    expect(reopened.doc.subnets).toHaveLength(2);
    expect(reopened.doc.invariants).toEqual(['every-device-named']);
    for (const name of ['HQ-R1', 'HQ-SW1', 'BR-R1', 'BR-SW1']) expect(files['inventory.csv']).toContain(name);
    expect(files['links.csv']!.trim().split('\r\n')).toHaveLength(1 + 3);
    expect(files['validation-report.txt']).toContain('Generated for: Two sites');
    expect(files['validation-report.txt']).toContain('Devices: 4  Links: 3  VLANs: 0  Subnets: 2  Racks: 0');
    expect(files['rules.csv']).toContain('Every device is named,built-in,met');
  });
});
