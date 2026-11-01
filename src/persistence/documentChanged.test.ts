/**
 * Regression: declaring a rule changes the saved document (schema v6/v7) without
 * bumping the model `rev`, so autosave used to skip it until the next diagram edit.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { useProjectStore } from '@/store/projectStore';
import { documentChanged } from './usePersistence';

const s = () => useProjectStore.getState();

beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('documentChanged (autosave trigger)', () => {
  it('fires on a diagram edit', () => {
    const before = s();
    s().addDeviceAt('switch', 0, 0);
    expect(documentChanged(s(), before)).toBe(true);
  });

  it('fires when a built-in rule is declared or retracted', () => {
    const before = s();
    s().toggleInvariant('every-device-named');
    // Rule changes are undo steps now (so rev moves too), but autosave must not
    // depend on that: the rules themselves are part of the saved document.
    expect(documentChanged(s(), before)).toBe(true);
    expect(documentChanged({ ...s(), rev: before.rev }, before)).toBe(true);
  });

  it('fires when a custom rule is added or removed', () => {
    const before = s();
    s().addCustomRule('placement', 'camera', 'CCTV', 0);
    expect(documentChanged(s(), before)).toBe(true);
    const mid = s();
    s().removeCustomRule(s().customRules[0]!.id);
    expect(documentChanged(s(), mid)).toBe(true);
  });

  it('stays quiet for state that is not saved (selection, flash, validation)', () => {
    const id = s().addDeviceAt('switch', 0, 0);
    const before = s();
    s().select([id]);
    s().runValidation();
    expect(documentChanged(s(), before)).toBe(false);
  });
});
