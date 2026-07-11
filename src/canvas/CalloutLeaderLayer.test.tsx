import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CalloutLeaderLayer } from './CalloutLeaderLayer';
import type { TextObject } from '@/model/types';

function callout(partial: Partial<TextObject>): TextObject {
  return {
    id: 'c1',
    kind: 'text',
    x: 0,
    y: 100,
    width: 160,
    height: 40,
    layerId: 'L',
    blocks: [{ kind: 'paragraph', spans: [{ text: 'x' }] }],
    ...partial,
  };
}

const withSvg = (node: React.ReactElement) => {
  const { container } = render(<svg>{node}</svg>);
  return container.querySelector('svg')!;
};

describe('CalloutLeaderLayer', () => {
  const lookup = (id: string) =>
    id === 'dev' ? { x: 400, y: 100, width: 40, height: 40 } : null;

  it('draws a leader for an anchored callout with a resolvable target', () => {
    const svg = withSvg(
      <CalloutLeaderLayer
        texts={[callout({ anchor: { type: 'device', id: 'dev' } })]}
        lookup={lookup}
        scale={1}
      />,
    );
    const line = svg.querySelector('line[data-leader-for="c1"]')!;
    expect(line).toBeTruthy();
    expect(Number(line.getAttribute('x1'))).toBeCloseTo(160, 1); // right edge of the box
  });

  it('draws nothing for a free note (no anchor)', () => {
    const svg = withSvg(
      <CalloutLeaderLayer texts={[callout({ anchor: null })]} lookup={lookup} scale={1} />,
    );
    expect(svg.querySelector('line')).toBeNull();
  });

  it('draws nothing when the anchor target is gone (lazy)', () => {
    const svg = withSvg(
      <CalloutLeaderLayer
        texts={[callout({ anchor: { type: 'device', id: 'missing' } })]}
        lookup={lookup}
        scale={1}
      />,
    );
    expect(svg.querySelector('line')).toBeNull();
  });

  it('divides the dash pattern by scale so it stays visually constant', () => {
    const svg = withSvg(
      <CalloutLeaderLayer
        texts={[callout({ anchor: { type: 'device', id: 'dev' }, leader: { color: '#000', dash: 'dashed', width: 2 } })]}
        lookup={lookup}
        scale={2}
      />,
    );
    const line = svg.querySelector('line')!;
    // dashed at width 2 → "8 6"; at scale 2 → "4 3"
    expect(line.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(line.getAttribute('stroke-width')).toBe('1'); // 2 / scale
  });
});
