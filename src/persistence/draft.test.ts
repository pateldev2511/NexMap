import { describe, it, expect, vi } from 'vitest';
import {
  clearStashedDraft,
  describeWork,
  hasMeaningfulWork,
  isRecoverable,
  makeDraft,
  pickRecoverable,
  readStashedDraft,
  stashDraftSync,
} from './draft';
import {
  createEmptyDocument,
  createDevice,
  createImageObject,
  createRack,
  createShapeObject,
  createTextObject,
} from '@/model/schema';
import { resetPrefsMemoryForTests } from '@/lib/prefs';
import type { NexMapDocument } from '@/model/types';

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

  // #20: the launch check used to look at devices and links only.
  it('true for zero-device work: a note, a shape, an image, an empty rack, an IP plan, a rule', () => {
    const layerId = (doc: NexMapDocument) => doc.layers[0]!.id;
    const cases: [string, (doc: NexMapDocument) => void, string][] = [
      ['note', (d) => d.objects.push(createTextObject(0, 0, layerId(d))), '1 note'],
      ['shape', (d) => d.objects.push(createShapeObject(0, 0, 40, 40, layerId(d))), '1 shape'],
      [
        'image',
        (d) => d.objects.push(createImageObject(0, 0, 10, 10, layerId(d), 'data:image/png;base64,AA')),
        '1 image',
      ],
      ['rack', (d) => d.racks.push(createRack('MDF')), '1 rack'],
      ['subnet', (d) => d.subnets.push({ id: 's', cidr: '10.0.0.0/24' }), '1 subnet'],
      ['vlan', (d) => d.vlans.push({ id: 'v', vlanId: 10, name: 'Users' }), '1 VLAN'],
      ['rule', (d) => d.invariants.push('every-device-named'), '1 rule'],
    ];
    for (const [what, add, summary] of cases) {
      const doc = createEmptyDocument(NOW);
      add(doc);
      expect(hasMeaningfulWork(doc), what).toBe(true);
      expect(isRecoverable(makeDraft(doc, 1, NOW)), what).toBe(true);
      expect(describeWork(doc), what).toBe(summary);
    }
  });

  it('a renamed but otherwise blank project is not recoverable work', () => {
    const doc = createEmptyDocument(NOW);
    doc.project = { ...doc.project, name: 'Renamed' };
    expect(isRecoverable(makeDraft(doc, 1, NOW))).toBe(false);
  });

  it('tolerates a draft from an older build that lacks newer collections', () => {
    const doc = createEmptyDocument(NOW) as unknown as Record<string, unknown>;
    delete doc.rackCables;
    delete doc.customRules;
    delete doc.objects;
    expect(hasMeaningfulWork(doc as unknown as NexMapDocument)).toBe(false);
  });
});

describe('pickRecoverable', () => {
  it('a newer blank draft does not hide an older real one', () => {
    const real = createEmptyDocument(NOW);
    real.racks.push(createRack('MDF'));
    const blank = createEmptyDocument(NOW);
    const older = makeDraft(real, 1, '2026-01-01T00:00:00.000Z');
    const newer = makeDraft(blank, 2, '2026-01-02T00:00:00.000Z');
    expect(pickRecoverable([newer, older])).toBe(older);
  });

  it('prefers the newest of several recoverable drafts, and null when none qualify', () => {
    const a = createEmptyDocument(NOW);
    a.racks.push(createRack('A'));
    const b = createEmptyDocument(NOW);
    b.objects.push(createTextObject(0, 0, b.layers[0]!.id));
    const da = makeDraft(a, 1, '2026-01-01T00:00:00.000Z');
    const db = makeDraft(b, 1, '2026-01-03T00:00:00.000Z');
    expect(pickRecoverable([da, db])).toBe(db);
    expect(pickRecoverable([makeDraft(createEmptyDocument(NOW), 1, NOW)])).toBeNull();
  });
});

describe('unload stash', () => {
  it('round-trips a draft through the synchronous stash', () => {
    const doc = createEmptyDocument(NOW);
    doc.project = { ...doc.project, name: 'Last edit' };
    const draft = makeDraft(doc, 1, NOW);
    expect(stashDraftSync(draft)).toBe(true);
    expect(readStashedDraft()?.name).toBe('Last edit');
    clearStashedDraft();
    expect(readStashedDraft()).toBeNull();
  });

  it('reports failure when storage refuses the write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      expect(stashDraftSync(makeDraft(createEmptyDocument(NOW), 1, NOW))).toBe(false);
    } finally {
      spy.mockRestore();
      resetPrefsMemoryForTests();
    }
  });
});
