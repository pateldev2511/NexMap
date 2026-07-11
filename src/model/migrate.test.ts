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
      // loadDocument always migrates to the current version (v1 → v2 → v3); the
      // interfaces assertion below proves the v1 → v2 step ran along the way.
      expect(result.doc.schemaVersion).toBe(SCHEMA_VERSION);
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

  it('a fresh document carries the current schema version + rackCables', () => {
    const doc = createEmptyDocument(NOW);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    const result = loadDocument(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.rackCables).toEqual([]);
  });
});

// CRITICAL: v3→v4 folds the flat text/heading/subheading fields of a text object
// into an ordered `blocks` array and DELETES the old fields. One-way door on user
// annotations — these guard the conversion end-to-end.
describe('migration v3 → v4 (rich callouts)', () => {
  // A v2-era doc so the whole chain v2→v3→v4 runs over the same text objects.
  const v2DocWithNotes = () => ({
    schemaVersion: 2,
    appVersion: '0.1.0',
    project: { id: 'p', name: 'Notes', createdAt: NOW, updatedAt: NOW, description: '', units: 'px' },
    layers: [{ id: 'L', name: 'Default', visible: true, locked: false, order: 0 }],
    devices: [],
    links: [],
    objects: [
      // full annotation card
      { id: 't1', kind: 'text', x: 0, y: 0, width: 160, height: 28, layerId: 'L',
        heading: 'Core', subheading: 'site A', text: 'rack 1', fontSize: 14, color: '#111' },
      // body only (no heading/subheading)
      { id: 't2', kind: 'text', x: 0, y: 0, width: 160, height: 28, layerId: 'L', text: 'just body' },
      // multi-line body → multiple paragraph blocks
      { id: 't3', kind: 'text', x: 0, y: 0, width: 160, height: 28, layerId: 'L', text: 'line1\nline2' },
      // a shape must pass through untouched
      { id: 's1', kind: 'shape', shape: 'rect', x: 0, y: 0, width: 40, height: 40, layerId: 'L', label: 'zone' },
    ],
    vlans: [], subnets: [], racks: [], views: [], interfaces: [], assets: [], customFields: [],
  });

  const loadNotes = () => {
    const result = loadDocument(JSON.stringify(v2DocWithNotes()));
    if (!result.ok) throw new Error('expected ok load');
    return result.doc;
  };

  it('migrates all the way to the current version', () => {
    expect(loadNotes().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('folds heading/subheading/body into ordered blocks', () => {
    const t1 = loadNotes().objects.find((o) => o.id === 't1')!;
    expect(t1.kind).toBe('text');
    if (t1.kind === 'text') {
      expect(t1.blocks).toEqual([
        { kind: 'heading', spans: [{ text: 'Core' }] },
        { kind: 'subheading', spans: [{ text: 'site A' }] },
        { kind: 'paragraph', spans: [{ text: 'rack 1' }] },
      ]);
      // fontSize/color survive; old flat fields are gone.
      expect(t1.fontSize).toBe(14);
      expect(t1.color).toBe('#111');
      expect((t1 as unknown as Record<string, unknown>).heading).toBeUndefined();
      expect((t1 as unknown as Record<string, unknown>).text).toBeUndefined();
    }
  });

  it('body-only note becomes a single paragraph', () => {
    const t2 = loadNotes().objects.find((o) => o.id === 't2')!;
    if (t2.kind === 'text') {
      expect(t2.blocks).toEqual([{ kind: 'paragraph', spans: [{ text: 'just body' }] }]);
    }
  });

  it('splits a multi-line body into one paragraph per line', () => {
    const t3 = loadNotes().objects.find((o) => o.id === 't3')!;
    if (t3.kind === 'text') {
      expect(t3.blocks).toEqual([
        { kind: 'paragraph', spans: [{ text: 'line1' }] },
        { kind: 'paragraph', spans: [{ text: 'line2' }] },
      ]);
    }
  });

  it('leaves non-text objects untouched', () => {
    const s1 = loadNotes().objects.find((o) => o.id === 's1')!;
    expect(s1.kind).toBe('shape');
    if (s1.kind === 'shape') expect(s1.label).toBe('zone');
  });

  it('is idempotent — re-loading an already-migrated doc keeps one blocks field', () => {
    const once = loadNotes();
    const twice = loadDocument(JSON.stringify(once));
    expect(twice.ok).toBe(true);
    if (twice.ok) {
      const t1 = twice.doc.objects.find((o) => o.id === 't1')!;
      if (t1.kind === 'text') {
        expect(t1.blocks).toHaveLength(3);
        expect((t1 as unknown as Record<string, unknown>).heading).toBeUndefined();
      }
    }
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
