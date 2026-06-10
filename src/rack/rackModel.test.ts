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
  type Slot,
} from './rackModel';
import type { Device, Rack } from '@/model/types';

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
  ...over,
});

describe('slotOf — v2 back-compat defaults', () => {
  it('defaults mount/side/bay for a legacy racked device', () => {
    const s = slotOf(dev({ ru: 40, ruSpan: 2, mount: undefined, side: undefined, bay: undefined }));
    expect(s).toEqual({ ru: 40, ruSpan: 2, mount: 'rack', side: 'front', bay: 'full' });
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

describe('slotsCollide', () => {
  it('different sides never collide', () => {
    expect(slotsCollide(slot({ side: 'front' }), slot({ side: 'rear' }))).toBe(false);
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
