import { describe, it, expect } from 'vitest';
import { validationReport } from './zip';
import { createDevice, createLink } from '@/model/schema';

const L = 'layer';

describe('validationReport', () => {
  it('reports a clean project', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1', managementIp: '10.0.0.1' });
    const report = validationReport([a], []);
    expect(report).toContain('Devices: 1');
    expect(report).toContain('No validation issues');
  });

  it('lists issues by severity', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1', managementIp: '10.0.0.1' });
    const b = createDevice('switch', 0, 0, L, { name: 'R1', managementIp: '10.0.0.1' }); // dup ip + dup name
    const report = validationReport([a, b], [createLink(a.id, 'ghost', L)]);
    expect(report).toMatch(/\[ERROR\]/);
    expect(report).toContain('Issues:');
  });
});
