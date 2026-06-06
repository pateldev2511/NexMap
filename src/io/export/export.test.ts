import { describe, it, expect } from 'vitest';
import { buildSvg, escapeXml } from './buildSvg';
import { csvCell, exportInventoryCsv, exportLinksCsv } from './csvExport';
import { createDevice, createLink, createTextObject } from '@/model/schema';
import type { CanvasObject } from '@/model/types';

const L = 'layer';

describe('buildSvg — connectors + annotation cards', () => {
  it('applies manual link color and width in the export', () => {
    const a = createDevice('router', 0, 0, L, { name: 'R1' });
    const b = createDevice('switch', 200, 0, L, { name: 'SW1' });
    const link = createLink(a.id, b.id, L, { color: '#ff0000', width: 4 });
    const svg = buildSvg([a, b], [link], { background: '#fff', includeLabels: true });
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke-width="4"');
  });

  it('derives width from bandwidth when no override', () => {
    const a = createDevice('router', 0, 0, L);
    const b = createDevice('switch', 200, 0, L);
    const link = createLink(a.id, b.id, L, { bandwidth: '100G' });
    const svg = buildSvg([a, b], [link], { background: '#fff', includeLabels: true });
    expect(svg).not.toContain('stroke-width="1.5"'); // thicker than default
  });

  it('renders a stacked annotation card and escapes heading/subheading', () => {
    const card = createTextObject(10, 10, L, {
      heading: '<b>Core</b>',
      subheading: 'site A',
      text: 'rack 1',
    }) as CanvasObject;
    const svg = buildSvg([], [], { background: '#fff', includeLabels: true, objects: [card] });
    expect(svg).toContain('&lt;b&gt;Core&lt;/b&gt;'); // escaped, not raw markup
    expect(svg).not.toContain('<b>Core</b>');
    expect(svg).toContain('site A');
    expect(svg).toContain('rack 1');
    expect(svg).toContain('font-weight="700"'); // heading styled bold
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
