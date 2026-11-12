/**
 * A rack is 1–1000U, whole, whichever layer sets it — so the user's own edit can
 * never produce a file the loader has to repair (it used to refuse it outright).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from './projectStore';
import { loadDocument } from '@/model/migrate';
import { TEMPLATES, buildTemplate } from '@/model/templates';
import { RACK_TEMPLATES } from '@/rack/rackTemplates';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();
beforeEach(() => s().newProject(NOW));

describe('updateRack clamps the height', () => {
  it('limits to a whole number of U between 1 and 1000, and the saved file reopens cleanly', () => {
    const id = s().addRack('MDF');
    const set = (h: number) => s().updateRack(id, { ruHeight: s().racksAll()[0]!.ruHeight }, { ruHeight: h });
    set(5000);
    expect(s().racksAll()[0]!.ruHeight).toBe(1000);
    const r = loadDocument(JSON.stringify(s().getDocument()));
    expect(r.ok).toBe(true);
    expect(r.ok && r.warnings).toBeUndefined();
    set(0);
    expect(s().racksAll()[0]!.ruHeight).toBe(1);
    set(-7);
    expect(s().racksAll()[0]!.ruHeight).toBe(1);
    set(41.6);
    expect(s().racksAll()[0]!.ruHeight).toBe(42);
    set(NaN);
    expect(s().racksAll()[0]!.ruHeight).toBe(1);
    // Other fields pass through untouched.
    s().updateRack(id, { name: 'MDF' }, { name: 'IDF' });
    expect(s().racksAll()[0]).toMatchObject({ name: 'IDF', ruHeight: 1 });
  });
});

describe('everything the app ships loads with no repairs and round-trips', () => {
  it('all templates', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(19);
    for (const t of TEMPLATES) {
      const built = JSON.parse(JSON.stringify(buildTemplate(t.key, NOW)));
      const r = loadDocument(JSON.stringify(built));
      expect(r.ok, t.key).toBe(true);
      if (!r.ok) continue;
      expect(r.warnings, t.key).toBeUndefined();
      expect(r.doc, t.key).toEqual(built);
      // …and through the store (what Save writes).
      s().loadDoc(r.doc);
      const saved = JSON.parse(JSON.stringify(s().getDocument()));
      const again = loadDocument(JSON.stringify(saved));
      expect(again.ok && again.warnings, t.key).toBeUndefined();
      expect(again.ok && again.doc, t.key).toEqual(saved);
    }
  });

  it('all rack templates', () => {
    expect(RACK_TEMPLATES.length).toBeGreaterThanOrEqual(7);
    for (const t of RACK_TEMPLATES) {
      s().newProject(NOW);
      s().applyRackTemplate(t);
      const saved = JSON.parse(JSON.stringify(s().getDocument()));
      expect(saved.racks.length, t.id).toBeGreaterThan(0);
      const r = loadDocument(JSON.stringify(saved));
      expect(r.ok, t.id).toBe(true);
      if (!r.ok) continue;
      expect(r.warnings, t.id).toBeUndefined();
      expect(r.doc, t.id).toEqual(saved);
    }
  });
});
