/**
 * First-class interfaces (schema v2): add/update/delete + cascade to link references.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('interface store actions', () => {
  it('adds an interface to a device', () => {
    const d = s().addDeviceAt('switch', 0, 0);
    const id = s().addInterface(d, 'Gi0/1');
    expect(id).toBeTruthy();
    const dev = s().devicesAll().find((x) => x.id === d)!;
    expect(dev.interfaces?.map((i) => i.name)).toEqual(['Gi0/1']);
  });

  it('renames an interface', () => {
    const d = s().addDeviceAt('switch', 0, 0);
    const id = s().addInterface(d)!;
    s().updateInterface(d, id, { name: 'Te1/1/1', speed: '10G' });
    const iface = s().devicesAll().find((x) => x.id === d)!.interfaces!.find((i) => i.id === id)!;
    expect(iface.name).toBe('Te1/1/1');
    expect(iface.speed).toBe('10G');
  });

  it('deleting an interface clears link endpoints that referenced it', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 200, 0);
    const ifaceA = s().addInterface(a, 'Gi0/1')!;
    const linkId = s().connect(a, b)!;
    // assign the interface to the link's source endpoint
    s().updateLink(linkId, { sourceIfaceId: undefined }, { sourceIfaceId: ifaceA, sourceInterface: 'Gi0/1' });
    expect(s().linksAll()[0]!.sourceIfaceId).toBe(ifaceA);

    s().deleteInterface(a, ifaceA);
    const dev = s().devicesAll().find((x) => x.id === a)!;
    expect(dev.interfaces).toEqual([]);
    const link = s().linksAll()[0]!;
    expect(link.sourceIfaceId).toBeUndefined();
    expect(link.sourceInterface).toBeUndefined();
    // the link itself survives — only the port reference is cleared
    expect(s().linksAll()).toHaveLength(1);
  });

  it('delete-interface cascade is one undoable step', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('server', 200, 0);
    const ifaceA = s().addInterface(a, 'Gi0/1')!;
    const linkId = s().connect(a, b)!;
    s().updateLink(linkId, {}, { sourceIfaceId: ifaceA, sourceInterface: 'Gi0/1' });

    s().deleteInterface(a, ifaceA);
    s().undo();
    const dev = s().devicesAll().find((x) => x.id === a)!;
    expect(dev.interfaces?.map((i) => i.id)).toEqual([ifaceA]);
    expect(s().linksAll()[0]!.sourceIfaceId).toBe(ifaceA);
  });
});
