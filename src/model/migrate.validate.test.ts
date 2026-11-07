/**
 * Structural validation (#26): after migration and before the editor adopts a
 * document, every collection the editor indexes must be an array of well-formed
 * entries with unique ids. A file that fails is refused with a readable reason
 * and the field path — it never reaches loadDoc, so the open project survives.
 */
import { describe, it, expect } from 'vitest';
import { loadDocument, migrateDocument } from './migrate';
import { createDevice, createEmptyDocument, SCHEMA_VERSION } from './schema';
import { TEMPLATES, buildTemplate } from './templates';

const NOW = '2026-01-01T00:00:00.000Z';

function withDoc(edit: (doc: Record<string, unknown>) => void): string {
  const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown>;
  edit(doc);
  return JSON.stringify(doc);
}

function refused(raw: string) {
  const r = loadDocument(raw);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('expected a refusal');
  expect(r.reason).toBe('invalid');
  return r;
}

describe('loadDocument structural validation (#26)', () => {
  it('refuses the issue repro: a current-version doc with no layers', () => {
    const r = refused(
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, project: {}, devices: [], links: [] }),
    );
    // The project is checked first; once fixed, the missing layers are named.
    expect(r.path).toBe('project.id');
    const r2 = refused(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        project: { id: 'p', name: 'P' },
        devices: [],
        links: [],
      }),
    );
    expect(r2.path).toBe('layers');
    expect(r2.message).toMatch(/layers/);
  });

  it('refuses a malformed device entry and names its index and field', () => {
    const r = refused(
      withDoc((d) => {
        const layerId = (d.layers as { id: string }[])[0]!.id;
        d.devices = [createDevice('router', 0, 0, layerId), { id: 'x', kind: 'device', type: 'switch', name: 'SW', x: 'nope', y: 0, width: 56, height: 40, layerId }];
      }),
    );
    expect(r.path).toBe('devices[1].x');
    expect(r.message).toContain('devices[1].x');
  });

  it('refuses a non-object entry', () => {
    const r = refused(withDoc((d) => (d.links = [42])));
    expect(r.path).toBe('links[0]');
  });

  it('refuses repeated device ids instead of silently keeping the last one', () => {
    const r = refused(
      withDoc((d) => {
        const layerId = (d.layers as { id: string }[])[0]!.id;
        const a = createDevice('router', 0, 0, layerId);
        const b = { ...createDevice('switch', 10, 10, layerId), id: a.id };
        d.devices = [a, b];
      }),
    );
    expect(r.path).toBe('devices[1].id');
    expect(r.message).toMatch(/devices\[0\]/);
  });

  it('refuses repeated ids in the other indexed collections', () => {
    const rack = { id: 'r1', name: 'MDF', ruHeight: 42 };
    expect(refused(withDoc((d) => (d.racks = [rack, rack]))).path).toBe('racks[1].id');
    const layer = (doc: Record<string, unknown>) => (doc.layers as unknown[])[0];
    expect(refused(withDoc((d) => (d.layers = [layer(d), layer(d)]))).path).toBe('layers[1].id');
  });

  it('refuses an optional collection that is present but not an array', () => {
    expect(refused(withDoc((d) => (d.racks = { r1: {} }))).path).toBe('racks');
    expect(refused(withDoc((d) => (d.objects = 'nope'))).path).toBe('objects');
  });

  it('refuses a text object without blocks and a rack without a height', () => {
    const r = refused(
      withDoc((d) => {
        const layerId = (d.layers as { id: string }[])[0]!.id;
        d.objects = [{ id: 't', kind: 'text', x: 0, y: 0, width: 10, height: 10, layerId }];
      }),
    );
    expect(r.path).toBe('objects[0].blocks');
    expect(refused(withDoc((d) => (d.racks = [{ id: 'r', name: 'R' }]))).path).toBe(
      'racks[0].ruHeight',
    );
  });

  it('still accepts every built-in template and a supported older document', () => {
    for (const t of TEMPLATES) {
      const r = loadDocument(JSON.stringify(buildTemplate(t.key, NOW)));
      expect(r.ok, t.key).toBe(true);
    }
    const v1 = {
      schemaVersion: 1,
      appVersion: '0.1.0',
      project: { id: 'p', name: 'Legacy', createdAt: NOW, updatedAt: NOW, description: '', units: 'px' },
      layers: [{ id: 'L', name: 'Default', visible: true, locked: false, order: 0 }],
      devices: [{ id: 'd1', kind: 'device', type: 'router', name: 'R1', x: 0, y: 0, width: 56, height: 40, layerId: 'L' }],
      links: [],
      objects: [{ id: 't', kind: 'text', x: 0, y: 0, width: 10, height: 10, layerId: 'L', text: 'note' }],
      vlans: [],
      subnets: [],
      racks: [],
      views: [],
      interfaces: [],
      assets: [],
      customFields: [],
    };
    const r = loadDocument(JSON.stringify(v1));
    expect(r.ok).toBe(true);
  });

  it('migrateDocument validates an already-parsed object (autosave drafts)', () => {
    expect(migrateDocument(createEmptyDocument(NOW)).ok).toBe(true);
    const bad = migrateDocument({ schemaVersion: SCHEMA_VERSION, project: { id: 'p', name: 'P' } });
    expect(bad.ok).toBe(false);
  });
});
