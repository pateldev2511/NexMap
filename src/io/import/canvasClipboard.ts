/**
 * The canvas clipboard's handshake with the system clipboard (#52).
 *
 * Copied devices live in the store (in memory); the system clipboard belongs to the
 * user. Every keyboard paste is decided in ONE place, the browser `paste` event,
 * so the canvas never preventDefaults ⌘V and an external CSV or image can reach
 * the importer. To tell "paste what I copied on the canvas" from "paste what I
 * copied elsewhere since", each canvas copy/cut puts a small marker on the system
 * clipboard:
 *
 *   marker on the clipboard          → the canvas's own copy (internal paste)
 *   an image / text instead          → copied elsewhere AFTER it: that's fresher, import it
 *   nothing usable (empty, or text   → the canvas clipboard, if any (also covers a
 *   that isn't an importable CSV)       marker write the browser refused)
 *
 * The marker is written two ways, since neither is universal: synchronously from
 * the native copy/cut event that follows the keystroke (writeMarkerOnEvent), and
 * best-effort through the async Clipboard API (covers the context menu, and
 * browsers that fire no copy event without a text selection). Nothing leaves the
 * device: it's the local clipboard only.
 */

/** Custom clipboard type carried alongside the text marker when the browser allows it. */
export const MARKER_TYPE = 'application/x-nexmap-selection';
/**
 * The marker's text when the copy has no devices (only shapes or callouts). A copy
 * with devices writes them as an inventory CSV instead, which is useful pasted into
 * a spreadsheet and imports as devices into another NexMap tab.
 */
export const MARKER_TEXT = 'NexMap selection (paste it onto a NexMap canvas)';
/** The exact text this tab last wrote, so its own paste is recognized as internal. */
let lastText = MARKER_TEXT;

/** A canvas copy arms the native copy/cut event that follows it for this long. */
const ARM_MS = 1000;
let armedAt = Number.NEGATIVE_INFINITY;

/** Is the user copying page text (a live DOM selection) rather than canvas objects? */
function copyingPageText(): boolean {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
}

/**
 * Call after a canvas copy or cut put something on the canvas clipboard. Arms the
 * native event write and starts the async one. Steps aside when the user has page
 * text selected — their text copy wins the system clipboard.
 */
export function noteCanvasCopy(text: string = MARKER_TEXT, now: number = performance.now()): void {
  if (copyingPageText()) return;
  armedAt = now;
  lastText = text;
  try {
    void navigator.clipboard?.writeText(text).catch(() => {
      /* refused (no permission / focus): the native event or the fallback covers it */
    });
  } catch {
    /* no async clipboard here */
  }
}

/**
 * Native copy/cut event handler body: if a canvas copy armed it, write the marker
 * into the event's clipboard data (and keep the browser from writing its own empty
 * selection over it). Returns whether it wrote.
 */
export function writeMarkerOnEvent(e: ClipboardEvent, now: number = performance.now()): boolean {
  if (now - armedAt > ARM_MS) return false;
  armedAt = Number.NEGATIVE_INFINITY;
  if (!e.clipboardData || copyingPageText()) return false;
  e.clipboardData.setData('text/plain', lastText);
  try {
    e.clipboardData.setData(MARKER_TYPE, '1');
  } catch {
    /* custom types unsupported: the text marker is enough */
  }
  e.preventDefault();
  return true;
}

/** The parts of a paste's DataTransfer this reads (structural, so tests can fake it). */
export interface ClipboardDataLike {
  readonly types: readonly string[];
  readonly items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>;
  getData(type: string): string;
}

export type PasteSource =
  | { kind: 'internal' }
  | { kind: 'image'; file: File | null }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

/** Whether this clipboard holds the canvas's own marker. */
export function isCanvasMarker(dt: ClipboardDataLike): boolean {
  if (dt.types.includes(MARKER_TYPE)) return true;
  const text = dt.getData('text/plain').trim();
  return text === MARKER_TEXT || text === lastText.trim();
}

/**
 * Decide what a paste is (see the table above). `text` results still need the
 * caller to try the CSV importer and fall back to `hasInternal` when it can't.
 */
export function pasteSource(dt: ClipboardDataLike | null, hasInternal: boolean): PasteSource {
  if (!dt) return hasInternal ? { kind: 'internal' } : { kind: 'none' };
  if (isCanvasMarker(dt)) return hasInternal ? { kind: 'internal' } : { kind: 'none' };
  const items = dt.items ? Array.from(dt.items) : [];
  const image = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
  if (image) return { kind: 'image', file: image.getAsFile() };
  const text = dt.getData('text/plain');
  if (text.trim()) return { kind: 'text', text };
  return hasInternal ? { kind: 'internal' } : { kind: 'none' };
}
