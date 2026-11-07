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
import {
  createDevice,
  createLink,
  defaultDeviceName,
  DEVICE_TYPES,
} from '@/model/schema';
import type { Device } from '@/model/types';
import { exportInventoryCsv, exportLinksCsv } from '@/io/export/csvExport';

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

  it('round-trips the endpoint and edge types the CSV export writes', () => {
    expect(parseDeviceType('Laptop').type).toBe('laptop');
    expect(parseDeviceType('IP Phone').type).toBe('ip-phone');
    expect(parseDeviceType('Mobile').type).toBe('mobile');
    expect(parseDeviceType('Modem').type).toBe('modem');
    expect(parseDeviceType('NAS').type).toBe('nas');
  });

  // Loops DEVICE_TYPES rather than listing them, so a type added later can't ship
  // without reading back from the label its own export writes.
  it.each(DEVICE_TYPES)('reads back type %s from its export label and its id', (t) => {
    expect(parseDeviceType(defaultDeviceName(t))).toEqual({ type: t, known: true });
    expect(parseDeviceType(t)).toEqual({ type: t, known: true });
  });

  it('ignores case, spaces, dashes, underscores and slashes', () => {
    expect(parseDeviceType('patch panel').type).toBe('patch-panel');
    expect(parseDeviceType('PATCH_PANEL').type).toBe('patch-panel');
    expect(parseDeviceType('vpc/vnet').type).toBe('vpc');
    expect(parseDeviceType('Internet-GW').type).toBe('internet-gateway');
    expect(parseDeviceType('ip_phone').type).toBe('ip-phone');
    expect(parseDeviceType('Access Point').type).toBe('access-point');
  });

  it('keeps accepting the existing shorthands and a few common cloud aliases', () => {
    expect(parseDeviceType('rtr').type).toBe('router');
    expect(parseDeviceType('wap').type).toBe('access-point');
    expect(parseDeviceType('workstation').type).toBe('end-user');
    expect(parseDeviceType('internet').type).toBe('isp');
    expect(parseDeviceType('san').type).toBe('storage');
    expect(parseDeviceType('VNet').type).toBe('vpc');
    expect(parseDeviceType('IGW').type).toBe('internet-gateway');
    expect(parseDeviceType('NAT').type).toBe('nat-gateway');
    expect(parseDeviceType('VPN').type).toBe('vpn-gateway');
    expect(parseDeviceType('bucket').type).toBe('object-storage');
  });
});

describe('inventory CSV round trip', () => {
  const reimport = (devices: Device[]) => {
    const csv = parseCsv(exportInventoryCsv(devices));
    return buildDevices(csv.rows, autoMap(csv.headers, DEVICE_FIELDS), LAYER);
  };

  it('preserves every built-in type through a real export → import', () => {
    const devices = DEVICE_TYPES.map((t, i) =>
      createDevice(t, 0, 0, LAYER, { name: `dev-${i}` }),
    );
    const res = reimport(devices);
    expect(res.warnings).toEqual([]);
    expect(res.devices.map((d) => [d.name, d.type])).toEqual(
      devices.map((d) => [d.name, d.type]),
    );
  });

  it('keeps names, roles, fields and an entered management prefix', () => {
    const src = createDevice('router', 0, 0, LAYER, {
      name: 'edge-rtr-1',
      vendor: 'Acme',
      model: 'X100',
      role: 'WAN edge',
      location: 'HQ, row 2',
      managementIp: '10.0.0.1/24',
      notes: 'primary uplink',
    });
    const [back] = reimport([src]).devices;
    expect(back).toMatchObject({
      name: 'edge-rtr-1',
      type: 'router',
      vendor: 'Acme',
      model: 'X100',
      role: 'WAN edge',
      location: 'HQ, row 2',
      managementIp: '10.0.0.1/24',
      notes: 'primary uplink',
    });
  });

  it('regression: a patch panel + cloud topology survives inventory and links CSVs', () => {
    const make = (type: Device['type'], name: string) =>
      createDevice(type, 0, 0, LAYER, { name });
    const original = [
      make('switch', 'access-sw-1'),
      make('patch-panel', 'PP-A1'),
      make('vpc', 'prod-vpc'),
      make('cloud-subnet', 'app-subnet'),
      make('internet-gateway', 'igw-1'),
      make('nat-gateway', 'nat-1'),
      make('route-table', 'rt-public'),
      make('security-group', 'sg-web'),
      make('vpn-gateway', 'vgw-1'),
      make('k8s', 'eks-prod'),
      make('managed-db', 'orders-db'),
      make('object-storage', 'assets-bucket'),
    ];
    const byName = new Map(original.map((d) => [d.name, d]));
    const pairs: [string, string][] = [
      ['access-sw-1', 'PP-A1'],
      ['igw-1', 'prod-vpc'],
      ['prod-vpc', 'app-subnet'],
      ['app-subnet', 'nat-1'],
      ['app-subnet', 'eks-prod'],
      ['eks-prod', 'orders-db'],
      ['eks-prod', 'assets-bucket'],
    ];
    const links = pairs.map(([a, b]) =>
      createLink(byName.get(a)!.id, byName.get(b)!.id, LAYER),
    );

    const devices = reimport(original).devices;
    expect(devices.map((d) => d.type)).toEqual(original.map((d) => d.type));

    const linkCsv = parseCsv(exportLinksCsv(links, original));
    const res = buildLinks(
      linkCsv.rows,
      autoMap(linkCsv.headers, LINK_FIELDS),
      devices,
      LAYER,
    );
    expect(res.warnings).toEqual([]);
    const nameOf = new Map(devices.map((d) => [d.id, d.name]));
    expect(
      res.links.map((l) => [nameOf.get(l.sourceId), nameOf.get(l.targetId)]),
    ).toEqual(pairs);
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

  describe('duplicate and near-duplicate device names', () => {
    const link = (csvText: string, devices: Device[]) => {
      const csv = parseCsv(csvText);
      return buildLinks(csv.rows, autoMap(csv.headers, LINK_FIELDS), devices, LAYER);
    };
    const edge = createDevice('switch', 0, 0, LAYER, { name: 'edge' });

    it('skips an exact duplicate with its row number and every match listed', () => {
      const a1 = createDevice('router', 0, 0, LAYER, { name: 'core', location: 'HQ' });
      const a2 = createDevice('switch', 0, 0, LAYER, {
        name: 'core',
        managementIp: '10.9.0.2',
      });
      const res = link('source,target\nedge,edge\ncore,edge', [a1, a2, edge]);
      expect(res.links).toHaveLength(1); // row 1 is fine; row 2 is skipped
      expect(res.skipped).toBe(1);
      expect(res.warnings).toEqual([
        'Row 2: "core" matches 2 devices: core (Router, HQ); core (Switch, 10.9.0.2) — link skipped. Rename devices so names are unique.',
      ]);
    });

    it('prefers the unique exact name over a case variant', () => {
      const lower = createDevice('router', 0, 0, LAYER, { name: 'core' });
      const upper = createDevice('router', 0, 0, LAYER, { name: 'CORE' });
      for (const devices of [
        [lower, upper, edge],
        [upper, lower, edge],
      ]) {
        const res = link('source,target\ncore,edge\nCORE,edge', devices);
        expect(res.warnings).toEqual([]);
        expect(res.links.map((l) => l.sourceId)).toEqual([lower.id, upper.id]);
      }
    });

    it('treats a case/space variant that matches two devices as ambiguous', () => {
      const lower = createDevice('router', 0, 0, LAYER, { name: 'core' });
      const upper = createDevice('router', 0, 0, LAYER, { name: 'CORE' });
      const res = link('source,target\nCore,edge', [lower, upper, edge]);
      expect(res.links).toEqual([]);
      expect(res.warnings[0]).toMatch(/^Row 1: "Core" matches 2 devices: core .*; CORE /);
    });

    it('normalizes case and runs of whitespace for a unique name', () => {
      const sw = createDevice('switch', 0, 0, LAYER, { name: 'Core  SW 1' });
      const res = link('source,target\n  core sw 1 ,EDGE', [sw, edge]);
      expect(res.warnings).toEqual([]);
      expect(res.links[0]).toMatchObject({ sourceId: sw.id, targetId: edge.id });
    });

    it('reports a missing and an ambiguous endpoint on the same row', () => {
      const d1 = createDevice('router', 0, 0, LAYER, { name: 'dup' });
      const d2 = createDevice('router', 0, 0, LAYER, { name: 'dup' });
      const res = link('source,target\ndup,ghost', [d1, d2]);
      expect(res.warnings[0]).toMatch(
        /^Row 1: device not found: ghost; "dup" matches 2 devices: .* — link skipped\./,
      );
    });

    it('never lets device order change which physical link a row makes', () => {
      const devices = [
        createDevice('router', 0, 0, LAYER, { name: 'core' }),
        createDevice('router', 0, 0, LAYER, { name: 'CORE' }),
        createDevice('router', 0, 0, LAYER, { name: 'dist' }),
        createDevice('router', 0, 0, LAYER, { name: 'dist' }),
        edge,
      ];
      const csvText = 'source,target\ncore,edge\nCORE,edge\nCore,edge\ndist,edge';
      const outcome = (ds: Device[]) =>
        link(csvText, ds).links.map((l) => `${l.sourceId}->${l.targetId}`);
      const expected = outcome(devices);
      expect(expected).toHaveLength(2); // only the two exact, unique names
      const permutations = [
        [...devices].reverse(),
        [devices[1]!, devices[3]!, devices[0]!, edge, devices[2]!],
        [edge, devices[2]!, devices[0]!, devices[3]!, devices[1]!],
      ];
      for (const p of permutations) expect(outcome(p)).toEqual(expected);
    });
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
