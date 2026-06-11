import { describe, it, expect } from 'vitest';
import { loadDocument } from './migrate';
import { SCHEMA_VERSION } from './schema';

const NOW = '2026-01-01T00:00:00.000Z';

/** A minimal v2 document with one racked device, one free device, and a rack. */
function v2Doc() {
  return {
    schemaVersion: 2,
    appVersion: '0.1.0',
    project: { id: 'p', name: 'P', createdAt: NOW, updatedAt: NOW, description: '', units: 'px' },
    layers: [{ id: 'L', name: 'Default', visible: true, locked: false, order: 0 }],
    devices: [
      { id: 'sw', kind: 'device', type: 'switch', name: 'core-sw', x: 0, y: 0, width: 56, height: 40, layerId: 'L', interfaces: [], rackId: 'r1', ru: 40, ruSpan: 1 },
      { id: 'free', kind: 'device', type: 'router', name: 'rtr', x: 100, y: 100, width: 56, height: 40, layerId: 'L', interfaces: [] },
    ],
    links: [],
    objects: [],
    interfaces: [],
    vlans: [],
    subnets: [],
    racks: [{ id: 'r1', name: 'MDF', ruHeight: 42 }],
    views: [],
    assets: [],
    customFields: [],
  };
}

describe('v2 → v3 migration (rack designer)', () => {
  it('stamps v3 and adds an empty rackCables collection', () => {
    const r = loadDocument(JSON.stringify(v2Doc()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.schemaVersion).toBe(3);
    expect(r.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.doc.rackCables).toEqual([]);
    expect(r.migratedFrom).toBe(2);
  });

  it('gives racked devices default slot qualifiers, keeping ru/ruSpan canonical', () => {
    const r = loadDocument(JSON.stringify(v2Doc()));
    if (!r.ok) return;
    const sw = r.doc.devices.find((d) => d.id === 'sw')!;
    expect(sw).toMatchObject({ ru: 40, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full' });
  });

  it('leaves free-canvas (non-racked) devices untouched', () => {
    const r = loadDocument(JSON.stringify(v2Doc()));
    if (!r.ok) return;
    const free = r.doc.devices.find((d) => d.id === 'free')!;
    expect(free.mount).toBeUndefined();
    expect(free.side).toBeUndefined();
    expect(free.bay).toBeUndefined();
  });

  it('CRITICAL: round-trips identically (load → save → load) with no drift', () => {
    const first = loadDocument(JSON.stringify(v2Doc()));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const saved = JSON.stringify(first.doc);
    const second = loadDocument(saved);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Second load is already v3 → no further migration, byte-identical doc.
    expect(JSON.stringify(second.doc)).toBe(saved);
    expect(second.migratedFrom).toBeUndefined();
  });

  it('preserves an existing rackCables array on a hand-written v2.5 doc', () => {
    const doc = { ...v2Doc(), rackCables: [{ id: 'c1', aEnd: { deviceId: 'sw', ifaceId: 'p1' }, bEnd: { deviceId: 'free', ifaceId: 'p1' }, color: '#fff' }] };
    const r = loadDocument(JSON.stringify(doc));
    if (!r.ok) return;
    expect(r.doc.rackCables).toHaveLength(1);
  });
});

describe('too-new guard protects v3 cabling from old builds', () => {
  it('refuses a future (v4) document rather than load-and-drop', () => {
    const future = { ...v2Doc(), schemaVersion: SCHEMA_VERSION + 1 };
    const r = loadDocument(JSON.stringify(future));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too-new');
  });
});

describe('v2 designer (multi-rack/budget) optional fields round-trip without a version bump', () => {
  it('preserves Device watts/weightKg and Rack maxWatts/maxWeightKg/order across load→save→load', () => {
    const doc = {
      ...v2Doc(),
      schemaVersion: SCHEMA_VERSION, // already a current-version doc carrying the new fields
      devices: [
        { id: 'sw', kind: 'device', type: 'switch', name: 'core-sw', x: 0, y: 0, width: 56, height: 40, layerId: 'L', interfaces: [], rackId: 'r1', ru: 40, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', watts: 120, weightKg: 6 },
      ],
      racks: [{ id: 'r1', name: 'MDF', ruHeight: 42, maxWatts: 5000, maxWeightKg: 400, order: 2 }],
      rackCables: [],
    };
    const first = loadDocument(JSON.stringify(doc));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const d = first.doc.devices.find((x) => x.id === 'sw')!;
    expect(d.watts).toBe(120);
    expect(d.weightKg).toBe(6);
    const r = first.doc.racks[0]!;
    expect(r.maxWatts).toBe(5000);
    expect(r.maxWeightKg).toBe(400);
    expect(r.order).toBe(2);
    // round-trip stable
    const saved = JSON.stringify(first.doc);
    const second = loadDocument(saved);
    if (!second.ok) return;
    expect(JSON.stringify(second.doc)).toBe(saved);
  });

  it('loads a doc WITHOUT the new fields (they stay undefined)', () => {
    const r = loadDocument(JSON.stringify({ ...v2Doc(), schemaVersion: SCHEMA_VERSION, rackCables: [] }));
    if (!r.ok) return;
    expect(r.doc.racks[0]!.maxWatts).toBeUndefined();
    expect(r.doc.devices[0]!.watts).toBeUndefined();
  });
});
