/** Image import: an unreadable file shows the read-error message instead of hanging (#73). */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportDialog } from './ImportDialog';

afterEach(() => vi.unstubAllGlobals());

describe('ImportDialog', () => {
  it('reports an image the browser cannot read', async () => {
    class FailingReader {
      error = new Error('NotReadableError');
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('FileReader', FailingReader);
    const { container } = render(<ImportDialog onClose={() => {}} />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Could not read this file/)).toBeTruthy());
    expect(screen.getByText(/Nothing was imported/)).toBeTruthy();
  });
});
