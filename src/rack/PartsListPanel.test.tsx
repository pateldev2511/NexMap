/** The parts-list panel previews before mounting, and Mount does what the preview said. */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PartsListPanel } from './PartsListPanel';
import { useProjectStore } from '@/store/projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('PartsListPanel', () => {
  it('previews each line and mounts on click', () => {
    const rackId = s().addRack('MDF');
    const rack = s().racksAll().find((r) => r.id === rackId)!;
    let closed = false;
    render(<PartsListPanel rack={rack} onClose={() => (closed = true)} />);
    fireEvent.change(screen.getByLabelText('Parts list'), { target: { value: '2x Dell R650\nwidget' } });
    const preview = within(screen.getByLabelText('What will be mounted'));
    expect(preview.getByText('Dell PowerEdge R650')).toBeTruthy();
    expect(preview.getByText('U1, U2')).toBeTruthy();
    expect(preview.getByText('skipped')).toBeTruthy();
    expect(s().devicesAll()).toHaveLength(0); // nothing until Mount
    fireEvent.click(screen.getByRole('button', { name: 'Mount 2 into MDF' }));
    expect(s().devicesAll().filter((d) => d.rackId === rackId)).toHaveLength(2);
    expect(closed).toBe(true);
  });
});
