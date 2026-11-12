/** The Racks table's height field: a whole number of U, 1–1000 — never a file that cannot be reopened. */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BottomPanel } from './BottomPanel';
import { useProjectStore } from '@/store/projectStore';
import { loadDocument } from '@/model/migrate';

const s = () => useProjectStore.getState();
beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('Racks table · height', () => {
  it('limits a typed height to 1–1000U and the saved file still opens without repairs', () => {
    s().addRack('MDF');
    render(<BottomPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Racks/ }));
    const height = () => within(screen.getAllByRole('row')[1]!).getAllByRole('spinbutton')[0]!;
    const type = (v: string) => fireEvent.change(height(), { target: { value: v } });
    type('5000');
    expect(s().racksAll()[0]!.ruHeight).toBe(1000);
    const r = loadDocument(JSON.stringify(s().getDocument()));
    expect(r.ok).toBe(true);
    expect(r.ok && r.warnings).toBeUndefined();
    type('48');
    expect(s().racksAll()[0]!.ruHeight).toBe(48);
    type('0');
    expect(s().racksAll()[0]!.ruHeight).toBe(1);
    type('12.4');
    expect(s().racksAll()[0]!.ruHeight).toBe(12);
  });
});
