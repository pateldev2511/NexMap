import { describe, it, expect } from 'vitest';
import { validationReport } from './zip';
import {
  createDevice,
  createLink,
  createRack,
  createSubnet,
  createVlan,
} from '@/model/schema';

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
