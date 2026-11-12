/**
 * "Hostile document": a crafted .nexmap must not turn an EXPORT into something
 * that phones home or runs script when its recipient opens it. Driven through the
 * public load path, then every SVG projection and the standalone HTML.
 */
import { describe, it, expect } from 'vitest';
import { loadDocument } from '@/model/migrate';
import { createEmptyDocument } from '@/model/schema';
import type { CanvasObject, Device, Link, NexMapDocument, TextObject } from '@/model/types';
import { buildConnectionsTableSvg, buildRackSvg, cableScheduleRows } from '@/rack/buildRackSvg';
import { buildSvg, svgNum } from './buildSvg';
import { buildStandaloneHtml, VIEWER_SCRIPT } from './html';

const NOW = '2026-01-01T00:00:00.000Z';
const EVIL = '1"/><script>alert(document.domain)</script><image href="https://evil.example/x.png';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
/** A paint server on someone else's machine: fetched by whoever opens the export. */
const PAINT = 'url(https://evil.example/beacon.svg#p)';

/** Every way a string may sit where the model expects a number, plus a remote image. */
function hostileParts(L: string) {
  return {
    devices: [
      { id: 'a', kind: 'device', type: 'router', name: 'A', x: 0, y: 0, width: 56, height: 40, layerId: L, iconScale: EVIL },
      { id: 'b', kind: 'device', type: 'switch', name: 'B', x: 300, y: 0, width: 56, height: 40, layerId: L },
    ],
    links: [
      { id: 'l', kind: 'link', sourceId: 'a', targetId: 'b', layerId: L, width: EVIL, waypoints: [{ x: EVIL, y: 5 }], sourceInterface: 'e0', color: PAINT },
    ],
    objects: [
      { id: 'remote', kind: 'image', x: 0, y: 0, width: 10, height: 10, layerId: L, href: 'https://evil.example/pixel.png?who=victim' },
      { id: 'proto', kind: 'image', x: 0, y: 0, width: 10, height: 10, layerId: L, href: '//evil.example/pixel.png' },
      { id: 'img', kind: 'image', x: 0, y: 0, width: 10, height: 10, layerId: L, href: PNG, opacity: EVIL },
      { id: 'txt', kind: 'text', x: 10, y: 10, width: 200, height: 40, layerId: L, fontSize: EVIL,
        blocks: [{ kind: 'heading', spans: [{ text: 'Title' }] }, { kind: 'paragraph', spans: [{ text: 'body' }] }],
        anchor: { type: 'point', x: EVIL, y: 0 }, leader: { color: '#000', dash: 'dashed', width: EVIL } },
      { id: 'txt2', kind: 'text', x: 10, y: 80, width: 200, height: 40, layerId: L, color: PAINT,
        blocks: [{ kind: 'paragraph', spans: [{ text: 'painted' }] }],
        anchor: { type: 'device', id: 'b' }, leader: { color: PAINT, dash: 'dashed', width: 2 } },
      { id: 'zone', kind: 'shape', shape: 'rect', x: 0, y: 0, width: 400, height: 200, layerId: L, label: 'Zone', fill: PAINT, stroke: PAINT },
      { id: 'oval', kind: 'shape', shape: 'ellipse', x: 0, y: 0, width: 40, height: 20, layerId: L, label: 'Oval', fill: PAINT, stroke: PAINT },
    ],
  };
}

function expectInert(full: string, what: string) {
  // The HTML export carries exactly one script — its own viewer, pinned by hash
  // in the CSP. Set that aside; nothing else may be a script.
  const markup = full.replace(`<script>${VIEWER_SCRIPT}</script>`, '');
  if (full.startsWith('<!doctype html')) {
    expect(markup.length, what).toBeLessThan(full.length);
    expect(full, what).not.toContain("script-src 'unsafe-inline'");
  }
  // No script, no handler, nothing that resolves to the network. The only URLs
  // allowed are the fixed XML namespace identifiers, which are never fetched.
  expect(markup, what).not.toMatch(/<script/i);
  expect(markup, what).not.toContain('evil.example');
  // No paint, filter or anything else resolves outside the document.
  for (const m of markup.matchAll(/url\(\s*([^)]*)\)/gi)) {
    expect(m[1]!.trim().startsWith('#'), `${what}: ${m[0]}`).toBe(true);
  }
  const urls = markup.match(/(?:https?:)?\/\/[^\s"'<>)]+/g) ?? [];
  const allowed = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);
  expect(urls.filter((u) => !allowed.has(u)), what).toEqual([]);
  // Every href in the output is embedded or a same-document fragment.
  for (const m of markup.matchAll(/\bhref="([^"]*)"/g)) {
    expect(m[1]!.startsWith('data:image/') || m[1]!.startsWith('#'), `${what}: href ${m[1]!.slice(0, 40)}`).toBe(true);
  }
}

const PROJECTIONS = ['flat', 'iso', 'blueprint'] as const;

function exportAll(devices: Device[], links: Link[], objects: CanvasObject[]) {
  const out: [string, string][] = [];
  for (const projection of PROJECTIONS) {
    for (const modern of [false, true]) {
      const svg = buildSvg(devices, links, {
        background: '#ffffff', includeLabels: true, objects, projection, modern, title: 'T', date: '2026-01-01',
      });
      out.push([`${projection}${modern ? '+modern' : ''} svg`, svg]);
      out.push([
        `${projection}${modern ? '+modern' : ''} html`,
        buildStandaloneHtml(svg, { projectName: 'Hostile', deviceCount: devices.length, linkCount: links.length }),
      ]);
    }
  }
  return out;
}

describe('hostile document', () => {
  it('is sanitised on load, and its exports neither phone home nor carry script', () => {
    const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown>;
    const L = (doc.layers as { id: string }[])[0]!.id;
    Object.assign(doc, hostileParts(L));

    const r = loadDocument(JSON.stringify(doc));
    // The load either refuses the file or hands back a repaired document.
    if (!r.ok) {
      expect(['invalid', 'corrupt']).toContain(r.reason);
      return;
    }
    const loaded: NexMapDocument = r.doc;
    expect(JSON.stringify(loaded)).not.toContain('evil.example');
    expect(JSON.stringify(loaded)).not.toContain('<script');
    expect(loaded.objects.map((o) => o.id).sort()).toEqual(['img', 'oval', 'txt', 'txt2', 'zone']);
    expect(r.warnings?.length).toBeGreaterThan(0);

    const outputs = exportAll(loaded.devices, loaded.links, loaded.objects);
    expect(outputs).toHaveLength(12);
    for (const [what, markup] of outputs) expectInert(markup, what);
    // The embedded image and the callout are still there: sanitised, not emptied.
    const flat = outputs[0]![1];
    expect(flat).toContain(`href="${PNG}"`);
    expect(flat).toContain('opacity="1"');
    expect(flat).toContain('>Title<');
    expect(outputs[1]![1].match(/<script/g)).toHaveLength(1);
  });

  it('a giant box in the same file is limited (not a reason to refuse), promptly', () => {
    const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown>;
    const L = (doc.layers as { id: string }[])[0]!.id;
    const parts = hostileParts(L);
    (parts.objects as unknown[]).push({ id: 'giant', kind: 'shape', shape: 'rect', x: 0, y: 0, width: 1e9, height: 1e9, layerId: L, label: 'big' });
    Object.assign(doc, parts);
    const t0 = performance.now();
    const r = loadDocument(JSON.stringify(doc));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const giant = r.doc.objects.find((o) => o.id === 'giant')!;
    expect([giant.width, giant.height]).toEqual([1e7, 1e7]);
    expect(r.warnings).toContain('2 positions or sizes were out of range and were limited');
  });

  it('the exporters hold on their own when handed the raw hostile model (defence in depth)', () => {
    const parts = hostileParts('L') as unknown as { devices: Device[]; links: Link[]; objects: CanvasObject[] };
    for (const [what, markup] of exportAll(parts.devices, parts.links, parts.objects)) {
      expectInert(markup, `raw ${what}`);
      expect(markup, what).not.toContain('alert(');
    }
    // The rack elevation draws rack-scoped callouts with the same raw fields.
    const callouts = [parts.objects[3], parts.objects[4]].map((o) => ({ ...(o as TextObject), rackScope: 'r1', anchor: { type: 'point' as const, x: 5, y: 5 } }));
    const sw = (id: string, ru: number): Device => ({
      id, kind: 'device', type: 'switch', name: id, x: 0, y: 0, width: 56, height: 40, layerId: 'L',
      rackId: 'r1', ru, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full', interfaces: [{ id: 'p1', name: 'p1' }],
    });
    const cables = [{ id: 'c', aEnd: { deviceId: 's1', ifaceId: 'p1' }, bEnd: { deviceId: 's2', ifaceId: 'p1' }, color: PAINT, label: 'x' }];
    const rackSvg = buildRackSvg({ id: 'r1', name: 'R', ruHeight: 12 }, [sw('s1', 10), sw('s2', 8)], cables, { background: '#fff', callouts });
    expectInert(rackSvg, 'rack svg');
    expect(rackSvg).not.toContain('alert(');
    expect(rackSvg).toContain('data-callout-id="txt"');
    expect(rackSvg).toContain('data-leader-for="txt2"');
    const table = buildConnectionsTableSvg(cableScheduleRows([sw('s1', 10), sw('s2', 8)], cables));
    expectInert(table, 'connections table');
    expect(table).toContain('s1:p1');
  });

  it('svgNum only ever yields a finite number', () => {
    expect(svgNum(EVIL, 1)).toBe(1);
    expect(svgNum(NaN, 2)).toBe(2);
    expect(svgNum(Infinity, 3)).toBe(3);
    expect(svgNum(5, 1, 0, 1)).toBe(1);
    expect(svgNum(0.25, 1, 0, 1)).toBe(0.25);
  });
});
