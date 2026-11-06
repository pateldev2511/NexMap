/** Patch schedule from the topology, and cable managers marked wherever they're created. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { RACK_TEMPLATES } from '@/rack/rackTemplates';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

describe('patchFromTopology', () => {
  it('cables links between racked gear in one undo step, and says what stayed logical', () => {
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, '2x 24 port switch\ncable manager');
    const [sw1, sw2] = s().devicesAll().filter((d) => d.type === 'switch');
    const pc = s().addDeviceAt('end-user', 0, 0);
    s().connect(sw1!.id, sw2!.id);
    s().connect(sw1!.id, pc);

    expect(s().patchFromTopology()).toBe(1);
    const [c] = s().rackCablesAll();
    expect(c).toMatchObject({ label: 'P-001', lengthFt: 5 });
    expect(s().flash).toBe('Patched 1 link as P-001 — 1 link has an end outside a rack. ⌘Z undoes it.');

    expect(s().patchFromTopology()).toBe(0);
    expect(s().flash).toBe('Every link between racked gear already has a cable — 1 link has an end outside a rack.');
    s().undo();
    expect(s().rackCablesAll()).toEqual([]);
  });

  it('marks cable managers from the parts list and rack templates', () => {
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, '1U cable manager');
    s().applyRackTemplate(RACK_TEMPLATES.find((t) => t.id === 'ent-core-42u')!);
    const managers = s().devicesAll().filter((d) => d.rackAccessory === 'cable-manager');
    expect(managers.map((d) => d.name).sort()).toEqual(['Cable manager', 'cm-01', 'cm-02', 'cm-03']);
  });
});
