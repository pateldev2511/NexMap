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

  it('patches the ports a link names, then reports a named port another cable holds', () => {
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, '3x 24 port switch');
    const [sw1, sw2, sw3] = s().devicesAll().filter((d) => d.type === 'switch');
    const p = (d: typeof sw1, i: number) => d!.interfaces![i]!;
    s().connectRackCable({ deviceId: sw1!.id, ifaceId: p(sw1, 0).id }, { deviceId: sw2!.id, ifaceId: p(sw2, 0).id }, '#000', 'P-001');
    const named = s().connect(sw1!.id, sw2!.id)!;
    s().updateLink(named, {}, { sourceIfaceId: p(sw1, 1).id, targetIfaceId: p(sw2, 1).id });

    // A1↔B1 is cabled; the link wants A2↔B2 — that's a patch still to make.
    expect(s().patchFromTopology()).toBe(1);
    expect(s().rackCablesAll().find((c) => c.label === 'P-002')).toMatchObject({
      aEnd: { deviceId: sw1!.id, ifaceId: p(sw1, 1).id },
      bEnd: { deviceId: sw2!.id, ifaceId: p(sw2, 1).id },
    });
    expect(s().patchFromTopology()).toBe(0); // applying again adds no duplicate
    expect(s().rackCablesAll()).toHaveLength(2);

    const clash = s().connect(sw1!.id, sw3!.id)!;
    s().updateLink(clash, {}, { sourceIfaceId: p(sw1, 0).id });
    expect(s().patchFromTopology()).toBe(0);
    expect(s().flash).toBe(`Nothing patched — ${sw1!.name}:${p(sw1, 0).name} is already cabled (P-001) — free it or rename the link's port.`);
  });

  it('marks cable managers from the parts list and rack templates', () => {
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, '1U cable manager');
    s().applyRackTemplate(RACK_TEMPLATES.find((t) => t.id === 'ent-core-42u')!);
    const managers = s().devicesAll().filter((d) => d.rackAccessory === 'cable-manager');
    expect(managers.map((d) => d.name).sort()).toEqual(['Cable manager', 'cm-01', 'cm-02', 'cm-03']);
  });
});
