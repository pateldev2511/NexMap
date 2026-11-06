/** Datasheet depths reach placed gear, so depth-fit has something to judge. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { RACK_CATALOG } from '@/rack/rackCatalog';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

/** The deepest server the catalog knows a depth for. */
const deepServer = () =>
  RACK_CATALOG.filter((m) => m.type === 'server' && m.depthMm).sort((a, b) => b.depthMm! - a.depthMm!)[0]!;

describe('catalog depths', () => {
  it('a pasted parts list stamps the datasheet depth on each unit', () => {
    const m = deepServer();
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, `${m.vendor} ${m.model}`);
    const placed = s().devicesAll().find((d) => d.model === m.model)!;
    expect(placed.depthMm).toBe(m.depthMm);
  });

  it('so a server too deep for a wall rack is flagged as soon as it is pasted', () => {
    const m = deepServer();
    const rackId = s().addRack('Wall');
    s().updateRack(rackId, { depthMm: undefined }, { depthMm: 400 });
    s().mountPartsList(rackId, `${m.vendor} ${m.model}`);
    s().runValidation();
    expect(s().issues.some((i) => i.code === 'rack-depth-overflow')).toBe(true);
  });

  it('fills depths for gear that names a catalog model but records none, as one undo', () => {
    const m = deepServer();
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, `${m.vendor} ${m.model}\n1U server`);
    const named = s().devicesAll().find((d) => d.model === m.model)!;
    const generic = s().devicesAll().find((d) => d.id !== named.id)!;
    // An older document: the model is named, but no depth was recorded.
    s().updateDevice(named.id, { depthMm: m.depthMm }, { depthMm: undefined });
    s().endEdit();

    expect(s().fillDepthsFromCatalog()).toBe(1);
    expect(s().devicesAll().find((d) => d.id === named.id)!.depthMm).toBe(m.depthMm);
    expect(s().devicesAll().find((d) => d.id === generic.id)!.depthMm).toBeUndefined();
    expect(s().flash).toBe('Filled datasheet depths for 1 device. ⌘Z undoes it.');
    s().undo();
    expect(s().devicesAll().find((d) => d.id === named.id)!.depthMm).toBeUndefined();
  });

  it('never overwrites a depth someone entered, and says when there is nothing to fill', () => {
    const m = deepServer();
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, `${m.vendor} ${m.model}`);
    const named = s().devicesAll().find((d) => d.model === m.model)!;
    s().updateDevice(named.id, { depthMm: m.depthMm }, { depthMm: 612 });
    s().endEdit();
    expect(s().fillDepthsFromCatalog()).toBe(0);
    expect(s().devicesAll().find((d) => d.id === named.id)!.depthMm).toBe(612);
    expect(s().flash).toMatch(/^No devices to fill/);
  });
});
