import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileAsDataUrl } from './readFileAsDataUrl';

type Mode = 'load' | 'error' | 'abort';
function stubReader(mode: Mode) {
  class FakeReader {
    result: string | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    readAsDataURL() {
      queueMicrotask(() => {
        if (mode === 'load') {
          this.result = 'data:image/png;base64,AAAA';
          this.onload?.();
        } else if (mode === 'error') {
          this.error = new Error('NotReadableError');
          this.onerror?.();
        } else this.onabort?.();
      });
    }
  }
  vi.stubGlobal('FileReader', FakeReader);
}

afterEach(() => vi.unstubAllGlobals());

describe('readFileAsDataUrl', () => {
  it('resolves with the data URL', async () => {
    stubReader('load');
    await expect(readFileAsDataUrl(new Blob(['x']))).resolves.toBe('data:image/png;base64,AAAA');
  });
  it('rejects when the read errors', async () => {
    stubReader('error');
    await expect(readFileAsDataUrl(new Blob(['x']))).rejects.toThrow('NotReadableError');
  });
  it('rejects when the read is aborted', async () => {
    stubReader('abort');
    await expect(readFileAsDataUrl(new Blob(['x']))).rejects.toThrow(/cancelled/);
  });
});
