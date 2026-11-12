/** Command palette a11y (#83): combobox wiring, modal focus contract, single Escape. */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { CommandPalette, type PaletteCommand } from './CommandPalette';

const cmds = (): PaletteCommand[] => [
  { id: 'a', label: 'Alpha', run: () => {}, group: 'Build' },
  { id: 'b', label: 'Bravo', run: () => {}, disabled: true, group: 'Build' },
  { id: 'c', label: 'Charlie', run: () => {}, group: 'Edit' },
];

describe('CommandPalette a11y', () => {
  it('wires the combobox to the listbox and tracks the active option', () => {
    render(<CommandPalette commands={cmds()} onClose={() => {}} />);
    const input = screen.getByRole('combobox');
    const list = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');

    const activeOf = () => document.getElementById(input.getAttribute('aria-activedescendant')!);
    expect(activeOf()?.textContent).toContain('Alpha');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const el = activeOf()!;
    // Bravo is disabled, so the arrow skips to Charlie.
    expect(el.getAttribute('role')).toBe('option');
    expect(el.getAttribute('aria-selected')).toBe('true');
    expect(el.textContent).toContain('Charlie');
    expect(screen.getByText('Bravo').closest('[role=option]')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps listbox children valid and the empty message outside it', () => {
    render(<CommandPalette commands={cmds()} onClose={() => {}} />);
    const list = screen.getByRole('listbox');
    expect(list.querySelectorAll('li:not([role])').length).toBe(0);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzzqq' } });
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/No matching command/);
    expect(list.contains(status)).toBe(false);
    expect(screen.getByRole('combobox').hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('keeps Tab inside the palette', () => {
    render(<CommandPalette commands={cmds()} onClose={() => {}} />);
    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('Escape closes once and focus returns to the opener', () => {
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Opener</button>
          {open && (
            <CommandPalette
              commands={cmds()}
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            />
          )}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
