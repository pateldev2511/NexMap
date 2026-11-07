/** Health · Path redundancy follows the diagram after a check, never a stale verdict (#42). */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BottomPanel } from './BottomPanel';
import { useProjectStore } from '@/store/projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

function named(type: 'router' | 'switch', name: string, x: number): string {
  const id = s().addDeviceAt(type, x, 0);
  s().updateDevice(id, { name: s().getDevice(id)!.name }, { name });
  return id;
}

describe('Health · path redundancy', () => {
  it('re-derives the verdict as links and endpoints change, and on undo', () => {
    const r1 = named('router', 'R1', 0);
    const sw = named('switch', 'SW1', 200);
    const direct = s().connect(r1, sw)!;
    render(<BottomPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Health/ }));
    fireEvent.change(screen.getByLabelText('From device'), { target: { value: r1 } });
    fireEvent.change(screen.getByLabelText('To device'), { target: { value: sw } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('1 path — no redundancy: losing the link R1 – SW1 separates them.');

    // Remove that link: the old "1 path" must not linger on a disconnected design.
    act(() => {
      s().select([direct]);
      s().deleteSelection();
    });
    expect(status.textContent).toBe('No path between them.');

    // Undo brings it back.
    act(() => s().undo());
    expect(status.textContent).toBe('1 path — no redundancy: losing the link R1 – SW1 separates them.');

    // Add a backup link.
    act(() => {
      s().connect(r1, sw);
    });
    expect(status.textContent).toBe('2 edge-disjoint paths — redundant; no single link cut separates them.');

    // Delete an endpoint: say so, and ask for another check.
    act(() => {
      s().select([sw]);
      s().deleteSelection();
    });
    expect(status.textContent).toBe('SW1 was removed — pick two devices and check again.');
    act(() => s().undo());
    expect(status.textContent).toBe('2 edge-disjoint paths — redundant; no single link cut separates them.');
  });

  it('names only the on-path link, not an unrelated branch', () => {
    const r1 = named('router', 'R1', 0);
    const sw = named('switch', 'SW1', 200);
    const branch = named('switch', 'SW2', 400);
    s().connect(r1, sw);
    s().connect(sw, branch); // a branch off SW1 that the R1↔SW1 path never uses
    render(<BottomPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Health/ }));
    fireEvent.change(screen.getByLabelText('From device'), { target: { value: r1 } });
    fireEvent.change(screen.getByLabelText('To device'), { target: { value: sw } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('status').textContent).toBe(
      '1 path — no redundancy: losing the link R1 – SW1 separates them.',
    );
  });

  it('clears the verdict when the chosen pair changes', () => {
    const r1 = named('router', 'R1', 0);
    const sw = named('switch', 'SW1', 200);
    s().connect(r1, sw);
    render(<BottomPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Health/ }));
    fireEvent.change(screen.getByLabelText('From device'), { target: { value: r1 } });
    fireEvent.change(screen.getByLabelText('To device'), { target: { value: sw } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.change(screen.getByLabelText('To device'), { target: { value: '' } });
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
