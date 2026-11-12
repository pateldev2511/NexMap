/** Error containment (#70): panel crashes stay in their panel; the full fallback never throws. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import { AppShell } from './AppShell';
import { useProjectStore } from '@/store/projectStore';
import * as fsaccess from '@/persistence/fsaccess';

let boom = false;
function Bomb({ text = 'bomb ok' }: { text?: string }) {
  if (boom) throw new Error('render exploded');
  return <div>{text}</div>;
}

beforeEach(() => {
  boom = false;
  // AppShell measures its viewport and action strip; jsdom has neither API.
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ErrorBoundary', () => {
  it('shows a compact panel fallback while sibling panels survive', () => {
    boom = true;
    render(
      <AppShell
        canvas={<div>canvas ok</div>}
        left={<div>left ok</div>}
        right={<Bomb />}
        bottom={<div>bottom ok</div>}
      />,
    );
    expect(screen.getByText('This panel hit an error')).toBeTruthy();
    expect(screen.getByText('canvas ok')).toBeTruthy();
    expect(screen.getByText('left ok')).toBeTruthy();
    expect(screen.getByText('bottom ok')).toBeTruthy();
  });

  it('contains a bottom-panel crash without touching the inspector', () => {
    boom = true;
    render(<AppShell canvas={<div>canvas ok</div>} right={<div>right ok</div>} bottom={<Bomb />} />);
    expect(screen.getByText('This panel hit an error')).toBeTruthy();
    expect(screen.getByText('right ok')).toBeTruthy();
  });

  it('Try again recovers once the cause is gone, and takes focus on show', () => {
    boom = true;
    render(
      <ErrorBoundary variant="panel" label="Inspector">
        <Bomb />
      </ErrorBoundary>,
    );
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(document.activeElement).toBe(retry);
    boom = false;
    fireEvent.click(retry);
    expect(screen.getByText('bomb ok')).toBeTruthy();
    expect(screen.queryByText('This panel hit an error')).toBeNull();
  });

  it('resets itself when resetKeys change', () => {
    boom = true;
    const { rerender } = render(
      <ErrorBoundary variant="panel" resetKeys={[1]}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    boom = false;
    rerender(
      <ErrorBoundary variant="panel" resetKeys={[2]}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('bomb ok')).toBeTruthy();
  });

  it('logs to the console only', () => {
    boom = true;
    render(
      <ErrorBoundary label="X">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalled();
  });

  it('full fallback: Save a copy serializes the current document', async () => {
    const save = vi
      .spyOn(fsaccess, 'saveDocument')
      .mockResolvedValue({ handle: null, fileName: 'p.nexmap' });
    boom = true;
    render(
      <ErrorBoundary label="the canvas" extraActions={<button>Exit presentation</button>}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Exit presentation')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save a copy/ }));
    await waitFor(() => expect(screen.getByText(/Saved a copy as p.nexmap/)).toBeTruthy());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toEqual(useProjectStore.getState().getDocument());
    expect(save.mock.calls[0]![1]).toBeNull();
  });

  it('full fallback: Save a copy never throws when the serializer does', async () => {
    vi.spyOn(fsaccess, 'saveDocument').mockRejectedValue(new Error('disk full'));
    boom = true;
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Save a copy/ }));
    await waitFor(() => expect(screen.getByText(/Could not save a copy/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('full fallback: first action has focus and the note makes no unconditional autosave claim', () => {
    boom = true;
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByText(/your work is safe/i)).toBeNull();
  });
});
