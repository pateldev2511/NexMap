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
