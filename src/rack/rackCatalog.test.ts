import { describe, it, expect } from 'vitest';
import type { Device } from '@/model/types';
import {
  RACK_CATALOG,
  catalogById,
  catalogFields,
  catalogForDevice,
  catalogForType,
  catalogPatch,
  catalogSpecLabel,
  planCatalogDepths,
} from './rackCatalog';

describe('rack catalog — data integrity', () => {
  it('has unique ids and sane specs', () => {
    const ids = new Set<string>();
    for (const m of RACK_CATALOG) {
      expect(ids.has(m.id), `dup id ${m.id}`).toBe(false);
      ids.add(m.id);
      expect(m.span).toBeGreaterThanOrEqual(1);
      expect(m.ports).toBeGreaterThanOrEqual(0);
      expect(m.watts).toBeGreaterThanOrEqual(0);
      expect(m.weightKg).toBeGreaterThan(0);
      expect(m.vendor.length).toBeGreaterThan(0);
      expect(m.model.length).toBeGreaterThan(0);
      // A depth, when recorded, is a real chassis: patch panels ~30 mm, servers < 1 m.
      if (m.depthMm != null) expect(m.depthMm, m.id).toBeGreaterThanOrEqual(20);
      if (m.depthMm != null) expect(m.depthMm, m.id).toBeLessThanOrEqual(1000);
    }
  });

  it('UPS models are power sources (0 W draw)', () => {
    for (const m of catalogForType('ups')) expect(m.watts).toBe(0);
  });

  it('filters by type and looks up by id', () => {
    const switches = catalogForType('switch');
    expect(switches.length).toBeGreaterThan(0);
    expect(switches.every((m) => m.type === 'switch')).toBe(true);
    expect(catalogById('cisco-c9300-48p')?.watts).toBe(715);
    expect(catalogById('nope')).toBeUndefined();
  });

  it('spec label summarizes U / ports / watts / weight', () => {
    expect(catalogSpecLabel(catalogById('cisco-c9300-48p')!)).toBe('1U · 48p · 715W · 6.6kg · 449mm deep');
    expect(catalogSpecLabel(catalogById('apc-srt2200')!)).toBe('2U · 23kg · 584mm deep'); // source: no ports/watts
    expect(catalogSpecLabel(catalogById('panduit-48')!)).toBe('1U · 48p · 2.5kg'); // no sourced depth
  });
});

const dev = (over: Partial<Device>): Device => ({
  id: 'd', kind: 'device', type: 'server', name: 'n', x: 0, y: 0, width: 0, height: 0, layerId: 'L', ...over,
});

describe('rack catalog — depths', () => {
  it('every rack-mount active model records a datasheet depth', () => {
    const missing = RACK_CATALOG.filter((m) => m.type !== 'patch-panel' && !m.depthMm).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it('finds the model a device names, ignoring case and spacing, but never a near miss', () => {
    expect(catalogForDevice({ vendor: ' dell ', model: 'PowerEdge  R750' })?.id).toBe('dell-r750');
    expect(catalogForDevice({ vendor: 'Dell', model: 'R750' })).toBeUndefined();
    expect(catalogForDevice({ vendor: 'Dell' })).toBeUndefined();
  });

  it('plans depths only for named models that record none', () => {
    const fills = planCatalogDepths([
      dev({ id: 'a', vendor: 'Dell', model: 'PowerEdge R750' }),
      dev({ id: 'b', vendor: 'Dell', model: 'PowerEdge R750', depthMm: 700 }), // entered by hand
      dev({ id: 'c', vendor: 'Homebrew', model: 'Box' }),
      dev({ id: 'd', type: 'patch-panel', vendor: 'Panduit', model: '48-port Cat6 patch' }), // no sourced depth
    ]);
    expect(fills).toEqual([{ deviceId: 'a', depthMm: 758 }]);
  });

  it('applying a model brings its depth, and one without a depth clears the old one', () => {
    const r750 = catalogById('dell-r750')!;
    expect(catalogFields(r750)).toMatchObject({ vendor: 'Dell', model: 'PowerEdge R750', depthMm: 758 });
    const d = dev({ vendor: 'Dell', model: 'PowerEdge R750', watts: 1100, weightKg: 28, depthMm: 758 });
    const { before, after } = catalogPatch(d, catalogById('panduit-48')!);
    expect(before).toEqual({ vendor: 'Dell', model: 'PowerEdge R750', watts: 1100, weightKg: 28, depthMm: 758 });
    expect(after.depthMm).toBeUndefined();
    expect('depthMm' in after).toBe(true); // an explicit clear, so undo restores 758
  });
});
