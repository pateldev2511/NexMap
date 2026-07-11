import { describe, it, expect } from 'vitest';
import {
  bodyKind,
  bodyText,
  calloutAlign,
  calloutRows,
  calloutRowsOrPlaceholder,
  cloneBlocks,
  hasMark,
  headingText,
  legacyToBlocks,
  paragraphBlocks,
  rowAnchor,
  setBody,
  setBodyKind,
  setCalloutAlign,
  setHeading,
  setSubheading,
  subheadingText,
  toggleMark,
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

describe('toolbar formatting helpers', () => {
  it('toggleMark adds bold to all body spans, then removes it', () => {
    let b = legacyToBlocks('H', undefined, 'a\nb');
    expect(hasMark(b, 'bold')).toBe(false);
    b = toggleMark(b, 'bold');
    expect(hasMark(b, 'bold')).toBe(true);
    // heading span also gets the mark (heading is markable)
    expect((b[0] as { spans: { marks?: string[] }[] }).spans[0]!.marks).toContain('bold');
    b = toggleMark(b, 'bold');
    expect(hasMark(b, 'bold')).toBe(false);
  });

  it('toggleMark never marks empty spans', () => {
    const b = toggleMark([{ kind: 'paragraph', spans: [] }], 'italic');
    expect(hasMark(b, 'italic')).toBe(false);
  });

  it('setCalloutAlign sets align on every non-code block; calloutAlign reads it back', () => {
    const b = setCalloutAlign(legacyToBlocks('H', 'S', 'body'), 'center');
    expect(calloutAlign(b)).toBe('center');
  });

  it('calloutAlign returns undefined when blocks disagree', () => {
    const b = legacyToBlocks(undefined, undefined, 'a\nb');
    (b[0] as { align?: string }).align = 'left';
    (b[1] as { align?: string }).align = 'right';
    expect(calloutAlign(b)).toBeUndefined();
  });

  it('setBodyKind converts body paragraphs to a bullet list, keeping the heading', () => {
    const b = setBodyKind(legacyToBlocks('Title', undefined, 'one\ntwo'), 'bullets');
    expect(b[0]!.kind).toBe('heading');
    expect(b[1]!.kind).toBe('bullets');
    expect((b[1] as { items: unknown[] }).items).toHaveLength(2);
    expect(bodyKind(b)).toBe('bullets');
  });

  it('setBodyKind to code joins the lines and drops marks', () => {
    let b = legacyToBlocks(undefined, undefined, 'x\ny');
    b = toggleMark(b, 'bold');
    b = setBodyKind(b, 'code');
    expect(b).toEqual([{ kind: 'code', text: 'x\ny' }]);
    expect(bodyKind(b)).toBe('code');
  });

  it('setBodyKind round-trips list → paragraph', () => {
    let b = setBodyKind(legacyToBlocks(undefined, undefined, 'a\nb'), 'numbers');
    b = setBodyKind(b, 'paragraph');
    expect(b.every((x) => x.kind === 'paragraph')).toBe(true);
    expect(bodyText(b)).toBe('a\nb');
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
