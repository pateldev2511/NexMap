/**
 * Bulk pass-through pairing (W3): one undoable edit, idempotent, and refused on
 * device types the trace engine would never walk through. Also asserts an
 * end-to-end trace over store-built state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { traceFrom } from '@/rack/cableTrace';
import { couplingProblems } from '@/model/coupling';
import { useProjectStore } from './projectStore';

import type { Slot } from '@/rack/rackModel';

const NOW = '2026-01-01T00:00:00.000Z';

/** A full Slot — `placeInRack` needs every field, including derived depth/span. */
const slot = (ru: number, depth: Slot['depth'] = 'shallow'): Slot => ({
  ru,
  ruSpan: 1,
  mount: 'rack',
  side: 'front',
  bay: 'full',
  depth,
});
const s = () => useProjectStore.getState();
const dev = (id: string) => s().devicesAll().find((d) => d.id === id)!;

beforeEach(() => s().newProject(NOW));

/** A patch panel with `n` front ports, as the rack library preset would create it. */
function frontOnlyPanel(n: number): string {
  const id = s().addDeviceAt('patch-panel', 0, 0);
  for (let i = 1; i <= n; i++) s().addInterface(id, `${i}`);
  return id;
}

describe('pairPassThrough', () => {
  it('mirrors front ports into coupled rear ports', () => {
    const pp = frontOnlyPanel(3);
    expect(s().pairPassThrough(pp)).toEqual({ created: 3, coupled: 0 });

    const ifaces = dev(pp).interfaces!;
    expect(ifaces).toHaveLength(6);
    const fronts = ifaces.filter((i) => i.side === 'front');
    const rears = ifaces.filter((i) => i.side === 'rear');
    expect(fronts).toHaveLength(3);
    expect(rears).toHaveLength(3);
    // Every pair is symmetric — no validation faults.
    expect(couplingProblems([dev(pp)])).toEqual([]);
  });

  it('names rear ports uniquely from the front port name', () => {
    const pp = frontOnlyPanel(2);
    s().pairPassThrough(pp);
    const names = dev(pp).interfaces!.map((i) => i.name);
    expect(names).toEqual(['1', '2', '1r', '2r']);
    // Uniqueness matters for cable schedules and CSV export.
    expect(new Set(names).size).toBe(names.length);
  });

  it('is ONE undoable edit for the whole panel', () => {
    const pp = frontOnlyPanel(24);
    expect(s().pairPassThrough(pp)).toEqual({ created: 24, coupled: 0 });
    expect(dev(pp).interfaces).toHaveLength(48);
    s().undo();
    expect(dev(pp).interfaces).toHaveLength(24);
    expect(dev(pp).interfaces!.every((i) => i.throughTo === undefined)).toBe(true);
    s().redo();
    expect(dev(pp).interfaces).toHaveLength(48);
  });

  it('is idempotent — running twice changes nothing', () => {
    const pp = frontOnlyPanel(4);
    s().pairPassThrough(pp);
    const after = dev(pp).interfaces!;
    expect(s().pairPassThrough(pp)).toEqual({ created: 0, coupled: 0 });
    expect(dev(pp).interfaces).toEqual(after);
  });

  it('couples pre-existing rear ports instead of creating duplicates', () => {
    const pp = s().addDeviceAt('patch-panel', 0, 0);
    const f1 = s().addInterface(pp, '1')!;
    const r1 = s().addInterface(pp, '1r')!;
    s().updateInterface(pp, f1, { side: 'front' });
    s().updateInterface(pp, r1, { side: 'rear' });

    expect(s().pairPassThrough(pp)).toEqual({ created: 0, coupled: 1 });
    expect(dev(pp).interfaces).toHaveLength(2);
    const front = dev(pp).interfaces!.find((i) => i.id === f1)!;
    expect(front.throughTo).toBe(r1);
  });

  it('carries the media kind onto the rear port but not usage fields', () => {
    const pp = s().addDeviceAt('patch-panel', 0, 0);
    const f1 = s().addInterface(pp, '1')!;
    s().updateInterface(pp, f1, { kind: 'LC/UPC', speed: '10G', vlan: 20 });
    s().pairPassThrough(pp);
    const rear = dev(pp).interfaces!.find((i) => i.side === 'rear')!;
    expect(rear.kind).toBe('LC/UPC');
    expect(rear.speed).toBeUndefined();
    expect(rear.vlan).toBeUndefined();
  });

  it('REFUSES a switch — the trace engine would never walk through it', () => {
    const sw = s().addDeviceAt('switch', 0, 0);
    s().addInterface(sw, 'Gi0/1');
    expect(s().pairPassThrough(sw)).toBeNull();
    expect(dev(sw).interfaces).toHaveLength(1);
  });

  it('returns null for an unknown device', () => {
    expect(s().pairPassThrough('ghost')).toBeNull();
  });

  it('an empty panel is a no-op, not an error', () => {
    const pp = s().addDeviceAt('patch-panel', 0, 0);
    expect(s().pairPassThrough(pp)).toEqual({ created: 0, coupled: 0 });
  });

  it('a refused call leaves no undo entry', () => {
    const sw = s().addDeviceAt('switch', 0, 0);
    s().pairPassThrough(sw);
    s().undo(); // undoes the addInterface-free addDeviceAt
    expect(s().devicesAll()).toHaveLength(0);
  });
});

describe('validation wiring', () => {
  const codes = () => s().issues.map((i) => i.code);

  it('a freshly paired panel is clean', () => {
    const pp = frontOnlyPanel(4);
    s().pairPassThrough(pp);
    expect(codes().filter((c) => c.startsWith('port-coupling-'))).toEqual([]);
  });

  it('flags a one-sided coupling as an error', () => {
    const pp = frontOnlyPanel(2);
    s().pairPassThrough(pp);
    // Break one half the way a hand-edited file could.
    const front = dev(pp).interfaces!.find((i) => i.side === 'front')!;
    const rear = dev(pp).interfaces!.find((i) => i.throughTo === front.id)!;
    s().updateInterface(pp, rear.id, { throughTo: undefined });
    s().runValidation();
    expect(codes()).toContain('port-coupling-asymmetric');
    expect(s().issues.find((i) => i.code === 'port-coupling-asymmetric')!.severity).toBe('error');
  });

  it('flags a self-reference', () => {
    const pp = frontOnlyPanel(1);
    const f = dev(pp).interfaces![0]!;
    s().updateInterface(pp, f.id, { throughTo: f.id });
    s().runValidation();
    expect(codes()).toContain('port-coupling-self');
  });

  it('flags a dangling coupling target', () => {
    const pp = frontOnlyPanel(1);
    const f = dev(pp).interfaces![0]!;
    s().updateInterface(pp, f.id, { throughTo: 'ghost' });
    s().runValidation();
    expect(codes()).toContain('port-coupling-missing');
  });

  it('deleting a rear port leaves the front flagged, not silently broken', () => {
    const pp = frontOnlyPanel(1);
    s().pairPassThrough(pp);
    const rear = dev(pp).interfaces!.find((i) => i.side === 'rear')!;
    s().deleteInterface(pp, rear.id);
    s().runValidation();
    expect(codes()).toContain('port-coupling-missing');
  });
});

describe('end-to-end trace over store state', () => {
  it('traces switch → panel → wall port through a store-built panel', () => {
    const sw = s().addDeviceAt('switch', 0, 0);
    const swPort = s().addInterface(sw, 'Gi0/1')!;
    const pp = frontOnlyPanel(1);
    s().pairPassThrough(pp);
    const wall = s().addDeviceAt('generic', 400, 0);
    const wallPort = s().addInterface(wall, 'F830/01')!;

    const front = dev(pp).interfaces!.find((i) => i.side === 'front')!;
    const rear = dev(pp).interfaces!.find((i) => i.side === 'rear')!;

    // Mount everything so the physical cabling is legal.
    const rack = s().addRack('RK001');
    [sw, pp, wall].forEach((id, i) => {
      s().placeInRack(id, rack, slot(i + 1));
    });
    const c1 = s().connectRackCable(
      { deviceId: sw, ifaceId: swPort },
      { deviceId: pp, ifaceId: front.id },
      '#22d3ee',
    );
    const c2 = s().connectRackCable(
      { deviceId: pp, ifaceId: rear.id },
      { deviceId: wall, ifaceId: wallPort },
      '#22d3ee',
    );
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();

    const r = traceFrom(s().devicesAll(), s().rackCablesAll(), {
      deviceId: sw,
      ifaceId: swPort,
    });
    expect(r.end).toBe('terminated');
    expect(r.hops.map((h) => `${h.deviceId}/${h.ifaceId}`)).toEqual([
      `${sw}/${swPort}`,
      `${pp}/${front.id}`,
      `${pp}/${rear.id}`,
      `${wall}/${wallPort}`,
    ]);
  });

  it('E9: deleting the panel mid-chain makes the trace stop honestly', () => {
    const sw = s().addDeviceAt('switch', 0, 0);
    const swPort = s().addInterface(sw, 'Gi0/1')!;
    const pp = frontOnlyPanel(1);
    s().pairPassThrough(pp);
    const front = dev(pp).interfaces!.find((i) => i.side === 'front')!;
    const rack = s().addRack('RK001');
    s().placeInRack(sw, rack, slot(1));
    s().placeInRack(pp, rack, slot(2));
    s().connectRackCable(
      { deviceId: sw, ifaceId: swPort },
      { deviceId: pp, ifaceId: front.id },
      '#22d3ee',
    );

    s().select([pp]);
    s().deleteSelection();

    const r = traceFrom(s().devicesAll(), s().rackCablesAll(), {
      deviceId: sw,
      ifaceId: swPort,
    });
    // The cascade prunes the cable, so the switch port simply has nothing plugged in.
    expect(r.end).toBe('open');
    expect(r.hops).toHaveLength(1);
  });
});
