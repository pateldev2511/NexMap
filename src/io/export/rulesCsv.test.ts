import { describe, it, expect } from 'vitest';
import { exportRulesCsv } from './csvExport';
import { createDevice, createLink, createSubnet } from '@/model/schema';
import { createIsolationRule, createPlacementRule } from '@/model/invariants';
import type { CustomRuleSpec } from '@/model/types';

const L = 'layer';
const lines = (csv: string) => csv.split('\r\n');

describe('exportRulesCsv', () => {
  it('writes only the header when nothing is declared', () => {
    expect(exportRulesCsv({ devices: [], links: [], subnets: [], invariants: [], customRules: [] })).toBe(
      'rule,kind,status,object,reason',
    );
  });

  it('one row per met rule, one row per offender of a broken rule (with the reason)', () => {
    const cctv = createSubnet('10.20.0.0/24', { name: 'CCTV' });
    const office = createSubnet('10.10.0.0/24', { name: 'Office' });
    const cam = createDevice('server', 0, 0, L, { name: 'Cam Lobby', role: 'camera', managementIp: '10.10.0.21' });
    const bare = createDevice('server', 0, 0, L, { name: 'Cam Dock', role: 'camera', managementIp: '' });
    const guest = createDevice('end-user', 0, 0, L, { name: 'Kiosk', role: 'guest', managementIp: '10.10.0.40' });
    const out = exportRulesCsv({
      devices: [cam, bare, guest],
      links: [],
      subnets: [cctv, office],
      invariants: ['every-device-named'],
      customRules: [createPlacementRule('camera', 'CCTV'), createIsolationRule('guest', 'internal')],
    });
    expect(lines(out)).toEqual([
      'rule,kind,status,object,reason',
      'Every device is named,built-in,met,,',
      'Every “camera” lives in “CCTV”,placement,broken,Cam Lobby,"10.10.0.21 is in “Office”, not “CCTV”"',
      'Every “camera” lives in “CCTV”,placement,broken,Cam Dock,no management IP',
      'No “guest” may reach “internal”,isolation,met,,',
    ]);
  });

  it('checks the whole design it is given (a SPOF shows with its blast size)', () => {
    const a = createDevice('switch', 0, 0, L, { name: 'A' });
    const hub = createDevice('switch', 0, 0, L, { name: 'Hub' });
    const b = createDevice('server', 0, 0, L, { name: 'B' });
    const out = exportRulesCsv({
      devices: [a, hub, b],
      links: [createLink(a.id, hub.id, L), createLink(b.id, hub.id, L)],
      subnets: [],
      invariants: ['no-single-point-of-failure'],
      customRules: [],
    });
    expect(lines(out)[1]).toMatch(/^No single point of failure,built-in,broken,Hub,its failure cuts off \d+ devices?$/);
  });

  it('lists rules from a newer build as "not checked", never as met', () => {
    const future = { id: 'x', kind: 'quorum', fromRole: 'core', toRole: '', min: 3 } as unknown as CustomRuleSpec;
    const out = exportRulesCsv({
      devices: [],
      links: [],
      subnets: [],
      invariants: ['every-thing-encrypted'],
      customRules: [future],
    });
    expect(lines(out).slice(1)).toEqual([
      'every-thing-encrypted,built-in,not checked,,rule from a newer NexMap',
      'quorum rule,quorum,not checked,,rule from a newer NexMap',
    ]);
  });

  it('guards cells against formula injection like the other CSVs', () => {
    const evil = createDevice('server', 0, 0, L, { name: '=HYPERLINK("x")', role: 'camera', managementIp: '' });
    const out = exportRulesCsv({
      devices: [evil],
      links: [],
      subnets: [createSubnet('10.20.0.0/24', { name: 'CCTV' })],
      invariants: [],
      customRules: [createPlacementRule('camera', 'CCTV')],
    });
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
