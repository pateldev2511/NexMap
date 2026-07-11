import { describe, it, expect } from 'vitest';
import { buildSvg, escapeXml } from './buildSvg';
import { csvCell, exportInventoryCsv, exportLinksCsv } from './csvExport';
import { createDevice, createLink, createTextObject } from '@/model/schema';
import type { CanvasObject } from '@/model/types';

const L = 'layer';

describe('buildSvg — link direction arrows (W1b, canvas parity)', () => {
  it('emits the arrow marker def and defaults a link to an end arrow', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1' });
    const b = createDevice('switch', 200, 0, L, { name: 'SW1' });
    const link = createLink(a.id, b.id, L); // no arrow field → canvas default 'end'
    const svg = buildSvg([a, b], [link], { background: '#fff', includeLabels: true });
    expect(svg).toContain('<marker id="nexmap-arrow"');
    expect(svg).toContain('fill="#6b7785"'); // literal, not a CSS var
    expect(svg).toContain('marker-end="url(#nexmap-arrow)"');
    expect(svg).not.toContain('marker-start=');
  });

  it("arrow: 'both' emits start AND end markers", () => {
    const a = createDevice('router', 0, 0, L);
    const b = createDevice('switch', 200, 0, L);
    const link = createLink(a.id, b.id, L, { arrow: 'both' });
    const svg = buildSvg([a, b], [link], { background: '#fff', includeLabels: true });
    expect(svg).toContain('marker-end="url(#nexmap-arrow)"');
    expect(svg).toContain('marker-start="url(#nexmap-arrow)"');
  });

  it("arrow: 'none' emits no markers on the link", () => {
    const a = createDevice('router', 0, 0, L);
    const b = createDevice('switch', 200, 0, L);
    const link = createLink(a.id, b.id, L, { arrow: 'none' });
    const svg = buildSvg([a, b], [link], { background: '#fff', includeLabels: true });
    // The def still exists (cheap, shared), but this link references no marker.
    const linkPath = svg.slice(svg.indexOf(`data-id="${link.id}"`));
    expect(linkPath.slice(0, linkPath.indexOf('/>'))).not.toContain('marker-');
  });

  it('iso export carries arrows too (separate builder path)', () => {
    const a = createDevice('router', 0, 0, L);
    const b = createDevice('switch', 200, 0, L);
    const link = createLink(a.id, b.id, L);
    const svg = buildSvg([a, b], [link], {
      background: '#fff',
      includeLabels: true,
      projection: 'iso',
    });
    expect(svg).toContain('<marker id="nexmap-arrow"');
    expect(svg).toContain('marker-end="url(#nexmap-arrow)"');
  });
});

describe('buildSvg — connectors + annotation cards', () => {
  it('applies manual link color and width in the export', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1' });
    const b = createDevice('switch', 200, 0, L, { name: 'SW1' });
    const link = createLink(a.id, b.id, L, { color: '#ff0000', width: 4 });
    const svg = buildSvg([a, b], [link], { background: '#fff', includeLabels: true });
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke-width="4"');
  });

  it('uses the manual link.width for stroke-width', () => {
    const a = createDevice('router', 0, 0, L);
    const b = createDevice('switch', 200, 0, L);
    const link = createLink(a.id, b.id, L, { width: 5 });
    const svg = buildSvg([a, b], [link], { background: '#fff', includeLabels: true });
    expect(svg).toContain('stroke-width="5"');
  });

  it('tints a critical (bridge) link amber when a health report is passed', () => {
    const a = createDevice('router', 0, 0, L);
    const b = createDevice('switch', 200, 0, L);
    const link = createLink(a.id, b.id, L);
    const pair = [a.id, b.id].sort().join('|');
    const health = { criticalLinkPairs: [pair], conflictLinkIds: [] };
    const tinted = buildSvg([a, b], [link], { background: '#fff', includeLabels: true, health });
    expect(tinted).toContain('#d97706'); // amber
    const plain = buildSvg([a, b], [link], { background: '#fff', includeLabels: true, health: null });
    expect(plain).not.toContain('#d97706');
  });

  it('renders a stacked annotation card and escapes heading/subheading', () => {
    const card = createTextObject(10, 10, L, {
      blocks: [
        { kind: 'heading', spans: [{ text: '<b>Core</b>' }] },
        { kind: 'subheading', spans: [{ text: 'site A' }] },
        { kind: 'paragraph', spans: [{ text: 'rack 1' }] },
      ],
    }) as CanvasObject;
    const svg = buildSvg([], [], { background: '#fff', includeLabels: true, objects: [card] });
    expect(svg).toContain('&lt;b&gt;Core&lt;/b&gt;'); // escaped, not raw markup
    expect(svg).not.toContain('<b>Core</b>');
    expect(svg).toContain('site A');
    expect(svg).toContain('rack 1');
    expect(svg).toContain('font-weight="700"'); // heading styled bold
  });
});

describe('buildSvg — projection icons', () => {
  it('flat export uses the flat device-model art, not the 3D iso model', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1' });
    const svg = buildSvg([a], [], { background: '#fff', includeLabels: true });
    expect(svg).toContain('data-flat-icon');
  });

  it('flat export scales the icon by device.iconScale', () => {
    const base = createDevice('router', 0, 0, L);
    const big = createDevice('router', 0, 0, L, { iconScale: 2 });
    const svgBase = buildSvg([base], [], { background: '#fff', includeLabels: false });
    const svgBig = buildSvg([big], [], { background: '#fff', includeLabels: false });
    // The flat art is wrapped in a scale() transform driven by icon size.
    const scale = (s: string) =>
      Number(/data-flat-icon="1" transform="translate\([^)]*\) scale\(([\d.]+)\)"/.exec(s)?.[1]);
    expect(scale(svgBig)).toBeGreaterThan(scale(svgBase));
  });

  it('iso export keeps the 3D model (no flat-icon marker)', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1' });
    const svg = buildSvg([a], [], { background: '#fff', includeLabels: true, projection: 'iso' });
    expect(svg).not.toContain('data-flat-icon');
  });
});

describe('buildSvg', () => {
  it('emits a sized SVG with devices and links', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1' });
    const b = createDevice('switch', 200, 0, L, { name: 'SW1' });
    const link = createLink(a.id, b.id, L);
    const svg = buildSvg([a, b], [link], { background: '#fff', includeLabels: true });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
    expect(svg).toContain(`data-id="${a.id}"`); // IDs preserved for round-trip
    expect(svg).toContain('R1');
    // Phase 9.7: devices render a pictographic icon group, not a letter glyph.
    expect(svg).toContain('stroke-linecap="round"');
  });

  it('omits labels when includeLabels is false', () => {
    const a = createDevice('router', 0, 0, L, { name: 'SecretName' });
    const svg = buildSvg([a], [], { background: null, includeLabels: false });
    expect(svg).not.toContain('SecretName');
  });

  it('carries no script or external reference by construction', () => {
    const a = createDevice('router', 0, 0, L, { name: '<script>alert(1)</script>' });
    const svg = buildSvg([a], [], { background: '#fff', includeLabels: true });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;'); // escaped
    expect(svg).not.toMatch(/href|xlink/);
  });

  it('escapeXml handles all entities', () => {
    expect(escapeXml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  });

  it('renders an isometric projection when requested (Phase 9.6)', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1' });
    const b = createDevice('switch', 200, 0, L, { name: 'SW1' });
    const link = createLink(a.id, b.id, L);
    const flat = buildSvg([a, b], [link], { background: '#fff', includeLabels: true });
    const isoSvg = buildSvg([a, b], [link], {
      background: '#fff',
      includeLabels: true,
      projection: 'iso',
    });
    expect(isoSvg.startsWith('<svg')).toBe(true);
    // Floor layer is sheared by the iso matrix; devices render as isometric 3D solids.
    expect(isoSvg).toContain('matrix(');
    expect(isoSvg).toContain('<polygon'); // iso device faces
    expect(isoSvg).toContain('R1'); // labels still present
    // The iso projection changes geometry, so the output differs from flat.
    expect(isoSvg).not.toBe(flat);
  });
});

describe('csvCell — formula-injection guard', () => {
  it('neutralizes formula triggers', () => {
    expect(csvCell('=cmd()')).toBe("'=cmd()");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@x')).toBe("'@x");
  });
  it('quotes cells with commas/quotes/newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('leaves plain values alone', () => {
    expect(csvCell('Router')).toBe('Router');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('CSV export', () => {
  it('exports inventory with header + rows', () => {
    const a = createDevice('router', 0, 0, L, {
      name: 'R1',
      managementIp: '10.0.0.1/24',
      vendor: 'Acme',
    });
    const csv = exportInventoryCsv([a]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('name,type,vendor,model,role,location,management_ip,notes');
    expect(lines[1]).toContain('R1');
    expect(lines[1]).toContain('10.0.0.1'); // prefix stripped
    expect(lines[1]).toContain('Acme');
  });

  it('exports links by device name', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1' });
    const b = createDevice('switch', 0, 0, L, { name: 'SW1' });
    const link = createLink(a.id, b.id, L, { bandwidth: '1G' });
    const csv = exportLinksCsv([link], [a, b]);
    expect(csv.split('\r\n')[1]).toContain('R1');
    expect(csv).toContain('SW1');
    expect(csv).toContain('1G');
  });

  it('neutralizes a malicious device name on export', () => {
    const evil = createDevice('router', 0, 0, L, { name: '=HYPERLINK("http://evil")' });
    const csv = exportInventoryCsv([evil]);
    expect(csv).toContain("'=HYPERLINK");
  });
});
