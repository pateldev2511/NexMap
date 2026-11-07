/**
 * The shared modal contract (useModalDialog): a named modal that takes focus,
 * traps Tab, gives Escape to the topmost dialog only, hands focus back on close,
 * and keeps every key and paste away from the editor behind it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { keyboardRouter, type CanvasKeyApi } from '@/input/router';
import { useProjectStore } from '@/store/projectStore';
import { useModalDialog } from './useModalDialog';
import { ExportDialog } from './ExportDialog';

function Modal({ title, onClose, children }: { title: string; onClose?: () => void; children?: React.ReactNode }) {
  const { titleId, dialogProps } = useModalDialog(onClose);
  return (
    <div {...dialogProps}>
      <h2 id={titleId}>{title}</h2>
      <button>First</button>
      <input aria-label="Name" />
      <button>Last</button>
      {children}
    </div>
  );
}

const canvasKeys: string[] = [];
const canvas: CanvasKeyApi = {
  cancelActiveGesture: () => {},
  hasActiveGesture: () => false,
  handleKey: (e) => {
    canvasKeys.push(e.key);
    return true;
  },
  handleKeyUp: () => {},
};
let offCanvas: () => void;
let detach: () => void;

beforeEach(() => {
  canvasKeys.length = 0;
  detach = keyboardRouter.install(window);
  offCanvas = keyboardRouter.registerCanvas('modal-test', canvas);
});
afterEach(() => {
  offCanvas();
  detach();
});

describe('useModalDialog', () => {
  it('is a named modal dialog that takes focus on open', () => {
    render(<Modal title="Export" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Export' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
  });

  it('keeps focus where an autoFocus field inside already put it', () => {
    render(
      <Modal title="Outline">
        <input aria-label="Filter" autoFocus />
      </Modal>,
    );
    expect(screen.getByLabelText('Filter')).toHaveFocus();
  });

  it('traps Tab and Shift+Tab inside', () => {
    render(<Modal title="Export" onClose={() => {}} />);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    // From the dialog itself (where focus lands on open), Tab goes to the first control.
    const dialog = screen.getByRole('dialog');
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
  });

  it('pulls focus back when it lands outside', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    render(<Modal title="Export" onClose={() => {}} />);
    outside.focus();
    expect(screen.getByRole('dialog')).toHaveFocus();
    outside.remove();
  });

  it('closes on Escape, from a button or a text field', () => {
    const onClose = vi.fn();
    render(<Modal title="Export" onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'First' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape when focus is outside any field (router path)', () => {
    const onClose = vi.fn();
    render(<Modal title="Export" onClose={onClose} />);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives Escape to the topmost dialog only', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Modal title="Outer" onClose={outer}>
        <Modal title="Inner" onClose={inner} />
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Inner' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Inner' }), { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('does nothing on Escape for a dialog that must be answered', () => {
    render(<Modal title="Recover your work?" />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(canvasKeys).toEqual([]);
  });

  it('restores focus to the opener on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open export</button>
          {open && <Modal title="Export" onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open export' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('keeps editor shortcuts from firing while open', () => {
    const { unmount } = render(<Modal title="Export" onClose={() => {}} />);
    for (const key of ['Delete', 'Backspace', 'ArrowLeft', 'v', 'c']) {
      fireEvent.keyDown(screen.getByRole('button', { name: 'First' }), { key });
      fireEvent.keyDown(document.body, { key });
    }
    expect(canvasKeys).toEqual([]);
    unmount();
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(canvasKeys).toEqual(['Delete']); // the canvas has the keyboard back
  });

  it('keeps a paste inside the dialog away from the canvas paste-import', () => {
    const onPaste = vi.fn();
    window.addEventListener('paste', onPaste);
    render(<Modal title="Export" onClose={() => {}} />);
    fireEvent.paste(screen.getByRole('button', { name: 'First' }));
    expect(onPaste).not.toHaveBeenCalled();
    window.removeEventListener('paste', onPaste);
  });
});

describe('ExportDialog', () => {
  const s = () => useProjectStore.getState();
  beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

  it('is a named modal that Delete cannot reach through', () => {
    const id = s().addDeviceAt('router', 0, 0);
    s().select([id]);
    const onClose = vi.fn();
    render(<ExportDialog onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Export' });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'PNG' }), { key: 'Delete' });
    expect(canvasKeys).toEqual([]);
    expect(s().devicesAll()).toHaveLength(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers no Scope for the ZIP package and says it is the whole project', () => {
    const a = s().addDeviceAt('router', 0, 0);
    s().addDeviceAt('switch', 300, 0);
    s().select([a]);
    render(<ExportDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'selection' } });
    expect(screen.getByText(/Exports the selection \(1 device/)).toBeInTheDocument();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'ZIP package' })));
    expect(screen.queryByLabelText('Scope')).toBeNull();
    expect(screen.getByText(/Packages the whole project, not just the selection: .*\(2 devices/)).toBeInTheDocument();
  });
});
