import { describe, it, expect } from 'vitest';
import { looksLikeCsv, importPastedCsv } from './clipboardImport';
import type { Device } from '@/model/types';

function dev(id: string, name: string): Device {
  return { id, kind: 'device', type: 'generic', name, x: 0, y: 0, width: 56, height: 40, layerId: 'L' };
}

describe('looksLikeCsv', () => {
  it('accepts comma/tab-delimited text', () => {
    expect(looksLikeCsv('name,type\nR1,router')).toBe(true);
    expect(looksLikeCsv('name\ttype\nR1\trouter')).toBe(true);
  });
  it('rejects plain prose and empty text', () => {
    expect(looksLikeCsv('just a sentence')).toBe(false);
    expect(looksLikeCsv('')).toBe(false);
  });
});

describe('importPastedCsv', () => {
  it('imports devices from a header+rows CSV', () => {
    const r = importPastedCsv('name,type,ip\nR1,router,10.0.0.1\nSW1,switch,10.0.0.2', 'L', []);
    expect(r?.kind).toBe('devices');
    expect(r?.devices.map((d) => d.name)).toEqual(['R1', 'SW1']);
    expect(r?.devices[0]?.type).toBe('router');
    expect(r?.devices.every((d) => d.layerId === 'L')).toBe(true);
  });

  it('detects and imports subnets', () => {
    const r = importPastedCsv('cidr,name\n10.0.0.0/24,Core', 'L', []);
    expect(r?.kind).toBe('subnets');
    expect(r?.subnets[0]?.cidr).toBe('10.0.0.0/24');
  });

  it('detects and imports vlans', () => {
    const r = importPastedCsv('vlan,name\n10,Users', 'L', []);
    expect(r?.kind).toBe('vlans');
    expect(r?.vlans[0]?.vlanId).toBe(10);
  });

  it('detects links and resolves endpoints by name against existing devices', () => {
    const existing = [dev('a', 'R1'), dev('b', 'SW1')];
    const r = importPastedCsv('source,target\nR1,SW1', 'L', existing);
    expect(r?.kind).toBe('links');
    expect(r?.links).toHaveLength(1);
    expect(r?.links[0]?.sourceId).toBe('a');
    expect(r?.links[0]?.targetId).toBe('b');
  });

  it('returns null for non-CSV / empty content', () => {
    expect(importPastedCsv('', 'L', [])).toBeNull();
    expect(importPastedCsv('header-only', 'L', [])).toBeNull();
  });
});
