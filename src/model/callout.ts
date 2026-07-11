/**
 * Callout content helpers (schema v4). One place owns how a TextObject's blocks
 * turn into laid-out rows, so the live canvas (ObjectNode / IsoTextNode) and SVG
 * export (buildSvg) render from the SAME function and can never drift. Also holds
 * the plaintext accessors the pre-rich editors use and the legacy → blocks
 * conversion shared by the migration and any code that reads old-shaped data.
 */
import type {
  BlockAlign,
  CalloutBlock,
  RichMark,
  RichSpan,
  TextObject,
} from './types';

// ---------------------------------------------------------------------------
// Plaintext
// ---------------------------------------------------------------------------

/** Concatenated text of a span run (marks dropped). */
export function spanText(spans: RichSpan[]): string {
  return spans.map((s) => s.text).join('');
}

/** Plaintext of one block; list items and code lines join with newlines. */
export function blockPlainText(block: CalloutBlock): string {
  switch (block.kind) {
    case 'code':
      return block.text;
    case 'bullets':
    case 'numbers':
      return block.items.map(spanText).join('\n');
    default:
      return spanText(block.spans);
  }
}

/** Whole-callout plaintext, one block per newline-joined chunk. */
export function calloutPlainText(blocks: CalloutBlock[]): string {
  return blocks.map(blockPlainText).join('\n');
}

// ---------------------------------------------------------------------------
// Legacy conversion (v3 flat fields → v4 blocks)
// ---------------------------------------------------------------------------

/**
 * Build canonical blocks from the old flat shape. Order is
 * [heading?, subheading?, ...body-paragraphs]. Empty inputs collapse; the result
 * always has at least one (possibly empty) paragraph so the object stays editable.
 */
export function legacyToBlocks(
  heading?: string,
  subheading?: string,
  text?: string,
): CalloutBlock[] {
  const blocks: CalloutBlock[] = [];
  if (heading) blocks.push({ kind: 'heading', spans: [{ text: heading }] });
  if (subheading) blocks.push({ kind: 'subheading', spans: [{ text: subheading }] });
  const body = text ?? '';
  if (body) {
    for (const line of body.split('\n')) {
      blocks.push({ kind: 'paragraph', spans: line ? [{ text: line }] : [] });
    }
  }
  if (blocks.length === 0) blocks.push({ kind: 'paragraph', spans: [] });
  return blocks;
}

// ---------------------------------------------------------------------------
// Pre-rich editor accessors (Inspector's 3 fields + inline body editor)
//
// These preserve the current heading / subheading / body editing UX while the
// underlying model is blocks. The full rich editor (toolbar, per-span marks)
// arrives in a later milestone and replaces these.
// ---------------------------------------------------------------------------

function firstOfKind(blocks: CalloutBlock[], kind: 'heading' | 'subheading') {
  return blocks.find((b) => b.kind === kind);
}

export function headingText(blocks: CalloutBlock[]): string {
  const b = firstOfKind(blocks, 'heading');
  return b && b.kind === 'heading' ? spanText(b.spans) : '';
}

export function subheadingText(blocks: CalloutBlock[]): string {
  const b = firstOfKind(blocks, 'subheading');
  return b && b.kind === 'subheading' ? spanText(b.spans) : '';
}

/** Everything that is not the heading/subheading, as newline-joined plaintext. */
export function bodyText(blocks: CalloutBlock[]): string {
  return blocks
    .filter((b) => b.kind !== 'heading' && b.kind !== 'subheading')
    .map(blockPlainText)
    .join('\n');
}

/** Rebuild blocks in canonical order from the three plaintext fields. */
function rebuild(heading: string, subheading: string, body: string): CalloutBlock[] {
  return legacyToBlocks(heading || undefined, subheading || undefined, body || undefined);
}

export function setHeading(blocks: CalloutBlock[], value: string): CalloutBlock[] {
  return rebuild(value, subheadingText(blocks), bodyText(blocks));
}

export function setSubheading(blocks: CalloutBlock[], value: string): CalloutBlock[] {
  return rebuild(headingText(blocks), value, bodyText(blocks));
}

export function setBody(blocks: CalloutBlock[], value: string): CalloutBlock[] {
  return rebuild(headingText(blocks), subheadingText(blocks), value);
}

// ---------------------------------------------------------------------------
// Layout — the single render source of truth
// ---------------------------------------------------------------------------

/** A styled run within a laid-out row. */
export interface CalloutRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
}

/** One laid-out visual line of a callout. */
export interface CalloutRow {
  runs: CalloutRun[];
  /** Font size in px. */
  size: number;
  /** Base font weight for the row. */
  weight: number;
  /** Whole-row monospace (code block). */
  mono?: boolean;
  /** Rendered in the muted/secondary color (subheading). */
  muted?: boolean;
  align?: BlockAlign;
}

function runsOf(spans: RichSpan[]): CalloutRun[] {
  return spans.map((s) => ({
    text: s.text,
    bold: s.marks?.includes('bold') || undefined,
    italic: s.marks?.includes('italic') || undefined,
    mono: s.marks?.includes('code') || undefined,
  }));
}

/**
 * Flatten blocks into visual rows. Sizing mirrors the original annotation card:
 * heading = round(fs*1.3) @700, subheading = round(fs*0.95) @500 muted, body = fs
 * @400. Empty spans collapse (matching the old absent-field behavior).
 */
export function calloutRows(blocks: CalloutBlock[], fontSize: number): CalloutRow[] {
  const fs = fontSize;
  const rows: CalloutRow[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        if (spanText(b.spans))
          rows.push({ runs: runsOf(b.spans), size: Math.round(fs * 1.3), weight: 700, align: b.align });
        break;
      case 'subheading':
        if (spanText(b.spans))
          rows.push({
            runs: runsOf(b.spans),
            size: Math.round(fs * 0.95),
            weight: 500,
            muted: true,
            align: b.align,
          });
        break;
      case 'paragraph':
        if (spanText(b.spans))
          rows.push({ runs: runsOf(b.spans), size: fs, weight: 400, align: b.align });
        break;
      case 'bullets':
      case 'numbers':
        b.items.forEach((item, i) => {
          const marker = b.kind === 'bullets' ? '• ' : `${i + 1}. `;
          rows.push({
            runs: [{ text: marker }, ...runsOf(item)],
            size: fs,
            weight: 400,
            align: b.align,
          });
        });
        break;
      case 'code':
        for (const line of b.text.split('\n')) {
          rows.push({ runs: [{ text: line }], size: fs, weight: 400, mono: true });
        }
        break;
    }
  }
  return rows;
}

/** Like calloutRows, but yields a single "Text" placeholder when fully empty. */
export function calloutRowsOrPlaceholder(
  blocks: CalloutBlock[],
  fontSize: number,
): CalloutRow[] {
  const rows = calloutRows(blocks, fontSize);
  if (rows.length > 0) return rows;
  return [{ runs: [{ text: 'Text' }], size: fontSize, weight: 400 }];
}

/** Left/center/right → the x anchor for a row inside [boxX, boxX+width]. */
export function rowAnchor(
  align: BlockAlign | undefined,
  boxX: number,
  width: number,
  pad: number,
): { x: number; anchor: 'start' | 'middle' | 'end' } {
  switch (align) {
    case 'center':
      return { x: boxX + width / 2, anchor: 'middle' };
    case 'right':
      return { x: boxX + width - pad, anchor: 'end' };
    default:
      return { x: boxX + pad, anchor: 'start' };
  }
}

/** Convenience: a fresh single-paragraph blocks array with the given text. */
export function paragraphBlocks(text: string): CalloutBlock[] {
  return [{ kind: 'paragraph', spans: text ? [{ text }] : [] }];
}

/** Narrowing helper used by consumers that hold a generic object. */
export function isTextObject(o: { kind: string }): o is TextObject {
  return o.kind === 'text';
}

/** Deep copy of a blocks array — safe to hand to a duplicated object. */
export function cloneBlocks(blocks: CalloutBlock[]): CalloutBlock[] {
  return blocks.map((b) => {
    switch (b.kind) {
      case 'code':
        return { ...b };
      case 'bullets':
      case 'numbers':
        return { ...b, items: b.items.map((item) => item.map((s) => ({ ...s }))) };
      default:
        return { ...b, spans: b.spans.map((s) => ({ ...s })) };
    }
  });
}

// ---------------------------------------------------------------------------
// Toolbar formatting (block-granular, schema v4). These act on the whole callout
// — a robust v1 that reaches every format the user asked for (bold/italic/code/
// lists/alignment) without a full rich-text engine. Per-selection granularity is
// a future refinement; the span model already supports it.
// ---------------------------------------------------------------------------

/** Blocks whose spans carry inline marks (everything except code). */
function markableSpanRuns(block: CalloutBlock): RichSpan[][] {
  switch (block.kind) {
    case 'code':
      return [];
    case 'bullets':
    case 'numbers':
      return block.items;
    default:
      return [block.spans];
  }
}

/** True when every non-empty markable span already carries `mark`. */
export function hasMark(blocks: CalloutBlock[], mark: RichMark): boolean {
  let sawOne = false;
  for (const b of blocks) {
    for (const run of markableSpanRuns(b)) {
      for (const s of run) {
        if (!s.text) continue;
        sawOne = true;
        if (!s.marks?.includes(mark)) return false;
      }
    }
  }
  return sawOne;
}

function setSpanMark(s: RichSpan, mark: RichMark, on: boolean): RichSpan {
  const has = s.marks?.includes(mark) ?? false;
  if (on === has) return { ...s };
  const marks = on
    ? [...(s.marks ?? []), mark]
    : (s.marks ?? []).filter((m) => m !== mark);
  const next: RichSpan = { text: s.text };
  if (marks.length) next.marks = marks;
  return next;
}

/** Toggle a mark across all markable spans (add if not all-marked, else remove). */
export function toggleMark(blocks: CalloutBlock[], mark: RichMark): CalloutBlock[] {
  const on = !hasMark(blocks, mark);
  const apply = (run: RichSpan[]) => run.map((s) => (s.text ? setSpanMark(s, mark, on) : s));
  return blocks.map((b) => {
    switch (b.kind) {
      case 'code':
        return { ...b };
      case 'bullets':
      case 'numbers':
        return { ...b, items: b.items.map(apply) };
      default:
        return { ...b, spans: apply(b.spans) };
    }
  });
}

/** Set horizontal alignment on every block that supports it (all but code). */
export function setCalloutAlign(blocks: CalloutBlock[], align: BlockAlign): CalloutBlock[] {
  return blocks.map((b) => (b.kind === 'code' ? { ...b } : { ...b, align }));
}

/** The align shared by the callout, or undefined if blocks disagree / have none. */
export function calloutAlign(blocks: CalloutBlock[]): BlockAlign | undefined {
  let seen: BlockAlign | undefined;
  for (const b of blocks) {
    if (b.kind === 'code') continue;
    const a = b.align ?? 'left';
    if (seen === undefined) seen = a;
    else if (seen !== a) return undefined;
  }
  return seen;
}

/** The body as one span-run per visual line (heading/subheading excluded). */
function bodyLines(blocks: CalloutBlock[]): RichSpan[][] {
  const lines: RichSpan[][] = [];
  for (const b of blocks) {
    if (b.kind === 'heading' || b.kind === 'subheading') continue;
    if (b.kind === 'code') {
      for (const line of b.text.split('\n')) lines.push(line ? [{ text: line }] : []);
    } else if (b.kind === 'bullets' || b.kind === 'numbers') {
      lines.push(...b.items);
    } else {
      lines.push(b.spans);
    }
  }
  return lines;
}

export type BodyKind = 'paragraph' | 'bullets' | 'numbers' | 'code';

/** The body's current kind, for toolbar active state (heading/sub ignored). */
export function bodyKind(blocks: CalloutBlock[]): BodyKind {
  const body = blocks.filter((b) => b.kind !== 'heading' && b.kind !== 'subheading');
  const first = body[0];
  if (!first) return 'paragraph';
  if (first.kind === 'bullets' || first.kind === 'numbers' || first.kind === 'code')
    return first.kind;
  return 'paragraph';
}

/** Convert the body (heading/sub preserved) to the given block kind. */
export function setBodyKind(blocks: CalloutBlock[], kind: BodyKind): CalloutBlock[] {
  const head = blocks.filter((b) => b.kind === 'heading' || b.kind === 'subheading');
  const lines = bodyLines(blocks);
  const align = calloutAlign(blocks);
  const body: CalloutBlock[] = [];
  if (kind === 'code') {
    body.push({ kind: 'code', text: lines.map(spanText).join('\n') });
  } else if (kind === 'bullets' || kind === 'numbers') {
    body.push({ kind, items: lines.length ? lines : [[]], ...(align ? { align } : {}) });
  } else {
    for (const line of lines.length ? lines : [[]]) {
      body.push({ kind: 'paragraph', spans: line, ...(align ? { align } : {}) });
    }
  }
  return [...head, ...body];
}
