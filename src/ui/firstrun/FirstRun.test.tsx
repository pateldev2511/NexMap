/** First-run gallery (#69): shown for an untouched project, gone once it is edited. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useProjectStore } from '@/store/projectStore';
import { FirstRun, shouldShowFirstRun } from './FirstRun';
import { createEmptyDocument } from '@/model/schema';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
const base = { done: false, recoverable: false, mode: 'network' as const };

beforeEach(() => {
  s().newProject(NOW);
});

describe('shouldShowFirstRun', () => {
  it('shows on a fresh start: revision 0 after boot-time validation, newProject and loadDoc', () => {
    expect(s().docRevision).toBe(0);
    s().runValidation(); // what the app's debounced validation does on mount
    expect(s().docRevision).toBe(0);
    expect(shouldShowFirstRun({ ...base, docRevision: s().docRevision })).toBe(true);
  });

  it('hides once the document is mutated by a non-template path (NexText)', () => {
    const r = s().applyNexText('router R1\nswitch SW1\nR1 - SW1');
    expect(r.ok).toBe(true);
    expect(s().docRevision).toBeGreaterThan(0);
    expect(shouldShowFirstRun({ ...base, docRevision: s().docRevision })).toBe(false);
  });

  it('hides after a plain edit, and returns after New project resets the revision', () => {
    s().addDeviceAt('router', 10, 10);
    expect(shouldShowFirstRun({ ...base, docRevision: s().docRevision })).toBe(false);
    s().newProject(NOW);
    expect(s().docRevision).toBe(0);
    expect(shouldShowFirstRun({ ...base, docRevision: s().docRevision })).toBe(true);
  });

  it('still defers to recovery, a finished start, and the rack designer', () => {
    expect(shouldShowFirstRun({ ...base, docRevision: 0, recoverable: true })).toBe(false);
    expect(shouldShowFirstRun({ ...base, docRevision: 0, done: true })).toBe(false);
    expect(shouldShowFirstRun({ ...base, docRevision: 0, mode: 'rack' })).toBe(false);
    expect(shouldShowFirstRun({ ...base, docRevision: 0, mode: null })).toBe(false);
  });
});

describe('FirstRun', () => {
  it('Escape and ✕ mean "blank project" without touching the document', () => {
    const onBlank = vi.fn();
    render(<FirstRun onDone={() => {}} onBlank={onBlank} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Close and start/i }));
    expect(onBlank).toHaveBeenCalledTimes(2);
    expect(s().docRevision).toBe(0);
  });

  it('shows a message when the picked file cannot be read', async () => {
    const onDone = vi.fn();
    const { container } = render(<FirstRun onDone={onDone} />);
    const file = new File(['x'], 'broken.nexmap');
    Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('NotReadableError')) });
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not read “broken.nexmap”/));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('opening a file that needed repairs says what was repaired', async () => {
    const doc = createEmptyDocument(NOW);
    doc.project = { ...doc.project, name: 'Repaired' };
    doc.racks.push({ id: 'r', name: 'MDF', ruHeight: 5000 });
    doc.objects.push({
      id: 'img', kind: 'image', x: 0, y: 0, width: 10, height: 10, layerId: doc.layers[0]!.id,
      href: 'https://tracker.example/p.png',
    });
    const onDone = vi.fn();
    const { container } = render(<FirstRun onDone={onDone} />);
    const file = new File(['x'], 'mine.nexmap');
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(doc)) });
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(s().projectName).toBe('Repaired');
    expect(s().racksAll()[0]!.ruHeight).toBe(1000);
    expect(s().flash).toBe(
      'Opened with 2 repairs: 1 image linked to an outside address was removed; 1 rack height was limited to 1000U.',
    );
  });
});
