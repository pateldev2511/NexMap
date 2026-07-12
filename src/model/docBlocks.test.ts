import { describe, it, expect } from 'vitest';
import { titleBlockBlocks, legendEntries, legendBlocks } from './docBlocks';
import { calloutPlainText, spanText } from './callout';

describe('titleBlockBlocks', () => {
  it('leads with the project name and includes rack, date, devices, rev', () => {
    const b = titleBlockBlocks({
      projectName: 'HQ Core',
      rackName: 'MDF-1',
      date: '2026-07-10',
      deviceCount: 12,
    });
    expect(b[0]).toEqual({ kind: 'heading', spans: [{ text: 'HQ Core' }] });
    expect(b[1]).toEqual({ kind: 'subheading', spans: [{ text: 'MDF-1' }] });
    const text = calloutPlainText(b);
    expect(text).toContain('Date: 2026-07-10');
    expect(text).toContain('Devices: 12');
    expect(text).toContain('Rev: A');
  });

  it('falls back to Untitled and omits the rack line when absent', () => {
    const b = titleBlockBlocks({ projectName: '', date: '2026-01-01' });
    expect(b[0]).toEqual({ kind: 'heading', spans: [{ text: 'Untitled' }] });
    expect(b.some((x) => x.kind === 'subheading')).toBe(false);
  });
});

describe('legendEntries', () => {
  it('collapses to distinct colors and joins their labels, sorted by color', () => {
    const entries = legendEntries([
      { color: '#ff0000', label: 'power' },
      { color: '#00ff00', label: 'uplink' },
      { color: '#00ff00', label: 'trunk' },
      { color: '#ff0000' }, // unlabeled
    ]);
    expect(entries).toEqual([
      { color: '#00ff00', label: 'uplink, trunk' },
      { color: '#ff0000', label: 'power, (unlabeled)' },
    ]);
  });
});

describe('legendBlocks', () => {
  it('makes a heading + one bullet per color, with the hex as code', () => {
    const b = legendBlocks([{ color: '#22d3ee', label: 'uplink' }]);
    expect(b[0]).toEqual({ kind: 'heading', spans: [{ text: 'Legend' }] });
    expect(b[1]!.kind).toBe('bullets');
    if (b[1]!.kind === 'bullets') {
      expect(spanText(b[1]!.items[0]!)).toBe('#22d3ee uplink');
      expect(b[1]!.items[0]![0]!.marks).toEqual(['code']);
    }
  });

  it('handles no cables gracefully', () => {
    const b = legendBlocks([]);
    expect(calloutPlainText(b)).toContain('No cables to describe');
  });
});
