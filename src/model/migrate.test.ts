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

describe('stripDangerousKeys', () => {
  it('removes prototype-pollution keys recursively', () => {
    const evil = JSON.parse('{"a":1,"__proto__":{"polluted":true},"nested":{"constructor":2,"ok":3}}');
    const clean = stripDangerousKeys(evil) as Record<string, unknown>;
    const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    expect(clean.a).toBe(1);
    expect(has(clean, '__proto__')).toBe(false);
    expect((clean.nested as Record<string, unknown>).ok).toBe(3);
    expect(has(clean.nested as object, 'constructor')).toBe(false);
  });

  it('loadDocument strips dangerous keys before use', () => {
    const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown>;
    const raw = JSON.stringify(doc).replace('"devices":[]', '"devices":[],"__proto__":{"x":1}');
    const result = loadDocument(raw);
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).x).toBeUndefined(); // global proto not polluted
  });
});
