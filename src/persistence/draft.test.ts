import { describe, it, expect } from 'vitest';
import { makeDraft, isRecoverable } from './draft';
import { createEmptyDocument, createDevice } from '@/model/schema';

const NOW = '2026-01-01T00:00:00.000Z';

describe('makeDraft', () => {
  it('captures project id, name, counts', () => {
    const doc = createEmptyDocument(NOW);
    doc.project = { ...doc.project, name: 'My Net' };
    doc.devices = [createDevice('router', 0, 0, doc.layers[0]!.id)];
    const draft = makeDraft(doc, 3, NOW);
    expect(draft.projectId).toBe(doc.project.id);
    expect(draft.name).toBe('My Net');
    expect(draft.generation).toBe(3);
    expect(draft.deviceCount).toBe(1);
  });
});

describe('isRecoverable', () => {
  it('false for null and empty docs', () => {
    expect(isRecoverable(null)).toBe(false);
    const empty = makeDraft(createEmptyDocument(NOW), 1, NOW);
    expect(isRecoverable(empty)).toBe(false);
  });

  it('true once there is content', () => {
    const doc = createEmptyDocument(NOW);
    doc.devices = [createDevice('switch', 0, 0, doc.layers[0]!.id)];
    expect(isRecoverable(makeDraft(doc, 1, NOW))).toBe(true);
  });
});
