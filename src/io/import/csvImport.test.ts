import { describe, it, expect } from 'vitest';
import {
  autoMap,
  parseDeviceType,
  buildDevices,
  buildLinks,
  buildSubnets,
  buildVlans,
  detectCsvKind,
  DEVICE_FIELDS,
  LINK_FIELDS,
} from './csvImport';
import { parseCsv } from '@/lib/csv';
import { createDevice } from '@/model/schema';

const LAYER = 'L';

describe('autoMap', () => {
  it('maps common device headers (incl. aliases and spaces)', () => {
    const m = autoMap(['Name', 'Device Type', 'Management IP', 'Notes'], DEVICE_FIELDS);
    expect(m.name).toBe('Name');
    expect(m.type).toBe('Device Type');
    expect(m.managementIp).toBe('Management IP');
    expect(m.notes).toBe('Notes');
    expect(m.vendor).toBeNull();
  });

  it('maps link headers', () => {
    const m = autoMap(['source', 'target', 'src_iface', 'bandwidth'], LINK_FIELDS);
    expect(m.source).toBe('source');
    expect(m.target).toBe('target');
    expect(m.sourceInterface).toBe('src_iface');
    expect(m.bandwidth).toBe('bandwidth');
  });
});

describe('parseDeviceType', () => {
  it('maps aliases and falls back to generic', () => {
    expect(parseDeviceType('Router').type).toBe('router');
    expect(parseDeviceType('fw').type).toBe('firewall');
    expect(parseDeviceType('switch').known).toBe(true);
    expect(parseDeviceType('frobnicator')).toEqual({ type: 'generic', known: false });
    expect(parseDeviceType(undefined)).toEqual({ type: 'generic', known: false });
  });
});

describe('buildDevices', () => {
  it('builds devices and warns on unknown type + missing name', () => {
    const csv = parseCsv(
      'name,type,ip\nR1,router,10.0.0.1\nWidget,frobnicator,10.0.0.2\n,switch,10.0.0.3',
    );
    const m = autoMap(csv.headers, DEVICE_FIELDS);
    const res = buildDevices(csv.rows, m, LAYER);
    expect(res.devices).toHaveLength(2);
    expect(res.devices[0]!.name).toBe('R1');
    expect(res.devices[0]!.managementIp).toBe('10.0.0.1');
    expect(res.devices[1]!.type).toBe('generic'); // unknown → generic
    expect(res.skipped).toBe(1); // blank name skipped
    expect(res.warnings.some((w) => /unknown type/.test(w))).toBe(true);
  });

  it('lays devices out without overlap', () => {
    const csv = parseCsv(
      'name\n' + Array.from({ length: 10 }, (_, i) => `D${i}`).join('\n'),
    );
    const res = buildDevices(csv.rows, autoMap(csv.headers, DEVICE_FIELDS), LAYER);
    const coords = new Set(res.devices.map((d) => `${d.x},${d.y}`));
    expect(coords.size).toBe(res.devices.length);
  });
});

describe('buildLinks', () => {
  const a = createDevice('router', 0, 0, LAYER, { name: 'R1' });
  const b = createDevice('switch', 0, 0, LAYER, { name: 'SW1' });

  it('resolves endpoints by name and skips unknown', () => {
    const csv = parseCsv('source,target,bandwidth\nR1,SW1,1G\nR1,Ghost,10G');
    const m = autoMap(csv.headers, LINK_FIELDS);
    const res = buildLinks(csv.rows, m, [a, b], LAYER);
    expect(res.links).toHaveLength(1);
    expect(res.links[0]!.sourceId).toBe(a.id);
    expect(res.links[0]!.targetId).toBe(b.id);
    expect(res.links[0]!.bandwidth).toBe('1G');
    expect(res.skipped).toBe(1);
    expect(res.warnings[0]).toMatch(/Ghost/);
  });

  it('resolves names case-insensitively', () => {
    const csv = parseCsv('source,target\nr1,sw1');
    const res = buildLinks(csv.rows, autoMap(csv.headers, LINK_FIELDS), [a, b], LAYER);
    expect(res.links).toHaveLength(1);
  });
});

describe('detectCsvKind + semantics import', () => {
  it('detects subnet, vlan, link, device CSVs by headers', () => {
    expect(detectCsvKind(['cidr', 'gateway', 'vlan_id'])).toBe('subnets');
    expect(detectCsvKind(['vlan_id', 'name', 'zone'])).toBe('vlans');
    expect(detectCsvKind(['source', 'target', 'bandwidth'])).toBe('links');
    expect(detectCsvKind(['name', 'type', 'ip'])).toBe('devices');
  });

  it('buildSubnets maps cidr/gateway/vlan_id', () => {
    const csv = parseCsv('cidr,gateway,vlan_id,name\n10.0.0.0/24,10.0.0.1,10,Servers');
    const subs = buildSubnets(csv.rows, csv.headers);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.cidr).toBe('10.0.0.0/24');
    expect(subs[0]!.gateway).toBe('10.0.0.1');
    expect(subs[0]!.vlanId).toBe(10);
  });

  it('buildVlans maps vlan_id/name', () => {
    const csv = parseCsv('vlan_id,name,zone\n20,Voice,Floor1');
    const vlans = buildVlans(csv.rows, csv.headers);
    expect(vlans).toHaveLength(1);
    expect(vlans[0]!.vlanId).toBe(20);
    expect(vlans[0]!.name).toBe('Voice');
  });
});
