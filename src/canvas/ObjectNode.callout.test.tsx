/**
 * Renders the REAL ObjectNode / IsoTextNode React components (not the calloutRows
 * helper in isolation) and asserts the SVG they paint. This is the actual canvas
 * render path — the guard against the "helper passes but the on-screen renderer
 * does something else" class of bug.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ObjectNode } from './ObjectNode';
import { IsoTextNode } from './IsoTextNode';
import { DEFAULT_TILE } from './iso';
import type { TextObject } from '@/model/types';

const noop = () => {};

function card(): TextObject {
  return {
    id: 't1',
    kind: 'text',
    x: 100,
    y: 100,
    width: 160,
    height: 60,
    layerId: 'L',
    fontSize: 14,
    blocks: [
      { kind: 'heading', spans: [{ text: 'Core Switch' }] },
      { kind: 'subheading', spans: [{ text: 'rack A / U40' }] },
      { kind: 'paragraph', spans: [{ text: 'up ' }, { text: 'bold', marks: ['bold'] }] },
      { kind: 'bullets', items: [[{ text: 'uplink 1' }], [{ text: 'uplink 2' }]] },
    ],
  };
}

function renderSvg(node: React.ReactElement) {
  const { container } = render(
    <svg>
      {node}
    </svg>,
  );
  return container.querySelector('svg')!;
}

describe('ObjectNode — flat callout render path', () => {
  it('paints one <text> per visual row with the legacy card sizing', () => {
    const svg = renderSvg(<ObjectNode object={card()} selected={false} onPointerDown={noop} />);
    const texts = [...svg.querySelectorAll('text')];
    // heading + subheading + paragraph + 2 bullets = 5 rows
    expect(texts).toHaveLength(5);
    expect(texts[0]!.getAttribute('font-size')).toBe(String(Math.round(14 * 1.3)));
    expect(texts[0]!.getAttribute('font-weight')).toBe('700');
    expect(texts[0]!.textContent).toBe('Core Switch');
    expect(texts[1]!.getAttribute('font-weight')).toBe('500'); // subheading
    expect(texts[4]!.textContent).toContain('uplink 2');
  });

  it('renders inline marks as styled tspans', () => {
    const svg = renderSvg(<ObjectNode object={card()} selected={false} onPointerDown={noop} />);
    const bold = [...svg.querySelectorAll('tspan')].find((t) => t.textContent === 'bold');
    expect(bold).toBeTruthy();
    expect(bold!.getAttribute('font-weight')).toBe('700');
  });

  it('falls back to a single "Text" row when the callout is empty', () => {
    const empty: TextObject = { ...card(), blocks: [{ kind: 'paragraph', spans: [] }] };
    const svg = renderSvg(<ObjectNode object={empty} selected={false} onPointerDown={noop} />);
    const texts = [...svg.querySelectorAll('text')];
    expect(texts).toHaveLength(1);
    expect(texts[0]!.textContent).toBe('Text');
  });

  it('honors center alignment via text-anchor', () => {
    const centered: TextObject = {
      ...card(),
      blocks: [{ kind: 'heading', spans: [{ text: 'Centered' }], align: 'center' }],
    };
    const svg = renderSvg(<ObjectNode object={centered} selected={false} onPointerDown={noop} />);
    const t = svg.querySelector('text')!;
    expect(t.getAttribute('text-anchor')).toBe('middle');
    expect(t.getAttribute('x')).toBe(String(100 + 160 / 2)); // box mid-x
  });
});

describe('IsoTextNode — iso callout render path', () => {
  it('stacks the same rows upright in iso (no longer a single line)', () => {
    const svg = renderSvg(
      <IsoTextNode
        object={card()}
        selected={false}
        gridSize={24}
        tile={DEFAULT_TILE}
        onPointerDown={noop}
      />,
    );
    const texts = [...svg.querySelectorAll('text')];
    expect(texts).toHaveLength(5); // was 1 before W3a — now matches flat
    expect(texts[0]!.textContent).toBe('Core Switch');
  });
});
