/**
 * #82: the live preview re-serialises only when something that changes the SVG
 * changes. Scale, JPEG quality and file name never do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@/io/export', async (orig) => {
  const real = await orig<typeof import('@/io/export')>();
  return { ...real, exportDiagramSvg: vi.fn(real.exportDiagramSvg) };
});

import { exportDiagramSvg } from '@/io/export';
import { ExportDialog } from './ExportDialog';
import { useProjectStore } from '@/store/projectStore';

const spy = vi.mocked(exportDiagramSvg);

beforeEach(() => {
  spy.mockClear();
});

describe('ExportDialog preview', () => {
  it('does not re-serialise for scale or file name, and does once per render option', async () => {
    const s = useProjectStore.getState();
    // Make sure there is something to preview.
    if (s.devicesAll().length === 0) {
      const add = (s as unknown as Record<string, unknown>).addDevice as ((...a: unknown[]) => unknown) | undefined;
      add?.('router', { x: 0, y: 0 });
    }
    render(<ExportDialog onClose={() => {}} />);
    await act(async () => {});
    const initial = spy.mock.calls.length;
    expect(initial).toBeGreaterThanOrEqual(1);

    const slider = screen.getByRole('slider') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(slider, { target: { value: '3' } });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filename'), { target: { value: 'my-diagram' } });
    });
    expect(spy.mock.calls.length).toBe(initial);

    const labels = screen.getByLabelText('Include device names');
    await act(async () => {
      fireEvent.click(labels);
    });
    expect(spy.mock.calls.length).toBe(initial + 1);
  });
});
