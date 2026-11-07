/**
 * Keyboard paste is decided in the paste event (#52), and a read-only canvas takes
 * none of it (#35). The browser side — ⌘V reaching this event at all, the real
 * clipboard — is covered end to end in e2e/clipboard.spec.ts; these pin the
 * decision table and the gating with synthetic events.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useProjectStore } from '@/store/projectStore';
import { registerPasteCanvas, usePasteToCanvas } from './usePasteToCanvas';
import {
  MARKER_TEXT,
  MARKER_TYPE,
  isCanvasMarker,
  noteCanvasCopy,
  pasteSource,
  writeMarkerOnEvent,
  type ClipboardDataLike,
} from './canvasClipboard';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const CSV = 'name,type\nClipTest,switch';

function clip(data: Record<string, string>, files: File[] = []): ClipboardDataLike {
  return {
    types: [...Object.keys(data), ...(files.length ? ['Files'] : [])],
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    getData: (t) => data[t] ?? '',
  };
}

/** Dispatch a paste (or copy/cut) the way the browser does, from `target` up to window. */
function fire(
  type: 'paste' | 'copy' | 'cut',
  data: ClipboardDataLike | (ClipboardDataLike & { setData(t: string, v: string): void }),
  target: EventTarget = document.body,
) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(e, 'clipboardData', { value: data });
  target.dispatchEvent(e);
  return e;
}

function Host() {
  usePasteToCanvas();
  return null;
}

describe('pasteSource — internal vs. external', () => {
  it('the canvas marker means the canvas clipboard', () => {
    expect(pasteSource(clip({ 'text/plain': MARKER_TEXT }), true)).toEqual({ kind: 'internal' });
    expect(pasteSource(clip({ [MARKER_TYPE]: '1', 'text/plain': MARKER_TEXT }), true)).toEqual({ kind: 'internal' });
    // …but with nothing on the canvas clipboard there's nothing to paste.
    expect(pasteSource(clip({ 'text/plain': MARKER_TEXT }), false)).toEqual({ kind: 'none' });
    expect(isCanvasMarker(clip({ 'text/plain': 'name,type' }))).toBe(false);
  });

  it('anything else on the clipboard was copied since, so it wins', () => {
    expect(pasteSource(clip({ 'text/plain': CSV }), true)).toEqual({ kind: 'text', text: CSV });
    const png = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    expect(pasteSource(clip({}, [png]), true)).toEqual({ kind: 'image', file: png });
  });

  it('an empty clipboard falls back to the canvas clipboard', () => {
    expect(pasteSource(clip({}), true)).toEqual({ kind: 'internal' });
    expect(pasteSource(null, true)).toEqual({ kind: 'internal' });
    expect(pasteSource(clip({ 'text/plain': '   ' }), false)).toEqual({ kind: 'none' });
  });
});

describe('the copy marker', () => {
  it('a canvas copy arms the next native copy event to write it', () => {
    noteCanvasCopy(undefined, 1000);
    const set = new Map<string, string>();
    const dt = { ...clip({}), setData: (t: string, v: string) => void set.set(t, v) };
    const e = new Event('copy', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(e, 'clipboardData', { value: dt });
    expect(writeMarkerOnEvent(e, 1010)).toBe(true);
    expect(set.get('text/plain')).toBe(MARKER_TEXT);
    expect(set.get(MARKER_TYPE)).toBe('1');
    expect(e.defaultPrevented).toBe(true);
    // One-shot: a later unrelated copy is left alone.
    const e2 = new Event('copy', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(e2, 'clipboardData', { value: dt });
    expect(writeMarkerOnEvent(e2, 1020)).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
  });

  it('a copy with devices writes their CSV, which this tab still pastes as its own copy', () => {
    const csv = 'name,type\nedge-rtr,Router';
    noteCanvasCopy(csv, 1000);
    const set = new Map<string, string>();
    const e = new Event('copy', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(e, 'clipboardData', {
      value: { ...clip({}), setData: (t: string, v: string) => void set.set(t, v) },
    });
    expect(writeMarkerOnEvent(e, 1010)).toBe(true);
    expect(set.get('text/plain')).toBe(csv);
    // Same text back (even without the custom type) → the full-fidelity internal paste.
    expect(pasteSource(clip({ 'text/plain': `${csv}\n` }), true)).toEqual({ kind: 'internal' });
    // Different text copied since → imported.
    const other = 'name,type\nother,Switch';
    expect(pasteSource(clip({ 'text/plain': other }), true)).toEqual({ kind: 'text', text: other });
    noteCanvasCopy(undefined, 2000);
  });

  it('a stale arm (no copy event followed) expires', () => {
    noteCanvasCopy(undefined, 1000);
    const e = new Event('copy', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(e, 'clipboardData', { value: { ...clip({}), setData: () => {} } });
    expect(writeMarkerOnEvent(e, 5000)).toBe(false);
  });
});

describe('paste event handling', () => {
  let unregister: () => void = () => {};
  beforeEach(() => {
    s().newProject(NOW);
    unregister = registerPasteCanvas({ readOnly: false });
  });
  afterEach(() => {
    unregister();
    vi.unstubAllGlobals();
  });

  it('copy a device, then copy external CSV, then paste → the CSV is imported', () => {
    render(<Host />);
    const a = s().addDeviceAt('router', 0, 0);
    s().select([a]);
    s().copySelection(); // the canvas clipboard is not empty…
    const e = fire('paste', clip({ 'text/plain': CSV })); // …but the CSV is newer
    expect(e.defaultPrevented).toBe(true);
    const names = s().devicesAll().map((d) => d.name);
    expect(names).toContain('ClipTest');
    expect(s().devicesAll()).toHaveLength(2); // no clone of the router
  });

  it('copy a device, then paste the marker → an internal paste', () => {
    render(<Host />);
    const a = s().addDeviceAt('router', 0, 0);
    s().select([a]);
    s().copySelection();
    fire('paste', clip({ 'text/plain': MARKER_TEXT }));
    expect(s().devicesAll()).toHaveLength(2);
  });

  it('plain (non-CSV) text with a canvas copy pending pastes the canvas copy', () => {
    render(<Host />);
    const a = s().addDeviceAt('router', 0, 0);
    s().select([a]);
    s().copySelection();
    fire('paste', clip({ 'text/plain': 'just some words' }));
    expect(s().devicesAll()).toHaveLength(2);
  });

  it('a CSV paste is one undoable edit', () => {
    render(<Host />);
    fire('paste', clip({ 'text/plain': 'name,type\nA,router\nB,switch\nC,server' }));
    expect(s().devicesAll()).toHaveLength(3);
    s().undo();
    expect(s().devicesAll()).toHaveLength(0);
  });

  it('leaves a paste into a text field alone', () => {
    render(<Host />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = fire('paste', clip({ 'text/plain': CSV }), input);
    expect(e.defaultPrevented).toBe(false);
    expect(s().devicesAll()).toHaveLength(0);
    input.remove();
  });

  it('the native copy after a canvas copy writes the marker; a field copy does not', () => {
    render(<Host />);
    const a = s().addDeviceAt('router', 0, 0);
    s().select([a]);
    s().copySelection();
    noteCanvasCopy();
    const written = new Map<string, string>();
    const dt = { ...clip({}), setData: (t: string, v: string) => void written.set(t, v) };
    const input = document.createElement('input');
    document.body.appendChild(input);
    fire('copy', dt, input);
    expect(written.size).toBe(0);
    fire('copy', dt);
    expect(written.get('text/plain')).toBe(MARKER_TEXT);
    input.remove();
  });

  describe('on a read-only (presentation) canvas (#35)', () => {
    beforeEach(() => {
      unregister();
      unregister = registerPasteCanvas({ readOnly: true });
    });

    it('ignores CSV, marker and empty pastes', () => {
      render(<Host />);
      const a = s().addDeviceAt('router', 0, 0);
      s().select([a]);
      s().copySelection();
      const rev = s().rev;
      fire('paste', clip({ 'text/plain': 'name,type\nAuditPasted,router' }));
      fire('paste', clip({ 'text/plain': MARKER_TEXT }));
      fire('paste', clip({}));
      expect(s().devicesAll()).toHaveLength(1);
      expect(s().rev).toBe(rev);
    });

    it('still writes the copy marker (copy works while presenting)', () => {
      render(<Host />);
      const a = s().addDeviceAt('router', 0, 0);
      s().select([a]);
      s().copySelection();
      noteCanvasCopy();
      const written = new Map<string, string>();
      fire('copy', { ...clip({}), setData: (t: string, v: string) => void written.set(t, v) });
      expect(written.get('text/plain')).toBe(MARKER_TEXT);
    });
  });

  it('drops an image import that finishes decoding after presenting began', async () => {
    // jsdom never decodes images: stand in an Image that "loads" on the next tick,
    // counting decodes so the test waits on them rather than on a timer.
    let decoded = 0;
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 120;
        naturalHeight = 80;
        set src(_v: string) {
          setTimeout(() => {
            this.onload?.();
            decoded++;
          }, 0);
        }
      },
    );
    render(<Host />);
    const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' });
    const images = () => s().objectsAll().filter((o) => o.kind === 'image');

    // Control: an editable canvas gets the underlay.
    fire('paste', clip({}, [png()]));
    await vi.waitFor(() => expect(decoded).toBe(1));
    expect(images()).toHaveLength(1);

    // Paste, then enter presentation before the image decodes.
    fire('paste', clip({}, [png()]));
    unregister();
    unregister = registerPasteCanvas({ readOnly: true });
    await vi.waitFor(() => expect(decoded).toBe(2));
    expect(images()).toHaveLength(1);
  });
});
