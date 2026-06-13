import { describe, it, expect } from 'vitest';
import { RACK_CATALOG, catalogForType, catalogById, catalogSpecLabel } from './rackCatalog';

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
    expect(catalogSpecLabel(catalogById('cisco-c9300-48p')!)).toBe('1U · 48p · 715W · 6.6kg');
    expect(catalogSpecLabel(catalogById('apc-srt2200')!)).toBe('2U · 23kg'); // source: no ports/watts
  });
});
