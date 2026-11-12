import { describe, it, expect } from 'vitest';
import { expectsLogicalLinks } from './topologyRole';
import { createDevice, createEmptyDocument, createInterface } from './schema';
import { loadDocument } from './migrate';
import { fromDocument, toDocument } from '@/store/modelState';
import { RACK_DEVICE_PRESETS, type RackDevicePreset } from '@/rack/rackDevicePresets';
import type { Device, DeviceType } from './types';

/** A device as the rack designer mounts it from a preset. */
function fromPreset(p: RackDevicePreset): Device {
  return createDevice(p.type, 0, 0, 'layer-1', {
    name: p.name ?? p.label,
    rackId: 'rack-1',
    ru: 1,
    ruSpan: p.span,
    interfaces: Array.from({ length: p.ports }, (_, i) => createInterface(p.portName(i))),
    ...(p.accessory ? { rackAccessory: p.accessory } : {}),
    ...(p.mount ? { mount: p.mount } : {}),
  });
}

/** Every rack preset, by key: does it expect links in the network diagram? */
const PRESET_EXPECTS_LINKS: Record<string, boolean> = {
  'sw-48': true,
  'sw-24': true,
  'sw-16': true,
  'sw-8': true,
  'sw-4': true,
  'sw-core': true,
  'sw-spine': true,
  router: true,
  firewall: true,
  lb: true,
  wlc: true,
  console: true,
  'server-2u': true,
  'server-1u': true,
  blade: true, // no ports of its own, still a server
  'gpu-4u': true,
  storage: true,
  'nas-1u': true,
  tape: true,
  pc: true,
  ups: false,
  psu: false,
  pdu: false,
  'pdu-full': false,
  'cable-mgr': false,
  vcm: false,
  'patch-24': false,
  'patch-48': false,
  fiber: false,
  'fiber-48': false,
  kvm: true,
  blank: false,
  brush: false,
  shelf: false,
};

describe('expectsLogicalLinks', () => {
  it('has a verdict for every rack preset', () => {
    expect(Object.keys(PRESET_EXPECTS_LINKS).sort()).toEqual(RACK_DEVICE_PRESETS.map((p) => p.key).sort());
  });

  it.each(RACK_DEVICE_PRESETS.map((p) => [p.key, p] as const))('classifies rack preset %s', (key, preset) => {
    expect(expectsLogicalLinks(fromPreset(preset))).toBe(PRESET_EXPECTS_LINKS[key]);
  });

  it.each<[DeviceType, boolean]>([
    ['router', true],
    ['switch', true],
    ['firewall', true],
    ['access-point', true],
    ['server', true],
    ['end-user', true],
    ['printer', true],
    ['isp', true],
    ['cloud', true],
    ['generic', true], // on the canvas, not in a rack: a network node of unknown kind
    ['ups', false],
    ['patch-panel', false],
    ['rack', false],
  ])('classifies a plain %s on the canvas', (type, expected) => {
    expect(expectsLogicalLinks(createDevice(type, 0, 0, 'layer-1'))).toBe(expected);
  });

  it('a racked generic unit with ports is a network device', () => {
    const d = createDevice('generic', 0, 0, 'layer-1', { rackId: 'r', interfaces: [createInterface('eth0')] });
    expect(expectsLogicalLinks(d)).toBe(true);
  });

  it('knows an unmarked cable manager by its stock name, unless marked not one', () => {
    const cm = createDevice('generic', 0, 0, 'layer-1', { name: 'cm-01', interfaces: [createInterface('eth0')] });
    expect(expectsLogicalLinks(cm)).toBe(false);
    expect(expectsLogicalLinks({ ...cm, rackAccessory: 'none' })).toBe(true);
  });

  it('an explicit role wins in both directions', () => {
    const ups = createDevice('ups', 0, 0, 'layer-1');
    const sw = createDevice('switch', 0, 0, 'layer-1');
    expect(expectsLogicalLinks({ ...ups, topologyRole: 'logical' })).toBe(true);
    expect(expectsLogicalLinks({ ...sw, topologyRole: 'physical-only' })).toBe(false);
  });

  it('the role survives save and load, and a value it does not know is read as automatic', () => {
    const doc = createEmptyDocument('2026-01-01T00:00:00.000Z');
    const managed = createDevice('ups', 0, 0, doc.layers[0]!.id, { name: 'managed-ups', topologyRole: 'logical' });
    const spare = createDevice('switch', 0, 0, doc.layers[0]!.id, { name: 'spare', topologyRole: 'physical-only' });
    const odd = createDevice('switch', 0, 0, doc.layers[0]!.id, { name: 'odd' });
    const raw = JSON.parse(JSON.stringify({ ...doc, devices: [managed, spare, odd] }));
    raw.devices[2].topologyRole = 'both';

    const loaded = loadDocument(JSON.stringify(raw));
    if (!loaded.ok) throw new Error(loaded.message);
    const saved = JSON.parse(JSON.stringify(toDocument(fromDocument(loaded.doc), loaded.doc)));
    const again = loadDocument(JSON.stringify(saved));
    if (!again.ok) throw new Error(again.message);

    const byName = new Map(again.doc.devices.map((d) => [d.name, d]));
    expect(byName.get('managed-ups')!.topologyRole).toBe('logical');
    expect(byName.get('spare')!.topologyRole).toBe('physical-only');
    expect(expectsLogicalLinks(byName.get('managed-ups')!)).toBe(true);
    expect(expectsLogicalLinks(byName.get('spare')!)).toBe(false);
    expect(expectsLogicalLinks(byName.get('odd')!)).toBe(true); // 'both' → automatic → a switch
  });
});
