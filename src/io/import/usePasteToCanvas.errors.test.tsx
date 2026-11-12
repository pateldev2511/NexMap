/** Paste failures surface a message instead of failing silently or throwing (#73). */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useProjectStore } from '@/store/projectStore';
import { registerPasteCanvas, usePasteToCanvas } from './usePasteToCanvas';
import * as clipboardImport from './clipboardImport';

function Host() {
  usePasteToCanvas();
  return null;
}
const flash = () => useProjectStore.getState().flash;

function paste(data: Record<string, string>, files: File[] = []) {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(e, 'clipboardData', {
    value: {
      types: [...Object.keys(data), ...(files.length ? ['Files'] : [])],
      items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
      getData: (t: string) => data[t] ?? '',
    },
  });
  document.body.dispatchEvent(e);
  return e;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useProjectStore.getState().setFlash(null);
});

describe('usePasteToCanvas failures', () => {
  it('flashes when a pasted CSV import throws, and still swallows the paste', () => {
    vi.spyOn(clipboardImport, 'importPastedCsv').mockImplementation(() => {
      throw new Error('boom');
    });
    const off = registerPasteCanvas({ readOnly: false });
    render(<Host />);
    const e = paste({ 'text/plain': 'name,type\nA,switch' });
    expect(e.defaultPrevented).toBe(true);
    expect(flash()).toBe('Could not import the pasted table.');
    off();
  });

  it('flashes when the pasted image cannot be read', async () => {
    class FailingReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      error = new Error('x');
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('FileReader', FailingReader);
    const off = registerPasteCanvas({ readOnly: false });
    render(<Host />);
    paste({}, [new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })]);
    await vi.waitFor(() => expect(flash()).toBe('Could not read the pasted image.'));
    off();
  });
});
