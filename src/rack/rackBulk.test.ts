import { describe, it, expect } from 'vitest';
import { pickBulkPatch, hasBulkChanges, BULK_EDITABLE_FIELDS } from './rackBulk';

describe('pickBulkPatch', () => {
  it('keeps only allowlisted fields', () => {
    const out = pickBulkPatch({
      owner: 'Priya',
      status: 'maintenance',
      // structural / identity fields must be dropped:
      ru: 5,
      rackId: 'r9',
      type: 'switch',
      name: 'hacked',
    });
    expect(out).toEqual({ owner: 'Priya', status: 'maintenance' });
  });

  it('drops undefined values (leave-unchanged) but keeps empty string (clear)', () => {
    const out = pickBulkPatch({ owner: '', status: undefined, assetTag: 'A1' });
    expect(out).toEqual({ owner: '', assetTag: 'A1' });
    expect('status' in out).toBe(false);
  });

  it('handles powerFeed and warrantyExpiry', () => {
    expect(pickBulkPatch({ powerFeed: 'AB', warrantyExpiry: '2027-01-01' })).toEqual({
      powerFeed: 'AB',
      warrantyExpiry: '2027-01-01',
    });
  });

  it('returns empty for a patch with no editable fields', () => {
    expect(pickBulkPatch({ ru: 1, name: 'x' })).toEqual({});
  });
});

describe('hasBulkChanges', () => {
  it('is false when nothing editable is set, true otherwise', () => {
    expect(hasBulkChanges({ ru: 1 })).toBe(false);
    expect(hasBulkChanges({})).toBe(false);
    expect(hasBulkChanges({ owner: 'Sam' })).toBe(true);
    expect(hasBulkChanges({ owner: '' })).toBe(true); // clearing counts as a change
  });
});

describe('BULK_EDITABLE_FIELDS', () => {
  it('never includes geometry/identity fields', () => {
    for (const forbidden of ['ru', 'ruSpan', 'rackId', 'type', 'id', 'x', 'y']) {
      expect(BULK_EDITABLE_FIELDS).not.toContain(forbidden);
    }
  });
});
