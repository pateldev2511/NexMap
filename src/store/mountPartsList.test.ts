/** Mounting a pasted parts list: one undo step, real specs, standard names, honest report. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

describe('mountPartsList', () => {
  it('mounts every recognised unit, with catalog specs and ports, as one undo step', () => {
    const rackId = s().addRack('MDF');
    const r = s().mountPartsList(rackId, '2x Cisco Catalyst 9300-48P\nDell R750\nUPS\nmystery widget');
    expect(r).toEqual({ placed: 4, noRoom: 0, unknown: 1 });
    const mounted = s().devicesAll().filter((d) => d.rackId === rackId);
    const cisco = mounted.filter((d) => d.model === 'Catalyst 9300-48P');
    expect(cisco).toHaveLength(2);
    expect(cisco[0]).toMatchObject({ vendor: 'Cisco', watts: 715, weightKg: 6.6, ruSpan: 1 });
    expect(cisco[0]!.interfaces).toHaveLength(48);
    expect(mounted.find((d) => d.model === 'PowerEdge R750')).toMatchObject({ ruSpan: 2 });
    expect(mounted.find((d) => d.type === 'ups')!.ru).toBe(1); // heaviest at the bottom
    expect(new Set(mounted.map((d) => d.name)).size).toBe(4); // distinct names
    expect(s().flash).toBe('Mounted 4 devices in MDF — 1 line not recognised. ⌘Z undoes it.');
    s().undo();
    expect(s().devicesAll().filter((d) => d.rackId === rackId)).toHaveLength(0);
  });

  it('names follow a declared naming standard', () => {
    const rackId = s().addRack('MDF');
    s().addCustomRule('naming', 'switch', 'SW-#', 0);
    s().mountPartsList(rackId, '3x 48 port switch');
    expect(s().devicesAll().map((d) => d.name).sort()).toEqual(['SW-1', 'SW-2', 'SW-3']);
  });

  it('names gear for what it is, not its device type (a PDU is not "UPS 2")', () => {
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, 'UPS\nmetered PDU\ncable manager\nblanking panel');
    expect(s().devicesAll().map((d) => d.name).sort()).toEqual(['Blank', 'Cable manager', 'PDU', 'UPS']);
  });

  it('says what didn’t fit', () => {
    const rackId = s().addRack('Tiny');
    s().updateRack(rackId, { ruHeight: 42 }, { ruHeight: 2 });
    const r = s().mountPartsList(rackId, '3x Dell R650');
    expect(r).toEqual({ placed: 2, noRoom: 1, unknown: 0 });
    expect(s().flash).toBe("Mounted 2 devices in Tiny — 1 didn't fit. ⌘Z undoes it.");
  });

  it('a pasted vertical cable manager runs the front rail, full height, and dresses cords', () => {
    const rackId = s().addRack('MDF');
    const height = s().racksAll().find((r) => r.id === rackId)!.ruHeight;
    expect(s().mountPartsList(rackId, 'vertical cable manager')).toEqual({ placed: 1, noRoom: 0, unknown: 0 });
    const vm = s().devicesAll().find((d) => d.rackId === rackId)!;
    expect(vm).toMatchObject({ name: 'Vertical manager', mount: 'rail', side: 'front', ru: 1, ruSpan: height, rackAccessory: 'cable-manager' });
  });

  it('two pasted PDUs become the rear A and B feeds, with no rack collision', () => {
    const rackId = s().addRack('MDF');
    expect(s().mountPartsList(rackId, '2x metered PDU\nvertical cable manager')).toEqual({ placed: 3, noRoom: 0, unknown: 0 });
    const pdus = s().devicesAll().filter((d) => d.rackId === rackId && d.type === 'ups');
    expect(pdus.map((d) => [d.side, d.bay, d.ru])).toEqual([['rear', 'right', 1], ['rear', 'left', 1]]);
    s().runValidation();
    expect(s().issues.filter((i) => i.code === 'rack-ru-collision')).toEqual([]);
    expect(pdus.map((d) => d.powerFeed)).toEqual(['A', 'B']); // one PDU per feed
  });

  it('addPdu puts a PDU on the asked feed in a free rear channel, as one undo', () => {
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, 'metered PDU');
    const id = s().addPdu(rackId, 'B');
    const pdu = s().devicesAll().find((d) => d.id === id)!;
    expect(pdu).toMatchObject({ name: 'PDU B', mount: 'rail', side: 'rear', bay: 'left', ru: 1, powerFeed: 'B' });
    expect(pdu.interfaces).toHaveLength(8);
    s().undo();
    expect(s().devicesAll().some((d) => d.id === id)).toBe(false);
  });

  it('addPdu says so when every channel is full', () => {
    const rackId = s().addRack('MDF');
    s().mountPartsList(rackId, '4x vertical cable manager');
    expect(s().addPdu(rackId, 'A')).toBeNull();
    expect(s().flash).toMatch(/No free rail channel/);
  });
});

