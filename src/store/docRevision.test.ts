/**
 * Document identity + revision (#17, #18): every loadDoc is a new identity, every
 * document change a new revision, and markSaved clears only the exact
 * identity + revision a save serialized.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { onBeforeDocumentSwap, useProjectStore } from './projectStore';
import { createEmptyDocument } from '@/model/schema';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('docIdentity / docRevision', () => {
  it('every load is a new identity with a clean, zero revision', () => {
    const before = s().docIdentity;
    s().addDeviceAt('switch', 0, 0);
    s().loadDoc(createEmptyDocument(NOW));
    expect(s().docIdentity).toBe(before + 1);
    expect(s().docRevision).toBe(0);
    expect(s().dirty).toBe(false);
    s().newProject(NOW);
    expect(s().docIdentity).toBe(before + 2);
  });

  it('edits, rule changes, undo and redo all advance the revision', () => {
    const r0 = s().docRevision;
    s().addDeviceAt('switch', 0, 0);
    const r1 = s().docRevision;
    expect(r1).toBeGreaterThan(r0);
    s().toggleInvariant('every-device-named');
    const r2 = s().docRevision;
    expect(r2).toBeGreaterThan(r1);
    s().undo();
    expect(s().docRevision).toBeGreaterThan(r2);
    const r3 = s().docRevision;
    s().redo();
    expect(s().docRevision).toBeGreaterThan(r3);
  });

  it('selection and validation do not', () => {
    const id = s().addDeviceAt('switch', 0, 0);
    const r = s().docRevision;
    s().select([id]);
    s().runValidation();
    expect(s().docRevision).toBe(r);
  });
});

describe('markSaved', () => {
  it('clears only the revision that was written', () => {
    s().renameProject(s().projectName, 'A');
    const saved = { identity: s().docIdentity, revision: s().docRevision };
    s().renameProject('A', 'A, edited during the write');
    expect(s().markSaved(saved)).toBe(false);
    expect(s().dirty).toBe(true);
    expect(s().markSaved({ identity: s().docIdentity, revision: s().docRevision })).toBe(true);
    expect(s().dirty).toBe(false);
  });

  it('a save of another document never clears this one', () => {
    const saved = { identity: s().docIdentity, revision: s().docRevision };
    s().newProject(NOW);
    s().renameProject(s().projectName, 'B');
    expect(s().markSaved({ ...saved })).toBe(false);
    expect(s().dirty).toBe(true);
  });

  it('without a revision it clears unconditionally (legacy callers)', () => {
    s().addDeviceAt('switch', 0, 0);
    expect(s().markSaved()).toBe(true);
    expect(s().dirty).toBe(false);
  });
});

describe('onBeforeDocumentSwap', () => {
  it('runs while the outgoing document is still readable', () => {
    s().renameProject(s().projectName, 'Outgoing');
    const seen: string[] = [];
    const off = onBeforeDocumentSwap(() => seen.push(s().getDocument().project.name));
    s().loadDoc(createEmptyDocument(NOW));
    off();
    s().loadDoc(createEmptyDocument(NOW));
    expect(seen).toEqual(['Outgoing']);
  });
});
