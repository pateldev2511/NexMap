/**
 * Canvas paste clones objects from the in-memory clipboard. A clone of an image
 * must obey the same rule as a loaded one: only an embedded (data:) source, so a
 * paste can never put a remote href — or a non-numeric opacity — into an export.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '@/store/projectStore';
import { buildSvg } from '@/io/export/buildSvg';
import { loadDocument } from '@/model/migrate';
import { createEmptyDocument } from '@/model/schema';
import type { ImageObject } from '@/model/types';

const s = () => useProjectStore.getState();
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const images = () => s().objectsAll().filter((o): o is ImageObject => o.kind === 'image');

beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('paste sanitises image objects', () => {
  it('a pasted remote-href image carries no href; an embedded one is intact', () => {
    // A remote image cannot be added through the UI any more; put one in the model
    // the only way left (a document handed straight to the store).
    const doc = createEmptyDocument('2026-01-01T00:00:00.000Z');
    const bad = 'bad';
    doc.objects.push({ id: bad, kind: 'image', x: 0, y: 0, width: 20, height: 20, layerId: doc.layers[0]!.id, href: 'https://evil.example/pixel.png?u=1' });
    s().loadDoc(doc);
    s().updateObject(bad, { opacity: undefined }, { opacity: '1"/><script>' as unknown as number });
    const good = s().addImage(PNG, 20, 20);
    s().updateObject(good, { opacity: undefined }, { opacity: 0.4 });
    expect(images().find((o) => o.id === bad)!.opacity).toBe('1"/><script>');
    s().select([bad, good]);
    s().copySelection();
    s().paste();
    const pasted = images().filter((o) => o.id !== bad && o.id !== good);
    expect(pasted).toHaveLength(2);
    const pastedBad = pasted.find((o) => o.href !== PNG)!;
    const pastedGood = pasted.find((o) => o.href === PNG)!;
    expect(pastedBad.href).toBe('');
    expect(pastedBad.opacity).toBeUndefined();
    expect(pastedGood.opacity).toBe(0.4);
    // …and whatever is in the model, the export writes only the embedded images.
    const svg = buildSvg([], [], { background: null, includeLabels: true, objects: s().objectsAll() });
    expect(svg).not.toContain('evil.example');
    expect(svg).not.toContain('<script');
    expect(svg.match(/<image /g)).toHaveLength(2);
  });

  it('addImage refuses a source that is not embedded, and accepts any embedded image type', () => {
    for (const href of ['https://evil.example/p.png', '//evil.example/p.png', 'blob:null/1', 'javascript:alert(1)', 'data:text/html,x', ' data:image/png;base64,AA']) {
      expect(s().addImage(href, 10, 10), href).toBe('');
    }
    expect(images()).toHaveLength(0);
    expect(s().canUndo).toBe(false);
    expect(s().flash).toMatch(/could not be added/);
    for (const sub of ['tiff', 'x-icon', 'vnd.microsoft.icon', 'heic', 'heif', 'apng', 'jxl', 'x-png', 'pjpeg']) {
      expect(s().addImage(`data:image/${sub};base64,AAAA`, 10, 10), sub).not.toBe('');
    }
    expect(images()).toHaveLength(9);
    // …and they survive save → reopen, and reach the export.
    const r = loadDocument(JSON.stringify(s().getDocument()));
    expect(r.ok && r.warnings).toBeUndefined();
    expect(r.ok && r.doc.objects).toHaveLength(9);
    const svg = buildSvg([], [], { background: null, includeLabels: true, objects: s().objectsAll() });
    expect(svg.match(/<image /g)).toHaveLength(9);
  });
});
