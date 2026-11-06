/** The Racks table edits a rack's depth and its power/weight caps (blank clears them). */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BottomPanel } from './BottomPanel';
import { useProjectStore } from '@/store/projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('Racks table · limits', () => {
  it('sets depth and caps, and clears one when blanked', () => {
    s().addRack('MDF');
    render(<BottomPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Racks/ }));
    const row = screen.getAllByRole('row')[1]!;
    const inputs = within(row).getAllByRole('spinbutton'); // RU height, depth, power cap, weight cap
    fireEvent.change(inputs[1]!, { target: { value: '800' } });
    fireEvent.change(inputs[2]!, { target: { value: '5000' } });
    fireEvent.change(inputs[3]!, { target: { value: '600' } });
    const r = s().racksAll()[0]!;
    expect([r.depthMm, r.maxWatts, r.maxWeightKg]).toEqual([800, 5000, 600]);
    fireEvent.change(inputs[1]!, { target: { value: '' } });
    expect(s().racksAll()[0]!.depthMm).toBeUndefined();
  });
});
