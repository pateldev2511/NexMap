/**
 * Load hardening: migrateDocument is total (#72), absurd geometry is refused
 * (#78), and what an export would interpolate is repaired on load — a remote
 * image source is removed, non-numeric numbers never survive.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { loadDocument, loadRepairSummary, migrateDocument, MIGRATIONS, stripDangerousKeys } from './migrate';
import { createEmptyDocument, isSafeColor, isSafeImageHref, safeColor, SCHEMA_VERSION } from './schema';
import { clampFontSize, calloutRowsOrPlaceholder } from './callout';
import { TEMPLATES, buildTemplate } from './templates';

const NOW = '2026-01-01T00:00:00.000Z';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function docWith(edit: (doc: Record<string, unknown[]> & Record<string, unknown>) => void) {
  const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown[]> &
    Record<string, unknown>;
  edit(doc);
  return doc;
}
const layerOf = (doc: Record<string, unknown[]>) => (doc.layers![0] as { id: string }).id;
const dev = (L: string, over: Record<string, unknown> = {}) => ({
  id: 'd1', kind: 'device', type: 'router', name: 'R1', x: 0, y: 0, width: 56, height: 40, layerId: L,
  ...over,
});
const obj = (L: string, over: Record<string, unknown>) => ({
  id: 'o1', x: 0, y: 0, width: 100, height: 50, layerId: L, ...over,
});

function deep(depth: number): unknown {
  let v: unknown = 0;
  for (let i = 0; i < depth; i++) v = [v];
  return v;
}

describe('migrateDocument never throws (#72)', () => {
  const original = { ...MIGRATIONS };
  afterEach(() => {
    for (const k of Object.keys(MIGRATIONS)) delete MIGRATIONS[Number(k)];
    Object.assign(MIGRATIONS, original);
  });

  it('turns a throwing migration step into a corrupt refusal', () => {
    MIGRATIONS[SCHEMA_VERSION - 1] = () => {
      throw new TypeError('boom inside a migration');
    };
    const doc = { ...createEmptyDocument(NOW), schemaVersion: SCHEMA_VERSION - 1 };
    let r!: ReturnType<typeof migrateDocument>;
    expect(() => (r = migrateDocument(doc))).not.toThrow();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('corrupt');
    expect(r.message).toBe('This file is damaged and could not be read.');
    expect(() => loadDocument(JSON.stringify(doc))).not.toThrow();
    expect(loadDocument(JSON.stringify(doc)).ok).toBe(false);
  });

  it('refuses a 200k-deep nested array instead of overflowing the stack', () => {
    const DEPTH = 200_000;
    // As a parsed object (the autosave-draft path)…
    const parsed = { ...createEmptyDocument(NOW), customFields: deep(DEPTH) };
    let r!: ReturnType<typeof migrateDocument>;
    expect(() => (r = migrateDocument(parsed))).not.toThrow();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('corrupt');
    // …and as file text through the public open path.
    const raw = JSON.stringify(createEmptyDocument(NOW)).replace(
      '"customFields":[]',
      `"customFields":${'['.repeat(DEPTH)}${']'.repeat(DEPTH)}`,
    );
    expect(raw.length).toBeGreaterThan(2 * DEPTH);
    let r2!: ReturnType<typeof loadDocument>;
    expect(() => (r2 = loadDocument(raw))).not.toThrow();
    expect(r2.ok).toBe(false);
    // Ordinary nesting is still copied, minus the pollution keys.
    const out = stripDangerousKeys(JSON.parse('{"a":[{"b":{"__proto__":{"x":1},"c":2}}]}'));
    expect(out).toEqual({ a: [{ b: { c: 2 } }] });
  });

});

describe('absurd values are repaired, never a reason to refuse the file (#78, round 2)', () => {
  const repaired = (edit: Parameters<typeof docWith>[0]) => {
    const r = migrateDocument(docWith(edit));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`expected the file to open: ${r.message}`);
    return r;
  };

  it('opens a file with a rack taller than 1000U, limiting it and saying so', () => {
    const r = repaired((d) => d.racks!.push({ id: 'r', name: 'R', ruHeight: 5000 }, { id: 'ok', name: 'S', ruHeight: 1000 }));
    expect(r.doc.racks.map((x) => x.ruHeight)).toEqual([1000, 1000]);
    expect(r.warnings).toEqual(['1 rack height was limited to 1000U']);
    expect(loadRepairSummary(r)).toBe('Opened with 1 repair: 1 rack height was limited to 1000U.');
  });

  it('limits a 1e9 box and a far-away position instead of refusing', () => {
    const r = repaired((d) => {
      d.devices!.push(dev(layerOf(d), { width: 1e9, x: -2e9 }));
      d.objects!.push(obj(layerOf(d), { kind: 'shape', shape: 'rect', height: 1e9 }));
      d.links!.push({ id: 'l', kind: 'link', sourceId: 'd1', targetId: 'd1', layerId: layerOf(d), waypoints: [{ x: 1e12, y: 0 }] });
    });
    expect(r.doc.devices[0]).toMatchObject({ width: 1e7, x: -1e7 });
    expect(r.doc.objects[0]!.height).toBe(1e7);
    expect(r.doc.links[0]!.waypoints).toEqual([{ x: 1e7, y: 0 }]);
    expect(r.warnings).toEqual(['4 positions or sizes were out of range and were limited']);
  });

  it('keeps everything the editor\'s own unbounded inputs can produce, untouched and unwarned', () => {
    const r = repaired((d) => {
      const L = layerOf(d);
      d.devices!.push(dev(L, { x: -50_000, y: 9e6, width: 4000, height: 0, ru: 2000, ruSpan: 1500, iconScale: 9 }));
      d.devices!.push(dev(L, { id: 'neg', width: -20, height: -5 }));
      d.racks!.push({ id: 'r', name: 'R', ruHeight: 1000 });
      d.links!.push({ id: 'l', kind: 'link', sourceId: 'd1', targetId: 'neg', layerId: L, width: 8, color: '#ff0000' });
      d.objects!.push(obj(L, { id: 't0', kind: 'text', blocks: [], fontSize: 0 }));
      d.objects!.push(obj(L, { id: 't1', kind: 'text', blocks: [], fontSize: 99999, color: 'rgb(1, 2, 3)', leader: { color: 'var(--accent)', dash: 'solid', width: 400 } }));
      d.objects!.push(obj(L, { id: 's', kind: 'shape', shape: 'rect', fill: 'none', stroke: 'currentColor' }));
    });
    expect(r.warnings).toBeUndefined();
    expect(r.doc.devices[0]).toMatchObject({ ru: 2000, ruSpan: 1500, iconScale: 9, height: 0 });
    expect(r.doc.devices[1]).toMatchObject({ width: -20, height: -5 });
    const t1 = r.doc.objects[1] as unknown as { fontSize: number; leader: { width: number; color: string } };
    expect(t1.fontSize).toBe(99999);
    expect(t1.leader).toEqual({ color: 'var(--accent)', dash: 'solid', width: 400 });
    expect((r.doc.objects[0] as unknown as { fontSize: number }).fontSize).toBe(0);
  });

  it('still refuses what cannot be indexed: a non-finite coordinate', () => {
    const r = loadDocument(JSON.stringify(docWith((d) => d.devices!.push(dev(layerOf(d))))).replace('"x":0', '"x":1e999'));
    expect(r.ok).toBe(false);
  });
});

describe('values an export interpolates are repaired on load', () => {
  it('isSafeImageHref allows only embedded images', () => {
    expect(isSafeImageHref(PNG)).toBe(true);
    expect(isSafeImageHref('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(isSafeImageHref('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')).toBe(true);
    // Paste accepts every image/*: any embedded image subtype is safe.
    for (const sub of ['tiff', 'x-icon', 'vnd.microsoft.icon', 'heic', 'heif', 'apng', 'jxl', 'x-png', 'pjpeg', 'bmp', 'avif']) {
      expect(isSafeImageHref(`data:image/${sub};base64,AAAA`), sub).toBe(true);
    }
    for (const bad of [
      'https://evil.example/p.png?id=1',
      'http://evil.example/p.png',
      '//evil.example/p.png',
      'file:///etc/passwd',
      'blob:https://x/1',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'data:image/;base64,AAAA',
      'data:image/png',
      'data:image/p ng;base64,AAAA',
      'data:application/image/png;base64,AAAA',
      ' data:image/png;base64,AAAA',
      'p.png',
      '',
      undefined,
      42,
    ]) {
      expect(isSafeImageHref(bad), String(bad)).toBe(false);
    }
  });

  it('removes an image with a remote href, keeps an embedded one, and says so', () => {
    const r = migrateDocument(
      docWith((d) => {
        const L = layerOf(d);
        d.objects!.push(obj(L, { id: 'bad', kind: 'image', href: 'https://evil.example/p.png?u=1' }));
        d.objects!.push(obj(L, { id: 'good', kind: 'image', href: PNG, opacity: 0.4 }));
        d.objects!.push(obj(L, { id: 'tiff', kind: 'image', href: 'data:image/tiff;base64,SUkqAA==' }));
        d.objects!.push(obj(L, { id: 'blob', kind: 'image', href: 'blob:null/1234' }));
        d.objects!.push(obj(L, { id: 'rel', kind: 'image', href: 'pictures/p.png' }));
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.objects.map((o) => o.id)).toEqual(['good', 'tiff']);
    expect(JSON.stringify(r.doc)).not.toContain('evil.example');
    // "Outside address" is said only of the genuinely remote one.
    expect(r.warnings).toEqual([
      '1 image linked to an outside address was removed',
      '2 images that were not stored in the file were removed',
    ]);
    expect(loadRepairSummary(r)).toMatch(/^Opened with 3 repairs: 1 image linked/);
    // Clean documents are returned untouched and warning-free (every template).
    for (const t of TEMPLATES) {
      const built = buildTemplate(t.key, NOW);
      const clean = loadDocument(JSON.stringify(built));
      expect(clean.ok, t.key).toBe(true);
      if (!clean.ok) continue;
      expect(clean.warnings, t.key).toBeUndefined();
      expect(clean.doc, t.key).toEqual(JSON.parse(JSON.stringify(built)));
    }
  });

  it('never lets a string through a numeric field', () => {
    const evil = '1"/><script>alert(1)</script>';
    const r = migrateDocument(
      docWith((d) => {
        const L = layerOf(d);
        d.devices!.push(dev(L, { iconScale: evil, ru: evil, ruSpan: '2', z: evil, interfaces: [{ id: 'i', name: 'e0', vlan: evil }] }));
        d.devices!.push(dev(L, { id: 'd2', interfaces: evil }));
        d.links!.push({ id: 'l', kind: 'link', sourceId: 'd1', targetId: 'd2', layerId: L, width: evil, color: 7, waypoints: [{ x: evil, y: 1 }, { x: 5, y: 6 }] });
        d.objects!.push(obj(L, { id: 'img', kind: 'image', href: PNG, opacity: evil }));
        d.objects!.push(obj(L, { id: 'img2', kind: 'image', href: PNG, opacity: 7 }));
        d.objects!.push(obj(L, { id: 'img3', kind: 'image', href: PNG, opacity: '0.5' }));
        d.objects!.push(
          obj(L, { id: 't', kind: 'text', blocks: [], fontSize: evil, color: { a: 1 }, leader: { color: '#000', dash: 'solid', width: evil }, anchor: { type: 'point', x: evil, y: 0 } }),
        );
        d.objects!.push(obj(L, { id: 't2', kind: 'text', blocks: [], fontSize: 99999, leader: { color: '#000', dash: 'solid', width: 1e9 } }));
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.doc)).not.toContain('<script>');
    const [d1, d2] = r.doc.devices;
    expect(d1!.iconScale).toBeUndefined();
    expect(d1!.ru).toBeUndefined();
    expect(d1!.ruSpan).toBe(2); // a numeric string is converted, not thrown away
    expect(d1!.interfaces![0]!.vlan).toBeUndefined();
    expect(d2!.interfaces).toBeUndefined();
    const l = r.doc.links[0]!;
    expect(l.width).toBeUndefined();
    expect(l.color).toBeUndefined();
    expect(l.waypoints).toEqual([{ x: 5, y: 6 }]);
    const byId = new Map(r.doc.objects.map((o) => [o.id, o as unknown as Record<string, unknown>]));
    expect(byId.get('img')!.opacity).toBeUndefined();
    expect(byId.get('img2')!.opacity).toBe(1);
    expect(byId.get('img3')!.opacity).toBe(0.5);
    expect(byId.get('t')!.fontSize).toBeUndefined();
    expect(byId.get('t')!.color).toBeUndefined();
    expect(byId.get('t')!.leader).toBeUndefined();
    expect(byId.get('t')!.anchor).toBeNull();
    expect(r.warnings?.join('; ')).toMatch(/\d+ settings could not be read and were reset/);
    expect(r.warnings?.join('; ')).toMatch(/2 colours could not be used and were reset/);
  });

  it('font sizes reaching a renderer are always finite numbers', () => {
    expect(clampFontSize('12"/><script>')).toBe(14);
    expect(clampFontSize(NaN)).toBe(14);
    expect(clampFontSize(1e9)).toBe(10_000);
    expect(clampFontSize(-3)).toBe(0);
    expect(clampFontSize(13)).toBe(13);
    const rows = calloutRowsOrPlaceholder(
      [{ kind: 'heading', spans: [{ text: 'H' }] }, { kind: 'paragraph', spans: [{ text: 'p' }] }],
      '9"/><script>' as unknown as number,
    );
    for (const row of rows) expect(typeof row.size).toBe('number');
    const empty = calloutRowsOrPlaceholder([], 'x' as unknown as number);
    expect(empty[0]!.size).toBe(14);
  });

  it('safeColor accepts plain paints and nothing that can fetch', () => {
    for (const ok of ['#fff', '#22d3ee', '#11223344', 'red', 'none', 'transparent', 'currentColor', 'rgb(1, 2, 3)', 'rgba(0,0,0,0.5)', 'hsl(210 40% 50% / 0.5)', 'hsla(210deg, 40%, 50%, .5)', 'var(--chrome-fg)']) {
      expect(isSafeColor(ok), ok).toBe(true);
      expect(safeColor(ok, '#000')).toBe(ok);
    }
    for (const bad of ['url(https://evil.example/b)', 'URL ( //evil.example/b )', 'url(#grad)', 'red url(https://evil.example/b)', '#fff"/><script>', 'rgb(url(https://e/x))', 'var(--a, url(https://e/x))', 'expression(alert(1))', '', 7, null, undefined]) {
      expect(isSafeColor(bad), String(bad)).toBe(false);
      expect(safeColor(bad, '#123456')).toBe('#123456');
    }
  });

  it('repairs a url() colour in every colour field to its default, with a warning', () => {
    const U = 'url(https://evil.example/b)';
    const r = migrateDocument(
      docWith((d) => {
        const L = layerOf(d);
        d.devices!.push(dev(L, { fill: U }), dev(L, { id: 'd2' }));
        d.links!.push({ id: 'l', kind: 'link', sourceId: 'd1', targetId: 'd2', layerId: L, color: U });
        d.objects!.push(obj(L, { id: 's', kind: 'shape', shape: 'rect', fill: U, stroke: U }));
        d.objects!.push(obj(L, { id: 't', kind: 'text', blocks: [], color: U, leader: { color: U, dash: 'solid', width: 1 } }));
        d.vlans!.push({ id: 'v', vlanId: 10, name: 'v', color: U });
        d.rackCables!.push({ id: 'c', aEnd: { deviceId: 'd1', ifaceId: 'a' }, bEnd: { deviceId: 'd2', ifaceId: 'b' }, color: U });
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.doc)).not.toContain('evil.example');
    expect(r.doc.rackCables[0]!.color).toBe('#64748b');
    expect((r.doc.objects[1] as unknown as { leader: { color: string } }).leader.color).toBe('#2563eb');
    expect(r.warnings).toEqual(['8 colours could not be used and were reset']);
  });
});
