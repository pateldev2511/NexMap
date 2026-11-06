import { describe, expect, it } from 'vitest';
import { buildSvg } from './buildSvg';
import { localDate } from './index';
import { BLUEPRINT } from '@/canvas/blueprintArt';
import { HEALTH_AMBER, pairKey } from '@/canvas/connector';
import { createDevice, createLink, createShapeObject, createTextObject } from '@/model/schema';

const L = 'layer';

function scene() {
  const a = createDevice('router', 0, 0, L, { name: 'edge-r1' });
  const b = createDevice('switch', 240, 0, L, { name: 'core-sw1' });
  const link = createLink(a.id, b.id, L, { sourceInterface: 'ge0/1' });
  return { a, b, link };
}

describe('buildSvg — blueprint sheet', () => {
  it('draws on paper with a drafting grid, even when the export asks for transparency', () => {
    const { a, b, link } = scene();
    const svg = buildSvg([a, b], [link], {
      background: null,
      includeLabels: true,
      projection: 'blueprint',
    });
    expect(svg).toContain(`fill="${BLUEPRINT.paper}"`);
    expect(svg).toContain('fill="url(#nexmap-bp-minor)"');
    expect(svg).toContain('fill="url(#nexmap-bp-major)"');
  });

  it('traces devices in ink instead of the flat art, with lettered names', () => {
    const { a, b, link } = scene();
    const svg = buildSvg([a, b], [link], {
      background: '#fff',
      includeLabels: true,
      projection: 'blueprint',
    });
    expect(svg).toContain('data-blueprint-icon="1"');
    expect(svg).not.toContain('data-flat-icon');
    expect(svg).toContain('>EDGE-R1</text>');
    expect(svg).toContain(`fill="${BLUEPRINT.inkDim}" paint-order="stroke" stroke="${BLUEPRINT.paper}"`);
  });

  it('keeps health tints on the sheet — a hidden SPOF is worse than a plain drawing', () => {
    const { a, b, link } = scene();
    const healthy = buildSvg([a, b], [link], {
      background: null,
      includeLabels: false,
      projection: 'blueprint',
    });
    expect(healthy).toContain('stroke="#b9cfe6"');
    const risky = buildSvg([a, b], [link], {
      background: null,
      includeLabels: false,
      projection: 'blueprint',
      health: { criticalLinkPairs: [pairKey(link)], conflictLinkIds: [] },
    });
    expect(risky).toContain(`stroke="${HEALTH_AMBER}"`);
  });

  it('outlines zones and letters callouts in ink, whatever colour they carry', () => {
    const { a, b, link } = scene();
    const zone = createShapeObject(-20, -20, 300, 120, L, { fill: '#fde68a', label: 'Core' });
    const note = createTextObject(0, 160, L, {
      blocks: [{ kind: 'paragraph', spans: [{ text: 'Dual-homed' }] }],
      color: '#1c2733',
    });
    const svg = buildSvg([a, b], [link], {
      background: null,
      includeLabels: true,
      projection: 'blueprint',
      objects: [zone, note],
    });
    expect(svg).not.toContain('#fde68a');
    expect(svg).toContain('stroke-dasharray="6 3"');
    expect(svg).toContain('>CORE</text>');
    expect(svg).toContain('>Dual-homed</text>');
    expect(svg).not.toContain('fill="#1c2733"');
  });

  it('adds a title block in its own strip below the drawing', () => {
    const { a, b, link } = scene();
    const plain = buildSvg([a, b], [link], {
      background: null,
      includeLabels: true,
      projection: 'blueprint',
    });
    const titled = buildSvg([a, b], [link], {
      background: null,
      includeLabels: true,
      projection: 'blueprint',
      title: 'Branch <Office>',
      date: '2026-11-01',
    });
    expect(plain).not.toContain('data-title-block');
    expect(titled).toContain('data-title-block="1"');
    expect(titled).toContain('BRANCH &lt;OFFICE&gt;');
    expect(titled).toContain('>2026-11-01</text>');
    expect(titled).toContain('>NTS</text>');
    expect(titled).toContain('>2</text>'); // nodes
    const height = (svg: string) => Number(/height="([\d.]+)"/.exec(svg)![1]);
    expect(height(titled)).toBeGreaterThan(height(plain) + 64);
  });

  it('leaves the flat export untouched', () => {
    const { a, b, link } = scene();
    const svg = buildSvg([a, b], [link], { background: null, includeLabels: true });
    expect(svg).toContain('data-flat-icon="1"');
    expect(svg).not.toContain(BLUEPRINT.paper);
  });
});

describe('localDate', () => {
  it('letters the local calendar date, zero-padded', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
