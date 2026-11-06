import { describe, it, expect } from 'vitest';
import {
  slotOf,
  topU,
  baysConflict,
  uRangesOverlap,
  slotsCollide,
  inBounds,
  canFit,
  firstFreeU,
  nearestFreeU,
  nearestFreeRail,
  railChannel,
  isFullDepth,
  orderRacks,
  type Slot,
} from './rackModel';
import type { Device, Rack } from '@/model/types';

const rk = (id: string, order?: number): Rack => ({ id, name: id, ruHeight: 42, order });

describe('orderRacks — row order', () => {
  it('falls back to insertion order when no order field is set', () => {
    expect(orderRacks([rk('a'), rk('b'), rk('c')]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('honors explicit order, and keeps unordered racks stable around them', () => {
    // swap b and c by giving them explicit orders (the reorder gesture's effect)
    expect(orderRacks([rk('a'), rk('b', 2), rk('c', 1)]).map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = [rk('a', 1), rk('b', 0)];
    orderRacks(input);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

const rack = (over: Partial<Rack> = {}): Rack => ({
  id: 'r1',
  name: 'MDF',
  ruHeight: 42,
  ...over,
});

const dev = (over: Partial<Device> = {}): Device => ({
  id: 'd' + Math.random().toString(36).slice(2),
  kind: 'device',
  type: 'switch',
  name: 'sw',
  x: 0,
  y: 0,
  width: 56,
  height: 40,
  layerId: 'L',
  rackId: 'r1',
  ru: 1,
  ruSpan: 1,
  ...over,
});

const slot = (over: Partial<Slot> = {}): Slot => ({
  ru: 1,
  ruSpan: 1,
  mount: 'rack',
  side: 'front',
  bay: 'full',
  depth: 'full',
  ...over,
});

describe('slotOf — v2 back-compat defaults', () => {
  it('defaults mount/side/bay for a legacy racked device', () => {
    const s = slotOf(dev({ ru: 40, ruSpan: 2, mount: undefined, side: undefined, bay: undefined }));
    expect(s).toEqual({ ru: 40, ruSpan: 2, mount: 'rack', side: 'front', bay: 'full', depth: 'full' });
  });
  it('clamps ruSpan to >= 1 and defaults ru to 1', () => {
    expect(slotOf(dev({ ru: undefined, ruSpan: 0 }))).toMatchObject({ ru: 1, ruSpan: 1 });
  });
});

describe('topU', () => {
  it('1U at ru=40 tops at 40', () => expect(topU({ ru: 40, ruSpan: 1 })).toBe(40));
  it('2U at ru=40 tops at 41', () => expect(topU({ ru: 40, ruSpan: 2 })).toBe(41));
});

describe('baysConflict', () => {
  it('full conflicts with everything', () => {
    expect(baysConflict('full', 'full')).toBe(true);
    expect(baysConflict('full', 'left')).toBe(true);
    expect(baysConflict('right', 'full')).toBe(true);
  });
  it('same half conflicts, opposite halves do not', () => {
    expect(baysConflict('left', 'left')).toBe(true);
    expect(baysConflict('left', 'right')).toBe(false);
  });
});

describe('uRangesOverlap', () => {
  it('adjacent non-overlapping ranges are clear', () => {
    expect(uRangesOverlap(slot({ ru: 1, ruSpan: 1 }), slot({ ru: 2, ruSpan: 1 }))).toBe(false);
  });
  it('a 2U device overlaps a 1U sitting on its top unit', () => {
    expect(uRangesOverlap(slot({ ru: 40, ruSpan: 2 }), slot({ ru: 41, ruSpan: 1 }))).toBe(true);
  });
});

describe('isFullDepth', () => {
  it('treats switches/servers/firewalls/UPS as full-depth (block both faces)', () => {
    for (const t of ['switch', 'router', 'server', 'storage', 'firewall', 'ups'] as const) {
      expect(isFullDepth(t)).toBe(true);
    }
  });
  it('treats patch panels as shallow (can share a U front+rear)', () => {
    expect(isFullDepth('patch-panel')).toBe(false);
  });
});

describe('slotsCollide', () => {
  it('two full-depth chassis on opposite faces DO collide (they fill the U front-to-rear)', () => {
    expect(slotsCollide(slot({ side: 'front', depth: 'full' }), slot({ side: 'rear', depth: 'full' }))).toBe(true);
  });
  it('shallow gear on opposite faces shares the U (patch front + PDU/blank rear)', () => {
    expect(slotsCollide(slot({ side: 'front', depth: 'shallow' }), slot({ side: 'rear', depth: 'shallow' }))).toBe(false);
    // one shallow + one full on opposite faces still fits — the shallow one leaves room
    expect(slotsCollide(slot({ side: 'front', depth: 'full' }), slot({ side: 'rear', depth: 'shallow' }))).toBe(false);
  });
  it('opposite-face full-depth only collide where their U ranges overlap', () => {
    expect(slotsCollide(slot({ side: 'front', ru: 1 }), slot({ side: 'rear', ru: 5 }))).toBe(false);
  });
  it('same U + full bay collide', () => {
    expect(slotsCollide(slot({ ru: 5 }), slot({ ru: 5 }))).toBe(true);
  });
  it('half-width left + right in same U do NOT collide', () => {
    expect(slotsCollide(slot({ ru: 5, bay: 'left' }), slot({ ru: 5, bay: 'right' }))).toBe(false);
  });
  it('half-width left + left in same U collide', () => {
    expect(slotsCollide(slot({ ru: 5, bay: 'left' }), slot({ ru: 5, bay: 'left' }))).toBe(true);
  });
  it('two rail items on the same side collide; rail + rack do not', () => {
    expect(slotsCollide(slot({ mount: 'rail' }), slot({ mount: 'rail' }))).toBe(true);
    expect(slotsCollide(slot({ mount: 'rail' }), slot({ mount: 'rack' }))).toBe(false);
  });
});

describe('rail channels — left and right per face, by height', () => {
  const rail = (over: Partial<Slot> = {}) => slot({ mount: 'rail', ruSpan: 6, ...over });
  it('a legacy full-bay rail item sits in the right channel', () => {
    expect(railChannel(rail())).toBe('right');
    expect(railChannel(rail({ bay: 'right' }))).toBe('right');
    expect(railChannel(rail({ bay: 'left' }))).toBe('left');
    expect(slotsCollide(rail({ ru: 1 }), rail({ ru: 1, bay: 'right' }))).toBe(true);
  });
  it('left and right channels of one face are independent (A and B feeds)', () => {
    expect(slotsCollide(rail({ ru: 1, bay: 'left' }), rail({ ru: 1, bay: 'right' }))).toBe(false);
    expect(slotsCollide(rail({ ru: 1, bay: 'left' }), rail({ ru: 1 }))).toBe(false);
  });
  it('two items in one channel stack when their U ranges do not overlap', () => {
    expect(slotsCollide(rail({ ru: 1 }), rail({ ru: 7 }))).toBe(false); // U1–6 and U7–12
    expect(slotsCollide(rail({ ru: 1 }), rail({ ru: 6 }))).toBe(true); // share U6
  });
  it('opposite faces never share a channel', () => {
    expect(slotsCollide(rail({ ru: 1 }), rail({ ru: 1, side: 'rear' }))).toBe(false);
  });
  it('canFit lets a second PDU into the free channel of the same face', () => {
    const r = rack({ ruHeight: 24 });
    const pdu = dev({ id: 'p1', ru: 1, ruSpan: 6, mount: 'rail', side: 'rear' });
    expect(canFit(r, [pdu], rail({ ru: 1, side: 'rear' })).ok).toBe(false);
    expect(canFit(r, [pdu], rail({ ru: 1, side: 'rear', bay: 'left' })).ok).toBe(true);
  });
});

describe('nearestFreeRail', () => {
  const r = rack({ ruHeight: 24 });
  const at = (ru: number, bay: 'full' | 'left' | 'right', span = 6) =>
    dev({ id: `${bay}${ru}`, ru, ruSpan: span, mount: 'rail', side: 'rear', bay });
  it('prefers the right channel when both are free', () => {
    expect(nearestFreeRail(r, [], 6, 1, 'rear')).toEqual({ ru: 1, bay: 'right' });
  });
  it('falls to the left channel when the right is taken at the target', () => {
    expect(nearestFreeRail(r, [at(1, 'right')], 6, 1, 'rear')).toEqual({ ru: 1, bay: 'left' });
  });
  it('a pinned channel stays pinned, stacking above what is there', () => {
    expect(nearestFreeRail(r, [at(1, 'right')], 6, 1, 'rear', 'right')).toEqual({ ru: 7, bay: 'right' });
  });
  it('returns null when neither channel has room', () => {
    expect(nearestFreeRail(r, [at(1, 'right', 24), at(1, 'left', 24)], 6, 1, 'rear')).toBeNull();
  });
});

describe('inBounds', () => {
  it('rejects a 2U device whose top exceeds the rack', () => {
    expect(inBounds(rack({ ruHeight: 42 }), slot({ ru: 42, ruSpan: 2 }))).toBe(false);
  });
  it('accepts a 2U device flush with the top', () => {
    expect(inBounds(rack({ ruHeight: 42 }), slot({ ru: 41, ruSpan: 2 }))).toBe(true);
  });
  it('rail items are exempt from U-bounds', () => {
    expect(inBounds(rack({ ruHeight: 6 }), slot({ ru: 99, mount: 'rail' }))).toBe(true);
  });
});

describe('canFit', () => {
  const r = rack();
  it('fits into an empty rack', () => {
    expect(canFit(r, [], slot({ ru: 10 }))).toEqual({ ok: true });
  });
  it('rejects out-of-bounds', () => {
    expect(canFit(r, [], slot({ ru: 42, ruSpan: 2 }))).toEqual({ ok: false, reason: 'out-of-bounds' });
  });
  it('rejects invalid span', () => {
    expect(canFit(r, [], slot({ ruSpan: 0 }))).toEqual({ ok: false, reason: 'invalid' });
  });
  it('rejects an occupied U (full vs full)', () => {
    const occ = dev({ ru: 10, ruSpan: 1 });
    expect(canFit(r, [occ], slot({ ru: 10 }))).toEqual({ ok: false, reason: 'occupied' });
  });
  it('reports bay-conflict when a full device meets a half-occupied U', () => {
    const occ = dev({ ru: 10, bay: 'left' });
    expect(canFit(r, [occ], slot({ ru: 10, bay: 'full' }))).toEqual({ ok: false, reason: 'bay-conflict' });
  });
  it('lets a right-bay device share a U with a left-bay device', () => {
    const occ = dev({ ru: 10, bay: 'left' });
    expect(canFit(r, [occ], slot({ ru: 10, bay: 'right' }))).toEqual({ ok: true });
  });
  it('ignoreId lets a device move without colliding with itself', () => {
    const self = dev({ id: 'self', ru: 10 });
    expect(canFit(r, [self], slot({ ru: 10 }), 'self')).toEqual({ ok: true });
  });
  it('ignores occupants in other racks', () => {
    const other = dev({ id: 'o', rackId: 'r2', ru: 10 });
    expect(canFit(r, [other], slot({ ru: 10 }))).toEqual({ ok: true });
  });
});

describe('firstFreeU — pulse target', () => {
  const r = rack({ ruHeight: 10 });
  it('finds U1 in an empty rack', () => {
    expect(firstFreeU(r, [], 1)).toBe(1);
  });
  it('skips an occupied U to the next free one', () => {
    const occ = dev({ ru: 1, ruSpan: 1 });
    expect(firstFreeU(r, [occ], 1)).toBe(2);
  });
  it('finds the first gap big enough for a 2U device', () => {
    const occ = [dev({ ru: 1 }), dev({ ru: 2 }), dev({ ru: 4 })]; // U3 free but only 1U; U5+ free
    expect(firstFreeU(r, occ, 2)).toBe(5);
  });
  it('returns null when the rack is full', () => {
    const occ = Array.from({ length: 10 }, (_, i) => dev({ ru: i + 1 }));
    expect(firstFreeU(r, occ, 1)).toBeNull();
  });
  it('returns null when the device is taller than the rack', () => {
    expect(firstFreeU(r, [], 11)).toBeNull();
  });
});

describe('nearestFreeU — pulse next to where the user aimed', () => {
  const r = rack({ ruHeight: 42 });
  it('returns the target itself when it is free', () => {
    expect(nearestFreeU(r, [], 1, 20)).toBe(20);
  });
  it('finds the closest free U just below an occupied target', () => {
    const occ = dev({ ru: 20, ruSpan: 1 });
    expect(nearestFreeU(r, [occ], 1, 20)).toBe(19); // 19 (below) is nearer than 21
  });
  it('searches outward symmetrically, preferring the lower side on ties', () => {
    const occ = [dev({ ru: 19 }), dev({ ru: 20 }), dev({ ru: 21 })];
    // target 20 blocked, 19/21 blocked → next ring 18 (below) wins over 22.
    expect(nearestFreeU(r, occ, 1, 20)).toBe(18);
  });
  it('clamps the target into range before searching', () => {
    expect(nearestFreeU(r, [], 2, 999)).toBe(41); // 2U → max origin is 41
  });
  it('returns null when nothing fits anywhere', () => {
    const full = Array.from({ length: 42 }, (_, i) => dev({ ru: i + 1 }));
    expect(nearestFreeU(r, full, 1, 20)).toBeNull();
  });
});
