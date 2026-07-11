import { describe, it, expect } from 'vitest';
import {
  bodyText,
  calloutRows,
  calloutRowsOrPlaceholder,
  cloneBlocks,
  headingText,
  legacyToBlocks,
  paragraphBlocks,
  rowAnchor,
  setBody,
  setHeading,
  setSubheading,
  subheadingText,
} from './callout';
import type { CalloutBlock } from './types';

describe('legacyToBlocks', () => {
  it('orders heading, subheading, then body paragraphs', () => {
    expect(legacyToBlocks('H', 'S', 'a\nb')).toEqual([
      { kind: 'heading', spans: [{ text: 'H' }] },
      { kind: 'subheading', spans: [{ text: 'S' }] },
      { kind: 'paragraph', spans: [{ text: 'a' }] },
      { kind: 'paragraph', spans: [{ text: 'b' }] },
    ]);
  });

  it('collapses absent fields but always yields at least one block', () => {
    expect(legacyToBlocks()).toEqual([{ kind: 'paragraph', spans: [] }]);
    expect(legacyToBlocks(undefined, undefined, 'x')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'x' }] },
    ]);
  });
});

describe('plaintext accessors round-trip', () => {
  it('reads heading/subheading/body back out', () => {
    const b = legacyToBlocks('Title', 'Sub', 'body line');
    expect(headingText(b)).toBe('Title');
    expect(subheadingText(b)).toBe('Sub');
    expect(bodyText(b)).toBe('body line');
  });

  it('setHeading preserves subheading + body', () => {
    let b = legacyToBlocks('Title', 'Sub', 'body');
    b = setHeading(b, 'New');
    expect(headingText(b)).toBe('New');
    expect(subheadingText(b)).toBe('Sub');
    expect(bodyText(b)).toBe('body');
  });

  it('setBody replaces only the body, keeping heading/subheading', () => {
    let b = legacyToBlocks('Title', 'Sub', 'old');
    b = setBody(b, 'new1\nnew2');
    expect(headingText(b)).toBe('Title');
    expect(bodyText(b)).toBe('new1\nnew2');
  });

  it('clearing heading removes the heading block', () => {
    let b = legacyToBlocks('Title', '', 'body');
    b = setHeading(b, '');
    expect(headingText(b)).toBe('');
    expect(b.some((x) => x.kind === 'heading')).toBe(false);
  });

  it('setSubheading on a body-only note inserts it before the body', () => {
    let b = paragraphBlocks('body');
    b = setSubheading(b, 'Sub');
    expect(b[0]).toEqual({ kind: 'subheading', spans: [{ text: 'Sub' }] });
    expect(bodyText(b)).toBe('body');
  });
});

describe('calloutRows — layout parity with the old annotation card', () => {
  it('sizes heading/subheading/body like the legacy renderer', () => {
    const rows = calloutRows(legacyToBlocks('H', 'S', 'B'), 14);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ size: Math.round(14 * 1.3), weight: 700 });
    expect(rows[1]).toMatchObject({ size: Math.round(14 * 0.95), weight: 500, muted: true });
    expect(rows[2]).toMatchObject({ size: 14, weight: 400 });
    expect(rows[2]!.runs.map((r) => r.text).join('')).toBe('B');
  });

  it('empty spans collapse to no rows', () => {
    expect(calloutRows([{ kind: 'paragraph', spans: [] }], 14)).toEqual([]);
  });

  it('placeholder yields a single "Text" row when fully empty', () => {
    const rows = calloutRowsOrPlaceholder([{ kind: 'paragraph', spans: [] }], 14);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.runs[0]!.text).toBe('Text');
  });

  it('marks flow through to styled runs', () => {
    const blocks: CalloutBlock[] = [
      { kind: 'paragraph', spans: [{ text: 'a', marks: ['bold'] }, { text: 'b', marks: ['italic'] }] },
    ];
    const [row] = calloutRows(blocks, 14);
    expect(row!.runs[0]).toMatchObject({ text: 'a', bold: true });
    expect(row!.runs[1]).toMatchObject({ text: 'b', italic: true });
  });

  it('bullets get markers, numbers get ordinals', () => {
    const bl: CalloutBlock[] = [{ kind: 'bullets', items: [[{ text: 'x' }], [{ text: 'y' }]] }];
    expect(calloutRows(bl, 14).map((r) => r.runs[0]!.text)).toEqual(['• ', '• ']);
    const nb: CalloutBlock[] = [{ kind: 'numbers', items: [[{ text: 'x' }], [{ text: 'y' }]] }];
    expect(calloutRows(nb, 14).map((r) => r.runs[0]!.text)).toEqual(['1. ', '2. ']);
  });

  it('code block splits on newlines and marks the row monospace', () => {
    const rows = calloutRows([{ kind: 'code', text: 'l1\nl2' }], 14);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.mono)).toBe(true);
  });
});

describe('rowAnchor', () => {
  it('left pads from the box start', () => {
    expect(rowAnchor(undefined, 100, 160, 4)).toEqual({ x: 104, anchor: 'start' });
  });
  it('center anchors at the box midpoint', () => {
    expect(rowAnchor('center', 100, 160, 4)).toEqual({ x: 180, anchor: 'middle' });
  });
  it('right anchors at the box end minus pad', () => {
    expect(rowAnchor('right', 100, 160, 4)).toEqual({ x: 256, anchor: 'end' });
  });
});

describe('cloneBlocks', () => {
  it('deep-copies so mutations do not alias the source', () => {
    const src = legacyToBlocks('H', undefined, 'body');
    const copy = cloneBlocks(src);
    (copy[0] as { spans: { text: string }[] }).spans[0]!.text = 'CHANGED';
    expect(headingText(src)).toBe('H');
  });
});
