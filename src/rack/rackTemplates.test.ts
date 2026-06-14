import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '@/store/projectStore';
import { RACK_TEMPLATES, templatesByTier, RACK_TIERS } from './rackTemplates';
import { presetByKey } from './rackDevicePresets';
import { catalogById } from './rackCatalog';
import { rackPresetById } from './rackTypes';
import { isFullDepth, slotsCollide, type Slot } from './rackModel';

const s = () => useProjectStore.getState();
const NOW = '2026-01-01T00:00:00.000Z';

describe('rack templates — data integrity', () => {
  it('covers every tier with at least one template', () => {
    for (const tier of RACK_TIERS) expect(templatesByTier(tier).length).toBeGreaterThan(0);
  });

  for (const t of RACK_TEMPLATES) {
    it(`${t.id}: presets resolve, devices fit, nothing collides`, () => {
      for (const r of t.racks) {
        const rp = rackPresetById(r.rackPresetId);
        expect(rp, `rack preset ${r.rackPresetId}`).toBeTruthy();
        const H = rp!.ruHeight;
        const slots: Slot[] = [];
        for (const dv of r.devices) {
          const p = presetByKey(dv.presetKey);
          expect(p, `device preset ${dv.presetKey}`).toBeTruthy();
          if (dv.catalogId) {
            const catalog = catalogById(dv.catalogId);
            expect(catalog, `catalog model ${dv.catalogId}`).toBeTruthy();
            expect(catalog!.type, `${dv.name} catalog type`).toBe(p!.type);
          }
          const mount = p!.mount ?? 'rack';
          if (mount !== 'rail') {
            expect(dv.ru, `${dv.name} ru in bounds`).toBeGreaterThanOrEqual(1);
            expect(dv.ru + p!.span - 1, `${dv.name} top in bounds`).toBeLessThanOrEqual(H);
          }
          slots.push({
            ru: dv.ru, ruSpan: p!.span, mount, side: dv.side ?? 'front', bay: 'full',
            depth: isFullDepth(p!.type) ? 'full' : 'shallow',
          });
        }
        // No two devices in the same rack physically collide.
        for (let i = 0; i < slots.length; i++)
          for (let j = i + 1; j < slots.length; j++)
            expect(slotsCollide(slots[i]!, slots[j]!), `${t.id}: device ${i} vs ${j} collide`).toBe(false);
      }
    });
  }
});

describe('applyRackTemplate (store)', () => {
  beforeEach(() => s().newProject(NOW));

  it('appends a template’s racks + placed, spec’d devices and is one undo', () => {
    const t = RACK_TEMPLATES.find((x) => x.id === 'home-lab-6u')!;
    const ids = s().applyRackTemplate(t);
    expect(ids).toHaveLength(1);
    expect(s().racksAll()).toHaveLength(1);

    const devs = s().devicesAll().filter((d) => d.rackId === ids[0]);
    expect(devs).toHaveLength(t.racks[0]!.devices.length);
    const sw = devs.find((d) => d.name === 'home-sw');
    expect(sw?.ru).toBe(5);
    expect(sw?.watts).toBeGreaterThan(0); // power spec populated from the preset
    expect(sw?.vendor).toBe('Netgear');
    expect(sw?.model).toBe('GS724T');

    s().undo();
    expect(s().racksAll()).toHaveLength(0);
    expect(s().devicesAll().filter((d) => d.rackId === ids[0])).toHaveLength(0);
  });

  it('appends to the end of an existing row (never destructive)', () => {
    s().addRack('Existing');
    const t = RACK_TEMPLATES[0]!;
    const before = s().racksAll().length;
    s().applyRackTemplate(t);
    expect(s().racksAll().length).toBe(before + t.racks.length);
  });
});
