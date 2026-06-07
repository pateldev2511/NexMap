import { describe, it, expect } from 'vitest';
import { loadDocument, stripDangerousKeys } from './migrate';
import { createEmptyDocument, SCHEMA_VERSION } from './schema';

const NOW = '2026-01-01T00:00:00.000Z';

describe('loadDocument', () => {
  it('loads a current-version document round-trip', () => {
    const doc = createEmptyDocument(NOW);
    const result = loadDocument(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.schemaVersion).toBe(SCHEMA_VERSION);
      expect(result.doc.project.name).toBe('Untitled NexMap Project');
    }
  });

  it('preserves unknown future fields on a known object', () => {
    const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown>;
    (doc.project as Record<string, unknown>).futureField = { nested: true };
    const result = loadDocument(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.doc.project as unknown as Record<string, unknown>).futureField,
      ).toEqual({ nested: true });
    }
  });

  it('preserves reserved top-level arrays verbatim (forward-compat)', () => {
    const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown>;
    doc.customFields = [{ id: 'cf1', whatever: 42 }];
    const result = loadDocument(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.customFields).toEqual([{ id: 'cf1', whatever: 42 }]);
    }
  });

  it('strips prototype-pollution keys from a hostile file (security)', () => {
    const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown>;
    const hostile = JSON.stringify(doc).replace(
      '"devices":[]',
      '"devices":[{"id":"x","__proto__":{"polluted":true}}]',
    );
    const result = loadDocument(hostile);
    // It loads (sanitized), and Object prototype is NOT polluted.
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('stripDangerousKeys removes __proto__/constructor/prototype recursively', () => {
    const cleaned = stripDangerousKeys({
      a: 1,
      __proto__: { x: 1 },
      nested: { constructor: 2, ok: 3, prototype: 4 },
    } as Record<string, unknown>);
    expect(Object.keys(cleaned)).toEqual(['a', 'nested']);
    expect(Object.keys(cleaned.nested as object)).toEqual(['ok']);
  });

  it('REFUSES a newer-than-supported schema (data safety)', () => {
    const doc = createEmptyDocument(NOW);
    doc.schemaVersion = SCHEMA_VERSION + 1;
    const result = loadDocument(JSON.stringify(doc));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too-new');
    }
  });

  it('rejects corrupt JSON without throwing', () => {
    const result = loadDocument('{ not json ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('corrupt');
  });

  it('rejects a document missing required fields', () => {
    const result = loadDocument(JSON.stringify({ schemaVersion: SCHEMA_VERSION }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('rejects missing/invalid schemaVersion', () => {
    const result = loadDocument(JSON.stringify({ project: {}, devices: [], links: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});

// CRITICAL (eng-review IRON RULE): the v1→v2 interfaces migration is a one-way door on
// user data. These tests guard it.
describe('migration v1 → v2 (first-class interfaces)', () => {
  const v1Doc = () => ({
    schemaVersion: 1,
    appVersion: '0.1.0',
    project: { id: 'p', name: 'Legacy', createdAt: NOW, updatedAt: NOW, description: '', units: 'px' },
    layers: [{ id: 'L', name: 'Default', visible: true, locked: false, order: 0 }],
    devices: [
      { id: 'd1', kind: 'device', type: 'router', name: 'R1', x: 0, y: 0, width: 56, height: 40, layerId: 'L' },
      { id: 'd2', kind: 'device', type: 'switch', name: 'SW1', x: 0, y: 0, width: 56, height: 40, layerId: 'L' },
    ],
    links: [{ id: 'k1', kind: 'link', sourceId: 'd1', targetId: 'd2', layerId: 'L' }],
    objects: [],
    vlans: [],
    subnets: [],
    racks: [],
    views: [],
    interfaces: [],
    assets: [],
    customFields: [],
  });

  it('loads a v1 document and gives every device an interfaces array', () => {
    const result = loadDocument(JSON.stringify(v1Doc()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.schemaVersion).toBe(2);
      expect(result.doc.devices.every((d) => Array.isArray(d.interfaces))).toBe(true);
      expect(result.doc.devices[0]!.interfaces).toEqual([]);
    }
  });

  it('is non-destructive — names, links, and other fields survive', () => {
    const result = loadDocument(JSON.stringify(v1Doc()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.devices.map((d) => d.name)).toEqual(['R1', 'SW1']);
      expect(result.doc.links).toHaveLength(1);
      expect(result.doc.links[0]!.sourceId).toBe('d1');
    }
  });

  it('preserves interfaces a device already has (idempotent-safe)', () => {
    const doc = v1Doc() as Record<string, unknown>;
    (doc.devices as Record<string, unknown>[])[0]!.interfaces = [{ id: 'i1', name: 'Gi0/1' }];
    const result = loadDocument(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.devices[0]!.interfaces).toEqual([{ id: 'i1', name: 'Gi0/1' }]);
    }
  });

  it('reports migratedFrom so the UI can warn about the upgrade', () => {
    const result = loadDocument(JSON.stringify(v1Doc()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.migratedFrom).toBe(1);
  });

  it('does not set migratedFrom when no migration was needed', () => {
    const result = loadDocument(JSON.stringify(createEmptyDocument(NOW)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.migratedFrom).toBeUndefined();
  });

  it('still REFUSES a v3 document (forward guard holds at the new version)', () => {
    const doc = createEmptyDocument(NOW);
    doc.schemaVersion = 3;
    const result = loadDocument(JSON.stringify(doc));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-new');
  });
});

describe('stripDangerousKeys', () => {
  it('removes prototype-pollution keys recursively', () => {
    const evil = JSON.parse(
      '{"a":1,"__proto__":{"polluted":true},"nested":{"constructor":2,"ok":3}}',
    );
    const clean = stripDangerousKeys(evil) as Record<string, unknown>;
    const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    expect(clean.a).toBe(1);
    expect(has(clean, '__proto__')).toBe(false);
    expect((clean.nested as Record<string, unknown>).ok).toBe(3);
    expect(has(clean.nested as object, 'constructor')).toBe(false);
  });

  it('loadDocument strips dangerous keys before use', () => {
    const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown>;
    const raw = JSON.stringify(doc).replace(
      '"devices":[]',
      '"devices":[],"__proto__":{"x":1}',
    );
    const result = loadDocument(raw);
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).x).toBeUndefined(); // global proto not polluted
  });
});
