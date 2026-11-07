/**
 * The shortcut guide must only list keys that work (#56): ⌘N/Ctrl+N is the
 * browser's New Window and can't be intercepted, so New project is Alt/Option+N.
 * App.tsx handles it; e2e/clipboard.spec.ts presses it for real.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShortcutsDialog } from './ShortcutsDialog';

describe('ShortcutsDialog', () => {
  it('lists New project on Alt/Option+N, never the browser-reserved Ctrl/Cmd+N', () => {
    const { container } = render(<ShortcutsDialog onClose={() => {}} />);
    expect(screen.getByText('Alt/Option + N')).toBeTruthy();
    expect(container.textContent).not.toMatch(/(Ctrl|Cmd)[^,]*\+ N\b/);
  });

  it('lists the clipboard keys', () => {
    render(<ShortcutsDialog onClose={() => {}} />);
    expect(screen.getByText('Ctrl/Cmd + C / X')).toBeTruthy();
    expect(screen.getByText('Ctrl/Cmd + V')).toBeTruthy();
  });
});
