import { readFileSync } from 'node:fs';
import { loadDocument } from './migrate';
import { APP_VERSION, SCHEMA_VERSION, createEmptyDocument } from './schema';

/** docs/FORMAT.md promises its example is a loadable current-schema file. Paths are
 *  repo-root relative (Vitest's working directory). */
const FORMAT = readFileSync('docs/FORMAT.md', 'utf8');

describe('docs/FORMAT.md', () => {
  it('documents the current schema version', () => {
    expect(FORMAT).toContain(`**schema v${SCHEMA_VERSION}**`);
  });

  it('carries a complete example that loads without migration', () => {
    const example = FORMAT.split('## A complete v')[1]?.match(/```json\n([\s\S]*?)\n```/)?.[1];
    expect(example).toBeDefined();
    const result = loadDocument(example!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.migratedFrom).toBeUndefined();
    expect(result.doc.devices).toHaveLength(2);
    expect(result.doc.links[0]?.sourceIfaceId).toBe('if-edge-ge0');
  });
});

describe('appVersion', () => {
  it('stamps new documents with the package.json release', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(createEmptyDocument('2026-01-01T00:00:00.000Z').appVersion).toBe(pkg.version);
  });
});
