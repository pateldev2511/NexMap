/** Blueprint is a view style like iso: view-level, not undoable, remembered by saved views. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from './projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('blueprint view', () => {
  it('is remembered by a saved view and restored when the view is applied', () => {
    s().setProjection('blueprint');
    const id = s().addView('Print sheet');
    expect(s().getDocument().views.find((v) => v.id === id)?.projection).toBe('blueprint');

    s().setProjection('iso');
    s().applyView(id);
    expect(s().projection).toBe('blueprint');
  });

  it('never enters the undo history', () => {
    s().addDeviceAt('router', 0, 0);
    s().setProjection('blueprint');
    s().undo();
    expect(s().projection).toBe('blueprint');
    expect(s().devicesAll()).toHaveLength(0);
  });
});
