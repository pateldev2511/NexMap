/**
 * Bulk-edit helpers for the rack designer. Selecting N devices and stamping a field on all
 * of them is the biggest "easier to manage" lever, but bulk writes are dangerous: an
 * accidental structural field (ru, rackId, type) applied to 20 devices could scramble a
 * layout. So the allowlist below is the ONLY surface bulk edit can touch — inventory and
 * power-feed metadata, never geometry. Pure; the store action applies the picked patch as
 * one transaction.
 */
import type { Device } from '@/model/types';

/** The only fields bulk edit may set. Geometry/identity fields are deliberately excluded. */
export const BULK_EDITABLE_FIELDS = [
  'status',
  'owner',
  'assetTag',
  'warrantyExpiry',
  'powerFeed',
] as const;

export type BulkEditableField = (typeof BULK_EDITABLE_FIELDS)[number];
export type BulkPatch = Partial<Pick<Device, BulkEditableField>>;

/**
 * Filter an arbitrary patch down to the allowlisted bulk-editable fields, dropping any key
 * whose value is `undefined` (so "leave unchanged" controls don't clobber existing values).
 * Empty string IS kept — it means "clear this field" (e.g. blank the owner on all selected).
 */
export function pickBulkPatch(patch: Partial<Device>): BulkPatch {
  const out: BulkPatch = {};
  for (const key of BULK_EDITABLE_FIELDS) {
    const v = patch[key];
    if (v !== undefined) {
      // Each field keeps its own type; assignment is safe because key ∈ BULK_EDITABLE_FIELDS.
      (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

/** True if the picked patch would actually change something (non-empty). */
export function hasBulkChanges(patch: Partial<Device>): boolean {
  return Object.keys(pickBulkPatch(patch)).length > 0;
}
